import assert from "node:assert/strict";
import { test } from "node:test";
import { createFactoryServer } from "../apps/api/src/server.js";

test("two factories compose over HTTP through artifact.accepted", async () => {
  const factoryB = createFactoryServer({
    spec: { id: "factory-b", version: "1", nodes: [{ id: "consume", functionId: "consume", functionVersion: "1" }] },
    outputSchema: "newsletter@1",
    functions: { consume: { async execute(input) { return { output: { consumed: input }, costUsd: 0.07 }; } } }
  });
  await factoryB.start();
  const factoryA = createFactoryServer({
    spec: { id: "factory-a", version: "1", nodes: [{ id: "produce", functionId: "produce", functionVersion: "1" }] },
    outputSchema: "insight-bundle@1",
    functions: { produce: { async execute(input) { return { output: { insight: input }, costUsd: 0.11 }; } } },
    webhooks: [{ event: "artifact.accepted", url: `${factoryB.url}/jobs` }]
  });
  await factoryA.start();
  try {
    const response = await fetch(`${factoryA.url}/jobs`, { method: "POST", headers: { "content-type": "application/json", "idempotency-key": "source-job-1" }, body: JSON.stringify({ input: { topic: "factories" } }) });
    assert.equal(response.status, 201);
    const created = await response.json() as { run_id: string; status: string };
    assert.equal(created.status, "completed");

    await factoryA.flushWebhooks();
    const downstream = factoryB.listRuns();
    assert.equal(downstream.length, 1);
    assert.equal(downstream[0].status, "completed");
    assert.equal(downstream[0].nodeRuns[0].status, "completed");
    assert.equal(factoryA.outbox.length, 1);
    assert.equal(factoryA.outbox[0].status, "delivered");

    const duplicate = await fetch(`${factoryA.url}/jobs`, { method: "POST", headers: { "content-type": "application/json", "idempotency-key": "source-job-1" }, body: JSON.stringify({ input: { topic: "different" } }) });
    assert.equal(duplicate.status, 200);
    assert.equal(factoryA.listRuns().length, 1);
  } finally {
    await factoryA.close();
    await factoryB.close();
  }
});
