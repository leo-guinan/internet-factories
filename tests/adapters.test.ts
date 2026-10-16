import assert from "node:assert/strict";
import { test } from "node:test";
import { executeHttp } from "../packages/adapters/src/index.js";

test("HTTP adapter forwards node idempotency key", async () => {
  let receivedKey = "";
  const result = await executeHttp("https://example.invalid", { value: 1 }, {
    factoryId: "f", factoryVersion: "1", factoryRunId: "r", nodeId: "call", functionId: "http", functionVersion: "1", attempt: 1, startedAt: "now", executionId: "exe_1", idempotencyKey: "job_1:call:1"
  }, async (_url, init) => { receivedKey = String((init.headers as Record<string, string>)["idempotency-key"]); return new Response(JSON.stringify({ ok: true }), { status: 200 }); });
  assert.equal(receivedKey, "job_1:call:1");
  assert.deepEqual(result.output, { ok: true });
});
