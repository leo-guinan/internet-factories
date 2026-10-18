import assert from "node:assert/strict";
import { test } from "node:test";
import { OpenAICompatibleDraftGenerator } from "../packages/adapters/src/openai-compatible.js";
import type { InsightInput } from "../factories/linkedin-draft/schemas.js";

const input: InsightInput = { insightId: "i1", campaignId: "c1", sourceText: "source", audience: "builders", coreClaim: "claim", supportingEvidence: ["evidence"], targetAction: "read", destinationUrl: "https://example.com", sixPs: { people: "builders", positioning: "useful", promise: "read", proof: ["evidence"], priority: "now", process: "read" } };
const context = { factoryId: "linkedin-draft", factoryVersion: "1.0.0", factoryRunId: "run_1", nodeId: "generate", functionId: "linkedin-draft-generator", functionVersion: "1", attempt: 1, startedAt: "2026-10-18T00:00:00.000Z", executionId: "exe_1", idempotencyKey: "job_1:generate:1" };

test("OpenAI-compatible adapter forwards structured request and records usage cost", async () => {
  let request: RequestInit | undefined;
  const generator = new OpenAICompatibleDraftGenerator({ endpoint: "https://model.example/v1", apiKey: "[REDACTED]", model: "model-1", inputCostPerTokenUsd: 0.001, outputCostPerTokenUsd: 0.002, transport: async (_url, init) => { request = init; return new Response(JSON.stringify({ model: "model-1", choices: [{ message: { content: JSON.stringify({ hook: "A useful hook", body: "A sufficiently long body for builders that stays grounded in the supplied claim.", cta: "Read more", targetAction: "read", destinationUrl: "https://example.com", }) } }], usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 } }), { status: 200, headers: { "content-type": "application/json" } }); } });
  const result = await generator.generate(input, context);
  assert.equal(result.draft.insightId, "i1");
  assert.equal(result.costUsd, 0.05);
  assert.equal(result.metadata?.model, "model-1");
  assert.equal((request?.headers as Record<string, string>)["idempotency-key"], context.idempotencyKey);
});
