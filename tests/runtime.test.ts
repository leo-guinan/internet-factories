import assert from "node:assert/strict";
import { test } from "node:test";
import { executeFactory } from "../packages/runtime/src/index.js";

test("failed attempts remain visible while a retry can complete the run", async () => {
  let calls = 0;
  const run = await executeFactory({ id: "research", version: "1", nodes: [{ id: "draft", functionId: "draft", functionVersion: "1", maxAttempts: 2 }], minimumQuality: 0.8 }, {
    draft: { async execute() { calls += 1; if (calls === 1) throw new Error("transient"); return { output: { ok: true }, costUsd: 0.12 }; } }
  }, { topic: "factories" }, { quality: () => 0.91 });
  assert.equal(run.status, "completed");
  assert.equal(run.nodeRuns.length, 2);
  assert.equal(run.nodeRuns[0].status, "failed");
  assert.equal(run.nodeRuns[1].status, "completed");
  assert.equal(run.totalCostUsd, 0.12);
  assert.equal(run.artifacts.length, 1);
});

test("quality rejection preserves work cost and produces no accepted artifact", async () => {
  const run = await executeFactory({ id: "research", version: "1", nodes: [{ id: "draft", functionId: "draft", functionVersion: "1" }], minimumQuality: 0.85 }, {
    draft: { async execute() { return { output: "weak", costUsd: 0.2 }; } }
  }, {}, { quality: () => 0.4 });
  assert.equal(run.status, "rejected");
  assert.equal(run.totalCostUsd, 0.2);
  assert.equal(run.artifacts.length, 0);
});


test("artifact envelopes carry provenance, schema, quality, and cost", async () => {
  const { envelopeForArtifact, validateArtifactEnvelope } = await import("../packages/runtime/src/index.js");
  const envelope = envelopeForArtifact({ id: "art_1", factoryId: "fac_1", factoryRunId: "run_1", type: "application/json", uri: "s3://bucket/art.json", sha256: "hash", createdAt: "2026-10-15T12:00:00Z" }, "insight-bundle@1", 0.93, 0.18);
  assert.equal(validateArtifactEnvelope(envelope).length, 0);
  assert.equal(envelope.factory_id, "fac_1");
  assert.equal(envelope.schema, "insight-bundle@1");
});

test("artifact envelope rejects impossible quality and negative cost", async () => {
  const { validateArtifactEnvelope } = await import("../packages/runtime/src/index.js");
  const errors = validateArtifactEnvelope({ artifact_id: "a", factory_id: "f", run_id: "r", type: "json", uri: "memory://a", quality: 1.2, cost: -1, created_at: "now", schema: "x@1" });
  assert.deepEqual(errors, ["cost must be a non-negative number", "quality must be between 0 and 1"]);
});
