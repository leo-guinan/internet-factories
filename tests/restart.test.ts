import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createFactoryServer } from "../apps/api/src/server.js";

test("durable factory state survives restart and delivers a queued webhook once", async () => {
  const directory = await mkdtemp(join(tmpdir(), "internet-factories-"));
  const storagePath = join(directory, "factory-a.json");
  const factoryB = createFactoryServer({
    spec: { id: "factory-b", version: "1", nodes: [{ id: "consume", functionId: "consume", functionVersion: "1" }] },
    inputSchemas: ["plain-text@1"], outputSchema: "uppercase@1",
    functions: { consume: { async execute(input) { const content = await (await fetch((input as { uri: string }).uri)).json() as { content: string }; return { output: content.content.toUpperCase(), costUsd: 0.07 }; } } }
  });
  await factoryB.start();
  const makeA = (autoProcess = true) => createFactoryServer({
    spec: { id: "factory-a", version: "1", nodes: [{ id: "produce", functionId: "produce", functionVersion: "1" }] },
    outputSchema: "plain-text@1", storagePath, autoProcess,
    functions: { produce: { async execute() { return { output: "survives restart", costUsd: 0.11 }; } } },
    webhooks: [{ event: "artifact.accepted", url: `${factoryB.url}/jobs` }]
  });
  const first = makeA(false);
  await first.start();
  try {
    const response = await fetch(`${first.url}/jobs`, { method: "POST", headers: { "content-type": "application/json", "idempotency-key": "durable-job-1" }, body: JSON.stringify({ input: { topic: "durability" } }) });
    assert.equal(response.status, 202);
    assert.equal(first.outbox.length, 0);
  } finally { await first.close(); }

  const restarted = makeA();
  await restarted.start();
  try {
    assert.equal(restarted.listRuns().length, 1);
    assert.equal(restarted.outbox.length, 1);
    await restarted.flushWebhooks();
    assert.equal(restarted.outbox[0].status, "delivered");
    assert.equal(factoryB.listRuns().length, 1);
    const duplicate = await fetch(`${restarted.url}/jobs`, { method: "POST", headers: { "content-type": "application/json", "idempotency-key": "durable-job-1" }, body: JSON.stringify({ input: { topic: "different" } }) });
    assert.equal(duplicate.status, 200);
    assert.equal(restarted.listRuns().length, 1);
  } finally { await restarted.close(); await factoryB.close(); await rm(directory, { recursive: true, force: true }); }
});
