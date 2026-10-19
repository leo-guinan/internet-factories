import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { createFactoryServer } from "../../api/src/server.js";
import { createLinkedInDraftFactory } from "../../../factories/linkedin-draft/factory.js";
import { evaluateLinkedInDraft } from "../../../factories/linkedin-draft/evaluator.js";
import type { InsightInput } from "../../../factories/linkedin-draft/schemas.js";
import { OpenAICompatibleDraftGenerator, type OpenAICompatibleOptions } from "../../../packages/adapters/src/openai-compatible.js";

export interface SmokeOptions extends Omit<OpenAICompatibleOptions, "transport"> {
  receiptPath: string;
  transport?: OpenAICompatibleOptions["transport"];
  input?: InsightInput;
}

export interface SmokeResult {
  published: false;
  run: ReturnType<ReturnType<typeof createFactoryServer>["listRuns"]>[number];
  artifact: { id: string; accepted: boolean; quality: number; sha256: string; content: unknown };
  receiptPath: string;
}

export interface SmokeReceipt { runId: string; artifactId?: string; factoryId: string; status: string; quality: number; accepted: boolean; evaluation: ReturnType<typeof evaluateLinkedInDraft>; artifactHash?: string; model?: unknown; tokenUsage: { promptTokens?: unknown; completionTokens?: unknown; totalTokens?: unknown }; estimatedCostUsd: number; providerBilledCostUsd?: number; pricing: { inputCostPerTokenUsd: number; outputCostPerTokenUsd: number }; latencyMs?: number; publication: "disabled"; source: string; }

export function buildSmokeReceipt(run: SmokeResult["run"], input: InsightInput, pricing: Pick<OpenAICompatibleOptions, "inputCostPerTokenUsd" | "outputCostPerTokenUsd">, artifact?: { artifact_id: string; sha256: string }): SmokeReceipt {
  const node = run.nodeRuns[0];
  return { runId: run.id, ...(artifact ? { artifactId: artifact.artifact_id, artifactHash: artifact.sha256 } : {}), factoryId: run.factoryId, status: run.status, quality: run.qualityScore ?? 0, accepted: run.status === "completed", evaluation: evaluateLinkedInDraft(input, run.output), model: node?.metadata?.model, tokenUsage: { promptTokens: node?.metadata?.promptTokens, completionTokens: node?.metadata?.completionTokens, totalTokens: node?.metadata?.totalTokens }, estimatedCostUsd: run.totalCostUsd, pricing: { inputCostPerTokenUsd: pricing.inputCostPerTokenUsd ?? 0, outputCostPerTokenUsd: pricing.outputCostPerTokenUsd ?? 0 }, latencyMs: run.finishedAt && run.startedAt ? new Date(run.finishedAt).getTime() - new Date(run.startedAt).getTime() : undefined, publication: "disabled", source: "public-safe-smoke-input" };
}

const sampleInsight: InsightInput = {
  insightId: "marvin-insight-factories-smoke-001",
  campaignId: "internet-factories-smoke",
  sourceText: "AI work becomes more useful when its inputs, failures, costs, and outputs remain inspectable and rerunnable.",
  audience: "independent builders shipping AI systems",
  coreClaim: "Durable, measurable factories make AI work inspectable and repeatable.",
  supportingEvidence: ["A durable job ledger preserves retries and failures.", "Artifact hashes make outputs independently inspectable."],
  targetAction: "Read the public notes",
  destinationUrl: "https://github.com/leo-guinan/internet-factories",
  sixPs: {
    people: "independent builders shipping AI systems",
    positioning: "AI work as durable measurable production",
    promise: "inspectable and repeatable AI work",
    proof: ["durable job ledger", "artifact hashes"],
    priority: "before the context disappears",
    process: "record inputs, failures, costs, and artifacts"
  }
};

export async function runSmoke(options: SmokeOptions): Promise<SmokeResult> {
  const input = options.input ?? sampleInsight;
  const generator = new OpenAICompatibleDraftGenerator({ ...options, transport: options.transport });
  const factory = createLinkedInDraftFactory(generator);
  const server = createFactoryServer({ ...factory, port: 0, autoProcess: true });
  await server.start();
  try {
    const response = await fetch(`${server.url}/jobs`, { method: "POST", headers: { "content-type": "application/json", "idempotency-key": `smoke:${Date.now()}` }, body: JSON.stringify({ input }) });
    const payload = await response.json() as { run_id?: string; error?: string };
    if (!response.ok || !payload.run_id) throw new Error(`smoke job failed: ${payload.error ?? `HTTP ${response.status}`}`);
    const run = server.getRun(payload.run_id);
    if (!run) throw new Error(`smoke run not found: ${payload.run_id}`);
    const stored = run.artifacts[0];
    if (!stored) {
      mkdirSync(dirname(options.receiptPath), { recursive: true });
      const receipt = buildSmokeReceipt(run, input, options);
      mkdirSync(dirname(options.receiptPath), { recursive: true });
      writeFileSync(options.receiptPath, JSON.stringify({ receipt, output: run.output }, null, 2));
      throw new Error("smoke run produced no accepted artifact");
    }
    const artifact = server.getArtifact(stored.id);
    const content = server.getArtifactContent(stored.id);
    if (!artifact || content === undefined) throw new Error(`smoke artifact not readable: ${stored.id}`);
    const receipt = buildSmokeReceipt(run, input, options, artifact);
    mkdirSync(dirname(options.receiptPath), { recursive: true });
    writeFileSync(options.receiptPath, JSON.stringify({ receipt, output: content }, null, 2));
    return { published: false, run, artifact: { id: artifact.artifact_id, accepted: run.status === "completed", quality: run.qualityScore ?? 0, sha256: artifact.sha256, content }, receiptPath: options.receiptPath };
  } finally { await server.close(); }
}

async function main() {
  const apiKey = process.env.OPENROUTER_API_KEY ?? process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENROUTER_API_KEY or OPENAI_API_KEY is required; publication remains disabled");
  const result = await runSmoke({ apiKey, endpoint: process.env.OPENROUTER_ENDPOINT ?? "https://openrouter.ai/api/v1", model: process.env.OPENROUTER_MODEL ?? "anthropic/claude-haiku-5.5", inputCostPerTokenUsd: Number(process.env.OPENROUTER_INPUT_COST_PER_TOKEN_USD ?? (0.10 / 1_000_000)), outputCostPerTokenUsd: Number(process.env.OPENROUTER_OUTPUT_COST_PER_TOKEN_USD ?? (0.50 / 1_000_000)), receiptPath: process.env.SMOKE_RECEIPT_PATH ?? "artifacts/linkedin-draft-smoke-latest.json" });
  console.log(JSON.stringify({ runId: result.run.id, artifactId: result.artifact.id, quality: result.artifact.quality, accepted: result.artifact.accepted, receiptPath: result.receiptPath, published: result.published }, null, 2));
}

if (process.argv[1]?.endsWith("apps/smoke/src/index.ts")) void main().catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
