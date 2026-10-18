import { createCronScheduler } from "../../../packages/scheduler/src/index.js";
import type { InsightInput } from "../../../factories/linkedin-draft/schemas.js";
import { ApprovedInsightQueue } from "../../../factories/linkedin-draft/queue.js";

export interface LinkedInDraftRunnerOptions { apiUrl: string; queue: ApprovedInsightQueue; schedulerStoragePath: string; scheduleId?: string; cron?: string; nextFireAt: string; port?: number; transport?: typeof fetch; }

export function createLinkedInDraftRunner(options: LinkedInDraftRunnerOptions) {
  const scheduleId = options.scheduleId ?? "linkedin-draft-schedule";
  const transport = options.transport ?? fetch;
  const scheduler = createCronScheduler(async (input, idempotencyKey) => {
    const trigger = input as { scheduleId?: string; queue?: string };
    const reserved = options.queue.reserve();
    if (!reserved) { options.queue.recordSkip(trigger.scheduleId ?? scheduleId, idempotencyKey.slice(idempotencyKey.lastIndexOf(":") + 1)); return; }
    try {
      const response = await transport(`${options.apiUrl.replace(/\/$/, "")}/jobs`, { method: "POST", headers: { "content-type": "application/json", "idempotency-key": idempotencyKey }, body: JSON.stringify({ input: reserved.input, idempotency_key: idempotencyKey }) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      options.queue.consume(reserved.id);
    } catch (error) { options.queue.release(reserved.id); throw error; }
  }, { storagePath: options.schedulerStoragePath });
  scheduler.add({ id: scheduleId, cron: options.cron ?? "*/5 * * * *", input: { queue: "approved-insights", scheduleId }, nextFireAt: options.nextFireAt });
  return { scheduler, async tick(now = new Date()) { await scheduler.tick(now); } };
}

export function enqueueApprovedInsight(queue: ApprovedInsightQueue, id: string, input: InsightInput) { queue.enqueue(id, input); }
