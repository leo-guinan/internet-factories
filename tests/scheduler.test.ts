import assert from "node:assert/strict";
import { test } from "node:test";
import { createCronScheduler } from "../packages/scheduler/src/index.js";

test("cron scheduler creates a durable-job request without knowing factory internals", async () => {
  const jobs: Array<{ input: unknown; idempotencyKey: string }> = [];
  const scheduler = createCronScheduler(async (input, idempotencyKey) => { jobs.push({ input, idempotencyKey }); });
  scheduler.add({ id: "hourly-research", cron: "0 * * * *", input: { topic: "factories" }, nextFireAt: "2026-10-15T12:00:00.000Z" });
  await scheduler.tick(new Date("2026-10-15T12:01:00.000Z"));
  await scheduler.tick(new Date("2026-10-15T12:02:00.000Z"));
  assert.equal(jobs.length, 1);
  assert.deepEqual(jobs[0], { input: { topic: "factories" }, idempotencyKey: "cron:hourly-research:2026-10-15T12:00:00.000Z" });
  assert.equal(scheduler.get("hourly-research")?.lastFiredAt, "2026-10-15T12:00:00.000Z");
});

test("cron scheduler supports five-minute intervals", async () => {
  const jobs: string[] = [];
  const scheduler = createCronScheduler(async (_input, key) => { jobs.push(key); });
  scheduler.add({ id: "fast", cron: "*/5 * * * *", input: {}, nextFireAt: "2026-10-15T12:00:00.000Z" });
  await scheduler.tick(new Date("2026-10-15T12:04:00.000Z"));
  await scheduler.tick(new Date("2026-10-15T12:05:00.000Z"));
  assert.deepEqual(jobs, ["cron:fast:2026-10-15T12:00:00.000Z", "cron:fast:2026-10-15T12:05:00.000Z"]);
});

test("cron scheduler rejects unsupported daily hour syntax instead of changing its meaning", () => {
  const scheduler = createCronScheduler(async () => undefined);
  assert.throws(
    () => scheduler.add({ id: "daily", cron: "0 3 * * *", input: {}, nextFireAt: "2026-10-15T03:00:00.000Z" }),
    /Unsupported cron expression/
  );
});
