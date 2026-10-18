import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { LinkedInPostPublisher } from "../packages/adapters/src/linkedin.js";
import { ScheduledLinkedInPostQueue } from "../apps/linkedin-publisher/src/index.js";

test("LinkedIn publisher verifies the published post by readback", async () => {
  const calls: Array<{ url: string; method: string }> = [];
  const accessToken = process.env.TEST_LINKEDIN_TOKEN ?? ["fixture", "token"].join("-");
  const publisher = new LinkedInPostPublisher({ tokenProvider: async () => accessToken, authorUrn: "urn:li:person:test", endpoint: "https://linkedin.test", transport: async (url, init) => {
    calls.push({ url, method: init?.method ?? "GET" });
    if (init?.method === "POST") return new Response(null, { status: 201, headers: { "x-restli-id": "urn:li:share:123" } });
    return new Response(JSON.stringify({ author: "urn:li:person:test", commentary: "Exact scheduled copy" }), { status: 200 });
  } });
  const receipt = await publisher.publishText("Exact scheduled copy");
  assert.equal(receipt.state, "verified");
  assert.equal(receipt.postUrn, "urn:li:share:123");
  assert.deepEqual(calls.map((call) => call.method), ["POST", "GET"]);
});

test("scheduled queue publishes only approved posts that are due and persists receipt", async () => {
  const directory = await mkdtemp(join(process.cwd(), ".tmp-linkedin-publisher-"));
  const path = join(directory, "queue.json");
  const queue = new ScheduledLinkedInPostQueue(path);
  queue.schedule({ id: "post-1", scheduledAt: "2026-10-18T10:00:00.000Z", body: "Exact scheduled copy" });
  let published = 0;
  const processed = await queue.tick(new Date("2026-10-18T10:01:00.000Z"), { publishText: async (body) => { published += 1; return { state: "verified", postUrn: "urn:li:share:123", status: 201, readbackMatches: true, readback: { commentary: body } }; } });
  assert.equal(published, 1);
  assert.equal(processed[0]?.status, "posted");
  const persisted = JSON.parse(await readFile(path, "utf8")) as Array<{ postUrn?: string; status: string }>;
  assert.deepEqual(persisted[0], { ...persisted[0], postUrn: "urn:li:share:123", status: "posted" });
});

test("scheduled queue refuses unresolved placeholders", async () => {
  const directory = await mkdtemp(join(process.cwd(), ".tmp-linkedin-publisher-"));
  const queue = new ScheduledLinkedInPostQueue(join(directory, "queue.json"));
  assert.throws(() => queue.schedule({ id: "post-1", scheduledAt: "2026-10-18T10:00:00.000Z", body: "[UPDATE WITH REAL DATA BEFORE POSTING]" }), /publication-ready/);
});
