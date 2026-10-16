import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { executeFactory, envelopeForArtifact, sha256Of, type ArtifactReference, type ArtifactEnvelope, type FactoryFunction, type FactoryNetworkContract, type FactoryRun, type FactorySpec, type WebhookSubscription } from "../../../packages/runtime/src/index.js";

export interface WebhookOutboxEntry { id: string; event: "artifact.accepted"; url: string; idempotencyKey: string; envelope: ArtifactEnvelope; status: "pending" | "delivered" | "failed"; attempts: number; lastError?: string; }
export interface FactoryServerOptions { spec: FactorySpec; functions: Record<string, FactoryFunction>; outputSchema: string; inputSchemas?: string[]; storagePath?: string; port?: number; quality?: (output: unknown) => number; webhooks?: WebhookSubscription[]; }
export interface FactoryServer {
  readonly contract: FactoryNetworkContract;
  readonly outbox: WebhookOutboxEntry[];
  readonly url: string;
  start(): Promise<void>;
  close(): Promise<void>;
  flushWebhooks(): Promise<void>;
  listRuns(): FactoryRun[];
  getRun(id: string): FactoryRun | undefined;
}

type PersistedState = { runs: FactoryRun[]; idempotency: Array<[string, string]>; artifacts: Array<[string, ArtifactEnvelope]>; contents: Array<[string, unknown]>; outbox: WebhookOutboxEntry[] };
type JobBody = { input?: unknown; idempotency_key?: string };
const json = (response: ServerResponse, status: number, body: unknown) => { response.statusCode = status; response.setHeader("content-type", "application/json"); response.end(JSON.stringify(body)); };
async function readJson(request: IncomingMessage): Promise<unknown> { let raw = ""; for await (const chunk of request) raw += chunk; return raw ? JSON.parse(raw) : {}; }
async function verifyInputArtifact(input: unknown): Promise<string | undefined> {
  if (!input || typeof input !== "object" || !("uri" in input) || !("sha256" in input)) return undefined;
  const envelope = input as { uri: string; sha256: string };
  const response = await fetch(envelope.uri);
  if (!response.ok) return "artifact_content_unavailable";
  const body = await response.json() as { content: unknown };
  return sha256Of(body.content) === envelope.sha256 ? undefined : "artifact_hash_mismatch";
}
function pathParts(request: IncomingMessage): string[] { return new URL(request.url ?? "/", "http://localhost").pathname.split("/").filter(Boolean); }

