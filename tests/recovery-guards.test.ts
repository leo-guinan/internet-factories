import assert from "node:assert/strict";
import { test } from "node:test";
import { executeFactory, type NodeRun } from "../packages/runtime/src/index.js";

const spec = { id: "guards", version: "1", nodes: [{ id: "step", functionId: "step", functionVersion: "1", maxAttempts: 2 }] };
const runOnce = async () => executeFactory(spec, { step: { async execute() { return { output: { value: "ok" }, costUsd: 0.1 }; } } }, { input: "a" }, { executionKeyPrefix: "job_guards" });

test("tampered stored output is not reused", async () => {
  const first = await runOnce();
  const tampered = structuredClone(first.nodeRuns) as NodeRun[];
  tampered[0].output = { value: "tampered" };
  let calls = 0;
  const recovered = await executeFactory(spec, { step: { async execute() { calls += 1; return { output: { value: "fresh" } }; } } }, { input: "a" }, { runId: first.id, resumeNodeRuns: tampered });
  assert.equal(calls, 1);
  assert.deepEqual(recovered.output, { value: "fresh" });
});

test("changed function version is not reused", async () => {
  const first = await runOnce();
  const changed = { ...spec, nodes: [{ ...spec.nodes[0], functionVersion: "2" }] };
  let calls = 0;
  await executeFactory(changed, { step: { async execute() { calls += 1; return { output: "new" }; } } }, { input: "a" }, { runId: first.id, resumeNodeRuns: first.nodeRuns });
  assert.equal(calls, 1);
});

test("changed input is not reused", async () => {
  const first = await runOnce();
  let calls = 0;
  await executeFactory(spec, { step: { async execute() { calls += 1; return { output: "new" }; } } }, { input: "b" }, { runId: first.id, resumeNodeRuns: first.nodeRuns });
  assert.equal(calls, 1);
});

test("exhausted attempt budget does not execute again", async () => {
  const first = await executeFactory(spec, { step: { async execute() { throw new Error("failure"); } } }, { input: "a" }, { executionKeyPrefix: "job_budget" });
  assert.equal(first.status, "failed");
  assert.equal(first.nodeRuns.length, 2);
  let calls = 0;
  const recovered = await executeFactory(spec, { step: { async execute() { calls += 1; return { output: "must-not-run" }; } } }, { input: "a" }, { runId: first.id, resumeNodeRuns: first.nodeRuns });
  assert.equal(calls, 0);
  assert.equal(recovered.status, "failed");
});
