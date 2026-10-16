import { createHash, randomUUID } from "node:crypto";

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
export interface ArtifactReference { artifact_id: string; factory_id: string; run_id: string; schema: string; }
export interface ArtifactEconomics { local_cost: number; upstream_cost: number; total_cost: number; }
export interface Artifact { id: string; factoryId: string; factoryRunId: string; type: string; uri: string; sha256: string; createdAt: string; parents?: ArtifactReference[]; economics?: ArtifactEconomics; }
export interface InputPort { type: "webhook" | "api"; schema: string; }
export interface OutputPort { type: "artifact"; schema: string; }
export interface ArtifactEnvelope { artifact_id: string; factory_id: string; run_id: string; type: string; uri: string; sha256: string; quality?: number; cost: number; economics?: ArtifactEconomics; created_at: string; schema: string; parents?: ArtifactReference[]; }
export interface WebhookSubscription { event: "artifact.accepted"; url: string; }
export interface FactoryNetworkContract { input: InputPort; output: OutputPort; webhooks?: WebhookSubscription[]; }
export function validateArtifactEnvelope(envelope: ArtifactEnvelope): string[] {
  const errors: string[] = [];
  for (const field of ["artifact_id", "factory_id", "run_id", "type", "uri", "sha256", "created_at", "schema"] as const) if (!envelope[field]) errors.push(`${field} is required`);
  if (!Number.isFinite(envelope.cost) || envelope.cost < 0) errors.push("cost must be a non-negative number");
  if (envelope.quality !== undefined && (envelope.quality < 0 || envelope.quality > 1)) errors.push("quality must be between 0 and 1");
  if (envelope.economics && (envelope.economics.local_cost < 0 || envelope.economics.upstream_cost < 0 || envelope.economics.total_cost < 0 || envelope.economics.total_cost !== envelope.economics.local_cost + envelope.economics.upstream_cost)) errors.push("economics must be non-negative and reconcile");
  return errors;
}
export function envelopeForArtifact(artifact: Artifact, schema: string, quality: number | undefined, cost: number): ArtifactEnvelope {
  const envelope: ArtifactEnvelope = { artifact_id: artifact.id, factory_id: artifact.factoryId, run_id: artifact.factoryRunId, type: artifact.type, uri: artifact.uri, sha256: artifact.sha256, quality, cost, economics: artifact.economics, created_at: artifact.createdAt, schema, parents: artifact.parents };
  const errors = validateArtifactEnvelope(envelope);
  if (errors.length) throw new Error(`Invalid artifact envelope: ${errors.join(", ")}`);
  return envelope;
}
export interface FactoryRun { id: string; factoryId: string; factoryVersion: string; status: RunStatus; startedAt?: string; finishedAt?: string; totalCostUsd: number; totalLatencyMs: number; qualityScore?: number; output?: unknown; nodeRuns: NodeRun[]; artifacts: Artifact[]; }

const now = () => new Date().toISOString();
const id = (prefix: string) => `${prefix}_${randomUUID()}`;
export function canonicalize(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  return `{${Object.keys(value as Record<string, unknown>).sort().map((key) => `${JSON.stringify(key)}:${canonicalize((value as Record<string, unknown>)[key])}`).join(",")}}`;
}
export function sha256Of(value: unknown): string { return createHash("sha256").update(canonicalize(value)).digest("hex"); }
const hashOutput = sha256Of;

export async function executeFactory(spec: FactorySpec, functions: Record<string, FactoryFunction>, input: unknown, opts: { runId?: string; quality?: (output: unknown) => number; parents?: ArtifactReference[] } = {}): Promise<FactoryRun> {
  const run: FactoryRun = { id: opts.runId ?? id("run"), factoryId: spec.id, factoryVersion: spec.version, status: "running", startedAt: now(), totalCostUsd: 0, totalLatencyMs: 0, nodeRuns: [], artifacts: [] };
  const outputs = new Map<string, unknown>();
  try {
    for (const node of spec.nodes) {
      const nodeInput = node.dependsOn?.length ? node.dependsOn.map((dep) => outputs.get(dep)) : input;
      const maxAttempts = node.maxAttempts ?? 1;
      let completed = false;
      for (let attempt = 1; attempt <= maxAttempts && !completed; attempt++) {
        const started = Date.now();
        const nodeRun: NodeRun = { id: id("nod"), factoryRunId: run.id, nodeId: node.id, attempt, status: "running", startedAt: now(), costUsd: 0 };
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
    run.output = output;
    run.qualityScore = opts.quality?.(output) ?? 1;
    const accepted = run.qualityScore >= (spec.minimumQuality ?? 0);
    run.status = accepted ? "completed" : "rejected";
    if (accepted) run.artifacts.push({ id: id("art"), factoryId: spec.id, factoryRunId: run.id, type: "application/json", uri: `memory://${run.id}/output.json`, sha256: hashOutput(output), createdAt: now(), parents: opts.parents });
    run.finishedAt = now();
    return run;
  } catch (error) { run.status = "failed"; run.finishedAt = now(); throw error; }
}
