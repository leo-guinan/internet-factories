import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createFactoryServer } from "../apps/api/src/server.js";
import { createLinkedInDraftFactory } from "../factories/linkedin-draft/factory.js";
import { evaluateLinkedInDraft, linkedinQualityEvaluator } from "../factories/linkedin-draft/evaluator.js";
import type { InsightInput } from "../factories/linkedin-draft/schemas.js";

const input: InsightInput = { insightId: "insight_1", campaignId: "campaign_1", sourceText: "Factories make work measurable.", audience: "independent builders", coreClaim: "Factories make work measurable", supportingEvidence: ["Durable receipts preserve cost and recovery."], targetAction: "Read the factory notes", destinationUrl: "https://example.com/factories" };
const draft = { insightId: input.insightId, campaignId: input.campaignId, hook: "Your AI worker needs a factory.", body: "Independent builders do not need more activity; they need factories that make work measurable. Durable receipts preserve cost and recovery.", cta: "Read the factory notes and see the system.", targetAction: input.targetAction, destinationUrl: input.destinationUrl };

function mockFactory() { return createLinkedInDraftFactory({ generate: async () => ({ draft, costUsd: 0.012, metadata: { model: "test-model", promptTokens: 10, completionTokens: 20 } }) }); }

test("LinkedIn draft factory produces an inspectable artifact through POST /jobs", async () => {
  const dir = await mkdtemp(join(tmpdir(), "internet-factories-linkedin-"));
  const factory = mockFactory();
  const server = createFactoryServer({ ...factory, storagePath: join(dir, "state.json"), port: 0, autoProcess: true });
  await server.start();
  try {
    const response = await fetch(`${server.url}/jobs`, { method: "POST", headers: { "content-type": "application/json", "idempotency-key": "linkedin-test-1" }, body: JSON.stringify({ input }) });
    const body = await response.json() as { run_id: string; status: string };
    assert.equal(response.status, 201);
    assert.equal(body.status, "completed");
    const run = server.getRun(body.run_id)!;
    assert.equal(run.output && typeof run.output === "object" && "hook" in run.output, true);
    assert.equal(run.totalCostUsd, 0.012);
    assert.equal(run.nodeRuns[0].metadata?.model, "test-model");
    assert.equal(run.nodeRuns[0].metadata?.promptTokens, 10);
    assert.equal(run.artifacts.length, 1);
    const artifact = await (await fetch(`${server.url}/artifacts/${run.artifacts[0].id}`)).json() as { schema: string; sha256: string; quality: number };
    assert.equal(artifact.schema, "linkedin-draft@1");
    assert.equal(artifact.quality, 1);
    assert.equal(artifact.sha256.length, 64);
  } finally { await server.close(); }
});

test("LinkedIn factory validates insight input before invoking the generator", async () => {
  let calls = 0;
  const factory = createLinkedInDraftFactory({ generate: async () => { calls += 1; return { draft, costUsd: 1 }; } });
  await assert.rejects(() => factory.functions["linkedin-draft-generator"].execute({ ...input, coreClaim: "" }, {} as never), /invalid insight input/);
  assert.equal(calls, 0);
});

test("invalid LinkedIn output is rejected while preserving evaluation issues", () => {
  const result = evaluateLinkedInDraft(input, { ...draft, body: "bad", cta: "x" });
  assert.equal(result.accepted, false);
  assert.ok(result.issues.includes("hook, body, or CTA is too short"));
  assert.equal(linkedinQualityEvaluator({ ...draft, body: "bad", cta: "x" }), 0.6);
});

test("incorrect target action is a mandatory quality failure", () => {
  const result = evaluateLinkedInDraft(input, { ...draft, targetAction: "Publish immediately" });
  assert.equal(result.score, 0.8);
  assert.equal(result.accepted, false);
  assert.ok(result.issues.includes("target action or destination URL changed"));
});

test("factory rejects an output with the wrong target action", async () => {
  const directory = await mkdtemp(join(tmpdir(), "internet-factories-linkedin-"));
  const factory = createLinkedInDraftFactory({ generate: async () => ({ draft: { ...draft, targetAction: "Publish immediately" }, costUsd: 0.012 }) });
  const server = createFactoryServer({ ...factory, storagePath: join(directory, "state.json"), port: 0, autoProcess: true });
  await server.start();
  try {
    const response = await fetch(`${server.url}/jobs`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ input }) });
    const body = await response.json() as { run_id: string; status: string };
    assert.equal(body.status, "rejected");
    assert.equal(server.getRun(body.run_id)?.artifacts.length, 0);
  } finally { await server.close(); }
});
