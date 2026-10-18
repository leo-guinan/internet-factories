import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createLinkedInDraftRunner } from "../apps/runner/src/index.js";
import { ApprovedInsightQueue } from "../factories/linkedin-draft/queue.js";
import type { InsightInput } from "../factories/linkedin-draft/schemas.js";

const input: InsightInput = { insightId: "insight_scheduled", campaignId: "campaign_1", sourceText: "Factories preserve evidence.", audience: "builders", coreClaim: "Factories preserve evidence", supportingEvidence: ["Receipts survive restart."], targetAction: "Read the notes", destinationUrl: "https://example.com/notes" };

test("scheduled runner reserves one approved insight and submits it once", async () => {
  const directory = await mkdtemp(join(tmpdir(), "internet-factories-runner-"));
  const queue = new ApprovedInsightQueue(join(directory, "queue.json"));
  queue.enqueue("approved-1", input);
  const submissions: Array<{ input: unknown; key: string }> = [];
  const runner = createLinkedInDraftRunner({ apiUrl: "http://factory.local", queue, schedulerStoragePath: join(directory, "schedule.json"), nextFireAt: "2026-10-18T09:00:00.000Z", transport: async (_url, init) => { const body = JSON.parse(String(init?.body)); submissions.push({ input: body.input, key: String(init?.headers && (init.headers as Record<string, string>)["idempotency-key"]) }); return new Response("{}", { status: 201 }); } });
  await runner.tick(new Date("2026-10-18T09:00:00.000Z"));
  assert.equal(submissions.length, 1);
  assert.deepEqual(submissions[0].input, input);
  assert.equal(queue.list()[0].status, "consumed");
});

test("scheduled runner records a skip when no approved insight exists", async () => {
  const directory = await mkdtemp(join(tmpdir(), "internet-factories-runner-"));
  const queue = new ApprovedInsightQueue(join(directory, "queue.json"));
  const runner = createLinkedInDraftRunner({ apiUrl: "http://factory.local", queue, schedulerStoragePath: join(directory, "schedule.json"), nextFireAt: "2026-10-18T09:00:00.000Z", transport: async () => new Response("{}", { status: 201 }) });
  await runner.tick(new Date("2026-10-18T09:00:00.000Z"));
  assert.equal(queue.skipsRecorded()[0].reason, "no_approved_insight");
});
