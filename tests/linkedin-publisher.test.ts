import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { LinkedInPostPublisher } from "../packages/adapters/src/linkedin.js";
import { hashPostBody, authorizePublication, ScheduledLinkedInPostQueue } from "../apps/linkedin-publisher/src/index.js";
import { IdentityStore } from "../packages/identity/src/index.js";

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
  await queue.schedule({ id: "post-1", scheduledAt: "2026-10-18T10:00:00.000Z", body: "Exact scheduled copy", approval: { artifactId: "art-1", artifactHash: "artifact-hash-1", approvedBodyHash: hashPostBody("Exact scheduled copy"), approvedBy: "leo", approvedAt: "2026-10-18T09:00:00.000Z", accountConnectionId: "linkedin-leo", scheduledAt: "2026-10-18T10:00:00.000Z" } }, { getAcceptedArtifact: async () => ({ artifactId: "art-1", sha256: "artifact-hash-1", content: {}, quality: 1 }) });
  let published = 0;
  const processed = await queue.tick(new Date("2026-10-18T10:01:00.000Z"), { publishText: async (body) => { published += 1; return { state: "verified", postUrn: "urn:li:share:123", status: 201, readbackMatches: true, readback: { commentary: body } }; } });
  assert.equal(published, 1);
  assert.equal(processed[0]?.status, "posted");
  const persisted = JSON.parse(await readFile(path, "utf8")) as Array<{ postUrn?: string; status: string }>;
  assert.deepEqual(persisted[0], { ...persisted[0], postUrn: "urn:li:share:123", status: "posted" });
});

test("identity authorizer requires active verified admin capability", async () => {
  const directory = await mkdtemp(join(process.cwd(), ".tmp-linkedin-publisher-")); const store = new IdentityStore(join(directory, "identity.json"));
  const user = store.createUser({ id: "leo", email: "leo@ideanexusventures.com", displayName: "Leo", actorId: "system:test", status: "active", emailVerified: true });
  store.grantAdmin({ id: "admin-leo", userId: user.id, grantedBy: "system:test" });
  const approval = { artifactId: "art", artifactHash: "hash", approvedBodyHash: hashPostBody("copy"), approvedBy: user.id, approvedAt: "2026-10-18T09:00:00.000Z", accountConnectionId: "linkedin-leo", scheduledAt: "2026-10-18T10:00:00.000Z" };
  assert.equal(authorizePublication(store, approval), true); store.revokeAdmin("admin-leo", "system:test"); assert.equal(authorizePublication(store, approval), false);
});

test("scheduled queue blocks publication when approval authority is revoked", async () => {
  const directory = await mkdtemp(join(process.cwd(), ".tmp-linkedin-publisher-")); const queue = new ScheduledLinkedInPostQueue(join(directory, "queue.json"));
  await queue.schedule({ id: "post-2", scheduledAt: "2026-10-18T10:00:00.000Z", body: "Exact scheduled copy", approval: { artifactId: "art-2", artifactHash: "artifact-hash-2", approvedBodyHash: hashPostBody("Exact scheduled copy"), approvedBy: "leo", approvedAt: "2026-10-18T09:00:00.000Z", accountConnectionId: "linkedin-leo", scheduledAt: "2026-10-18T10:00:00.000Z" } }, { getAcceptedArtifact: async () => ({ artifactId: "art-2", sha256: "artifact-hash-2", content: {}, quality: 1 }) });
  let published = 0; const processed = await queue.tick(new Date("2026-10-18T10:01:00.000Z"), { publishText: async () => { published += 1; throw new Error("must not publish"); } }, () => false);
  assert.equal(published, 0); assert.equal(processed[0]?.status, "authorization_required");
});

test("artifact hash is required before scheduling", async () => {
  const directory = await mkdtemp(join(process.cwd(), ".tmp-linkedin-publisher-")); const queue = new ScheduledLinkedInPostQueue(join(directory, "queue.json"));
  await assert.rejects(() => queue.schedule({ id: "post-hash", scheduledAt: "2026-10-18T10:00:00.000Z", body: "Exact scheduled copy", approval: { artifactId: "art-1", artifactHash: "wrong-hash", approvedBodyHash: hashPostBody("Exact scheduled copy"), approvedBy: "leo", approvedAt: "2026-10-18T09:00:00.000Z", accountConnectionId: "linkedin-leo", scheduledAt: "2026-10-18T10:00:00.000Z" } }, { getAcceptedArtifact: async () => ({ artifactId: "art-1", sha256: "actual-hash", content: {}, quality: 1 }) }), /accepted artifact/);
});

test("dispatching posts recover into reconciliation_required instead of republishing", async () => {
  const directory = await mkdtemp(join(process.cwd(), ".tmp-linkedin-publisher-")); const path = join(directory, "queue.json");
  const approval = { artifactId: "art-1", artifactHash: "artifact-hash-1", approvedBodyHash: hashPostBody("Exact scheduled copy"), approvedBy: "leo", approvedAt: "2026-10-18T09:00:00.000Z", accountConnectionId: "linkedin-leo", scheduledAt: "2026-10-18T10:00:00.000Z" };
  await import("node:fs/promises").then(({ writeFile }) => writeFile(path, JSON.stringify([{ id: "post-crash", scheduledAt: "2026-10-18T10:00:00.000Z", body: "Exact scheduled copy", approval, status: "dispatching", createdAt: "2026-10-18T09:00:00.000Z" }])));
  const queue = new ScheduledLinkedInPostQueue(path); let published = 0; const result = await queue.tick(new Date("2026-10-18T10:01:00.000Z"), { publishText: async () => { published += 1; throw new Error("must not republish"); } });
  assert.equal(published, 0); assert.equal(result.length, 0); assert.equal(queue.list()[0]?.status, "reconciliation_required");
});

test("scheduled queue refuses unresolved placeholders", async () => {
  const directory = await mkdtemp(join(process.cwd(), ".tmp-linkedin-publisher-"));
  const queue = new ScheduledLinkedInPostQueue(join(directory, "queue.json"));
  await assert.rejects(() => queue.schedule({ id: "post-1", scheduledAt: "2026-10-18T10:00:00.000Z", body: "[UPDATE WITH REAL DATA BEFORE POSTING]", approval: { artifactId: "art-1", artifactHash: "hash", approvedBodyHash: hashPostBody("[UPDATE WITH REAL DATA BEFORE POSTING]"), approvedBy: "leo", approvedAt: "2026-10-18T09:00:00.000Z", accountConnectionId: "linkedin-leo", scheduledAt: "2026-10-18T10:00:00.000Z" } }, { getAcceptedArtifact: async () => undefined }), /publication-ready/);
});
