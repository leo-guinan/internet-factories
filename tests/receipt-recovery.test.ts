import assert from "node:assert/strict";
import { test } from "node:test";
import { executeFactory } from "../packages/runtime/src/index.js";

test("completed node receipts are reused during recovery", async () => {
  const spec = { id: "resume", version: "1", nodes: [
    { id: "prepare", functionId: "prepare", functionVersion: "1" },
    { id: "finish", functionId: "finish", functionVersion: "1", dependsOn: ["prepare"] }
  ] };
  const first = await executeFactory(spec, {
    prepare: { async execute() { return { output: "prepared", costUsd: 0.10 }; } },
    finish: { async execute(input) { return { output: `${input}-done`, costUsd: 0.20 }; } }
  }, "input", { executionKeyPrefix: "job_resume" });
  let prepareCalls = 0;
  const recovered = await executeFactory(spec, {
    prepare: { async execute() { prepareCalls += 1; throw new Error("must not rerun"); } },
    finish: { async execute(input) { return { output: `${input}-done-again`, costUsd: 0.20 }; } }
  }, "input", { runId: first.id, executionKeyPrefix: "job_resume", resumeNodeRuns: first.nodeRuns });
  assert.equal(prepareCalls, 0);
  assert.equal(recovered.nodeRuns[0].status, "completed");
  assert.equal(recovered.output, "prepared-done");
  assert.equal(recovered.nodeRuns.filter((node) => node.reused).length, 2);
});
