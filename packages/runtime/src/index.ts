export type RunStatus = "queued" | "running" | "completed" | "failed" | "rejected";
export type NodeStatus = "running" | "completed" | "failed" | "skipped";

export interface ExecutionContext {
  factoryId: string; factoryVersion: string; factoryRunId: string;
  nodeId: string; functionId: string; functionVersion: string;
  attempt: number; startedAt: string;
}
export interface FunctionResult { output: unknown; costUsd?: number; metadata?: Record<string, unknown>; }
export interface FactoryFunction { execute(input: unknown, context: ExecutionContext): Promise<FunctionResult>; }
export interface NodeSpec { id: string; functionId: string; functionVersion: string; dependsOn?: string[]; maxAttempts?: number; }
export interface FactorySpec { id: string; version: string; nodes: NodeSpec[]; minimumQuality?: number; }
export interface NodeRun { id: string; factoryRunId: string; nodeId: string; attempt: number; status: NodeStatus; startedAt: string; finishedAt?: string; costUsd: number; latencyMs?: number; error?: { type: string; message: string }; }
export interface Artifact { id: string; factoryId: string; factoryRunId: string; type: string; uri: string; sha256: string; createdAt: string; }
export interface InputPort { type: "webhook" | "api"; schema: string; }
export interface OutputPort { type: "artifact"; schema: string; }
export interface ArtifactEnvelope { artifact_id: string; factory_id: string; run_id: string; type: string; uri: string; quality?: number; cost: number; created_at: string; schema: string; }
export interface WebhookSubscription { event: "artifact.accepted"; url: string; }
export interface FactoryNetworkContract { input: InputPort; output: OutputPort; webhooks?: WebhookSubscription[]; }
export function validateArtifactEnvelope(envelope: ArtifactEnvelope): string[] {
  const errors: string[] = [];
  for (const field of ["artifact_id", "factory_id", "run_id", "type", "uri", "created_at", "schema"] as const) if (!envelope[field]) errors.push(`${field} is required`);
  if (!Number.isFinite(envelope.cost) || envelope.cost < 0) errors.push("cost must be a non-negative number");
  if (envelope.quality !== undefined && (envelope.quality < 0 || envelope.quality > 1)) errors.push("quality must be between 0 and 1");
  return errors;
}
export function envelopeForArtifact(artifact: Artifact, schema: string, quality: number | undefined, cost: number): ArtifactEnvelope {
  const envelope: ArtifactEnvelope = { artifact_id: artifact.id, factory_id: artifact.factoryId, run_id: artifact.factoryRunId, type: artifact.type, uri: artifact.uri, quality, cost, created_at: artifact.createdAt, schema };
  const errors = validateArtifactEnvelope(envelope);
  if (errors.length) throw new Error(`Invalid artifact envelope: ${errors.join(", ")}`);
  return envelope;
}
export interface FactoryRun { id: string; factoryId: string; factoryVersion: string; status: RunStatus; startedAt?: string; finishedAt?: string; totalCostUsd: number; totalLatencyMs: number; qualityScore?: number; nodeRuns: NodeRun[]; artifacts: Artifact[]; }

const now = () => new Date().toISOString();
const id = (prefix: string, n: number) => `${prefix}_${n.toString(36).padStart(8, "0")}`;

export async function executeFactory(spec: FactorySpec, functions: Record<string, FactoryFunction>, input: unknown, opts: { runId?: string; quality?: (output: unknown) => number } = {}): Promise<FactoryRun> {
  const run: FactoryRun = { id: opts.runId ?? id("run", Date.now()), factoryId: spec.id, factoryVersion: spec.version, status: "running", startedAt: now(), totalCostUsd: 0, totalLatencyMs: 0, nodeRuns: [], artifacts: [] };
  const outputs = new Map<string, unknown>();
  try {
    for (const node of spec.nodes) {
      const nodeInput = node.dependsOn?.length ? node.dependsOn.map((dep) => outputs.get(dep)) : input;
      const maxAttempts = node.maxAttempts ?? 1;
      let completed = false;
      for (let attempt = 1; attempt <= maxAttempts && !completed; attempt++) {
        const started = Date.now();
        const nodeRun: NodeRun = { id: id("nod", run.nodeRuns.length + 1), factoryRunId: run.id, nodeId: node.id, attempt, status: "running", startedAt: now(), costUsd: 0 };
        run.nodeRuns.push(nodeRun);
        try {
          const fn = functions[node.functionId];
          if (!fn) throw new Error(`Function not registered: ${node.functionId}`);
          const result = await fn.execute(nodeInput, { factoryId: spec.id, factoryVersion: spec.version, factoryRunId: run.id, nodeId: node.id, functionId: node.functionId, functionVersion: node.functionVersion, attempt, startedAt: nodeRun.startedAt });
          nodeRun.status = "completed"; nodeRun.finishedAt = now(); nodeRun.latencyMs = Date.now() - started; nodeRun.costUsd = result.costUsd ?? 0; run.totalCostUsd += nodeRun.costUsd; run.totalLatencyMs += nodeRun.latencyMs; outputs.set(node.id, result.output); completed = true;
        } catch (error) {
          nodeRun.status = "failed"; nodeRun.finishedAt = now(); nodeRun.latencyMs = Date.now() - started; nodeRun.error = { type: error instanceof Error ? error.constructor.name : "UnknownError", message: error instanceof Error ? error.message : String(error) }; run.totalLatencyMs += nodeRun.latencyMs;
        }
      }
      if (!completed) { run.status = "failed"; run.finishedAt = now(); return run; }
    }
    const output = outputs.get(spec.nodes.at(-1)?.id ?? "output");
    run.qualityScore = opts.quality?.(output) ?? 1;
    const accepted = run.qualityScore >= (spec.minimumQuality ?? 0);
    run.status = accepted ? "completed" : "rejected";
    if (accepted) run.artifacts.push({ id: id("art", 1), factoryId: spec.id, factoryRunId: run.id, type: "application/json", uri: `memory://${run.id}/output.json`, sha256: "unhashed-local-output", createdAt: now() });
    run.finishedAt = now();
    return run;
  } catch (error) { run.status = "failed"; run.finishedAt = now(); throw error; }
}