export function createFactoryServer(options: FactoryServerOptions): FactoryServer {
  const runs = new Map<string, FactoryRun>();
  const idempotency = new Map<string, FactoryRun>();
  const artifacts = new Map<string, ArtifactEnvelope>();
  const contents = new Map<string, unknown>();
  const outbox: WebhookOutboxEntry[] = [];
  let server: Server | undefined;
  let address = "";
  if (options.storagePath) {
    try {
      const state = JSON.parse(readFileSync(options.storagePath, "utf8")) as PersistedState;
      for (const run of state.runs) runs.set(run.id, run);
      for (const [key, runId] of state.idempotency) { const run = runs.get(runId); if (run) idempotency.set(key, run); }
      for (const [id, artifact] of state.artifacts) artifacts.set(id, artifact);
      for (const [id, content] of state.contents) contents.set(id, content);
      outbox.push(...state.outbox);
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  }
  const persist = () => {
    if (!options.storagePath) return;
    mkdirSync(dirname(options.storagePath), { recursive: true });
    const state: PersistedState = { runs: [...runs.values()], idempotency: [...idempotency.entries()].map(([key, run]) => [key, run.id]), artifacts: [...artifacts.entries()], contents: [...contents.entries()], outbox };
    const temporary = `${options.storagePath}.${process.pid}.tmp`;
    writeFileSync(temporary, JSON.stringify(state));
    renameSync(temporary, options.storagePath);
  };
  const contract: FactoryNetworkContract = { input: { type: "api", schema: "job@1" }, output: { type: "artifact", schema: options.outputSchema }, webhooks: options.webhooks ?? [] };

  const submit = async (body: JobBody, requestId?: string): Promise<{ run: FactoryRun; duplicate: boolean }> => {
    const key = requestId ?? body.idempotency_key;
    if (key && idempotency.has(key)) return { run: idempotency.get(key)!, duplicate: true };
    const parents: ArtifactReference[] = [];
    if (body.input && typeof body.input === "object" && "artifact_id" in body.input && "factory_id" in body.input && "run_id" in body.input && "schema" in body.input) {
      const input = body.input as ArtifactReference;
      parents.push({ artifact_id: input.artifact_id, factory_id: input.factory_id, run_id: input.run_id, schema: input.schema });
    }
    const run = await executeFactory(options.spec, options.functions, body.input, { quality: options.quality, parents });
    runs.set(run.id, run);
    if (key) idempotency.set(key, run);
    if (run.status === "completed" && run.artifacts[0]) {
      const artifact = run.artifacts[0];
      const upstreamCost = body.input && typeof body.input === "object" && "economics" in body.input ? Number(((body.input as { economics?: { total_cost?: number } }).economics?.total_cost) ?? 0) : 0;
      artifact.economics = { local_cost: run.totalCostUsd, upstream_cost: upstreamCost, total_cost: run.totalCostUsd + upstreamCost };
      artifact.uri = `${address}/artifacts/${artifact.id}/content`;
      contents.set(artifact.id, run.output);
      const envelope = envelopeForArtifact(artifact, options.outputSchema, run.qualityScore, artifact.economics.total_cost);
      artifacts.set(envelope.artifact_id, envelope);
      for (const webhook of options.webhooks ?? []) outbox.push({ id: `out_${randomUUID()}`, event: "artifact.accepted", url: webhook.url, idempotencyKey: `artifact.accepted:${envelope.artifact_id}:${webhook.url}`, envelope, status: "pending", attempts: 0 });
    }
    persist();
    return { run, duplicate: false };
  };

  const handler = async (request: IncomingMessage, response: ServerResponse) => {
    try {
      const parts = pathParts(request);
      if (request.method === "POST" && parts.length === 1 && parts[0] === "jobs") {
        const body = await readJson(request) as JobBody;
        const hashError = await verifyInputArtifact(body.input);
        if (hashError) return json(response, 422, { error: hashError });
        if (options.inputSchemas && body.input && typeof body.input === "object" && "schema" in body.input && !options.inputSchemas.includes(String((body.input as { schema: unknown }).schema))) return json(response, 422, { error: "input_schema_not_supported" });
        const result = await submit(body, request.headers["idempotency-key"]?.toString());
        return json(response, result.duplicate ? 200 : 201, { run_id: result.run.id, status: result.run.status, factory_id: result.run.factoryId });
      }
      if (request.method === "GET" && parts.length === 2 && parts[0] === "runs") {
        const run = runs.get(parts[1]);
        return run ? json(response, 200, run) : json(response, 404, { error: "run_not_found" });
      }
      if (request.method === "GET" && parts.length === 3 && parts[0] === "artifacts" && parts[2] === "content") {
        if (!contents.has(parts[1])) return json(response, 404, { error: "artifact_content_not_found" });
        return json(response, 200, { artifact_id: parts[1], content: contents.get(parts[1]) });
      }
      if (request.method === "GET" && parts.length === 2 && parts[0] === "artifacts") {
        const artifact = artifacts.get(parts[1]);
        return artifact ? json(response, 200, artifact) : json(response, 404, { error: "artifact_not_found" });
      }
      return json(response, 404, { error: "not_found" });
    } catch (error) { return json(response, 400, { error: error instanceof Error ? error.message : String(error) }); }
  };

  return {
    contract,
    outbox,
    get url() { return address; },
    async start() { server = createServer((request, response) => { void handler(request, response); }); await new Promise<void>((resolve) => server!.listen(options.port ?? 0, "127.0.0.1", () => { const info = server!.address(); if (info && typeof info !== "string") address = `http://127.0.0.1:${info.port}`; for (const artifact of artifacts.values()) artifact.uri = `${address}/artifacts/${artifact.artifact_id}/content`; for (const entry of outbox) entry.envelope.uri = `${address}/artifacts/${entry.envelope.artifact_id}/content`; for (const run of runs.values()) for (const artifact of run.artifacts) artifact.uri = `${address}/artifacts/${artifact.id}/content`; persist(); resolve(); })); },
    async close() { if (server) await new Promise<void>((resolve, reject) => server!.close((error) => error ? reject(error) : resolve())); server = undefined; address = ""; },
    async flushWebhooks() { for (const entry of outbox.filter((item) => item.status !== "delivered")) { entry.attempts += 1; try { const response = await fetch(entry.url, { method: "POST", headers: { "content-type": "application/json", "idempotency-key": entry.idempotencyKey }, body: JSON.stringify({ input: entry.envelope, idempotency_key: entry.idempotencyKey }) }); if (!response.ok) throw new Error(`HTTP ${response.status}`); entry.status = "delivered"; } catch (error) { entry.status = "failed"; entry.lastError = error instanceof Error ? error.message : String(error); } persist(); } },
    listRuns() { return [...runs.values()]; },
    getRun(id: string) { return runs.get(id); }
  };
}
