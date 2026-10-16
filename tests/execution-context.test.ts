import assert from "node:assert/strict";
import { test } from "node:test";
import { executeFactory } from "../packages/runtime/src/index.js";

test("functions receive node execution identity for external idempotency", async () => {
  let received: { executionId?: string; idempotencyKey?: string } = {};
  const run = await executeFactory({ id: "payments", version: "1", nodes: [{ id: "charge", functionId: "charge", functionVersion: "1" }] }, {
    charge: { async execute(_input, context) { received = context; return { output: "ok" }; } }
  }, {});
  assert.equal(received.executionId, run.nodeRuns[0].executionId);
  assert.equal(received.idempotencyKey, run.nodeRuns[0].idempotencyKey);
});
