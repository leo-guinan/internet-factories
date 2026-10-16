import assert from "node:assert/strict";
import { test } from "node:test";
import { createFactoryServer } from "../apps/api/src/server.js";
import { sha256Of } from "../packages/runtime/src/index.js";

test("two factories compose over HTTP by retrieving and transforming an artifact", async () => {
  const factoryB = createFactoryServer({
    spec: { id: "factory-b", version: "1", nodes: [{ id: "consume", functionId: "consume", functionVersion: "1" }] },
    inputSchemas: ["plain-text@1"],
    outputSchema: "uppercase@1",
    functions: { consume: { async execute(input) {
      const envelope = input as { uri: string };
      const content = await (await fetch(envelope.uri)).json() as { content: string };
      return { output: content.content.toUpperCase(), costUsd: 0.07 };
    } } }
  });
  await factoryB.start();
  const factoryA = createFactoryServer({
    spec: { id: "factory-a", version: "1", nodes: [{ id: "produce", functionId: "produce", functionVersion: "1" }] },
    outputSchema: "plain-text@1",
    functions: { produce: { async execute() { return { output: "hello world", costUsd: 0.11 }; } } },
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
    assert.equal(factoryA.outbox[0].status, "delivered");
    assert.equal(factoryB.outbox.length, 0);

    const downstreamArtifact = downstream[0].artifacts[0];
    const artifactResponse = await fetch(`${factoryB.url}/artifacts/${downstreamArtifact.id}`);
    const downstreamEnvelope = await artifactResponse.json() as { economics?: { local_cost: number; upstream_cost: number; total_cost: number }; parents?: Array<{ artifact_id: string }> };
    assert.equal(artifactResponse.status, 200);
    assert.equal(downstreamEnvelope.parents?.length, 1);
    assert.equal(downstreamEnvelope.parents?.[0].artifact_id, factoryA.outbox[0].envelope.artifact_id);
    assert.equal(factoryA.outbox[0].envelope.economics?.total_cost, 0.11);
    assert.equal(factoryA.outbox[0].envelope.sha256, sha256Of("hello world"));
    assert.equal(downstreamEnvelope.economics?.local_cost, 0.07);
    assert.equal(downstreamEnvelope.economics?.upstream_cost, 0.11);
    assert.equal(downstreamEnvelope.economics?.total_cost, 0.18);
    assert.notEqual(downstreamArtifact.sha256, "unhashed-local-output");

    const second = await fetch(`${factoryA.url}/jobs`, { method: "POST", headers: { "content-type": "application/json", "idempotency-key": "source-job-2" }, body: JSON.stringify({ input: { topic: "second" } }) });
    assert.equal(second.status, 201);
    await factoryA.flushWebhooks();
    assert.equal(factoryA.listRuns().length, 2);
    assert.equal(factoryB.listRuns().length, 2);
    assert.notEqual(factoryA.listRuns()[0].artifacts[0].id, factoryA.listRuns()[1].artifacts[0].id);

    const duplicate = await fetch(`${factoryA.url}/jobs`, { method: "POST", headers: { "content-type": "application/json", "idempotency-key": "source-job-1" }, body: JSON.stringify({ input: { topic: "different" } }) });
    assert.equal(duplicate.status, 200);
    assert.equal(factoryA.listRuns().length, 2);
    assert.equal(factoryB.listRuns().length, 2);
  } finally {
    await factoryA.close();
    await factoryB.close();
  }
});
