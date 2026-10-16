import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";

export interface CronSchedule { id: string; cron: string; input: unknown; nextFireAt: string; lastFiredAt?: string; enabled?: boolean; }
export type JobSubmitter = (input: unknown, idempotencyKey: string) => Promise<void>;
export interface CronSchedulerOptions { storagePath?: string; }

function intervalMs(cron: string): number {
  const fields = cron.trim().split(/\s+/);
  if (fields.length !== 5 || fields[2] !== "*" || fields[3] !== "*" || fields[4] !== "*") throw new Error(`Unsupported cron expression: ${cron}`);
  if (fields[0] === "*") return 60_000;
  if (fields[0] === "0" && fields[1] === "*") return 3_600_000;
  const match = /^\/(\d+)$/.exec(fields[0].replace("*", ""));
  if (match && Number(match[1]) > 0) return Number(match[1]) * 60_000;
  throw new Error(`Unsupported cron expression: ${cron}`);
}

function persist(path: string | undefined, schedules: Map<string, CronSchedule>) {
  if (!path) return;
  const temporary = `${path}.tmp`;
  writeFileSync(temporary, JSON.stringify([...schedules.values()], null, 2));
  renameSync(temporary, path);
}

export function createCronScheduler(submitJob: JobSubmitter, options: CronSchedulerOptions = {}) {
  const schedules = new Map<string, CronSchedule>();
  if (options.storagePath && existsSync(options.storagePath)) {
    const saved = JSON.parse(readFileSync(options.storagePath, "utf8")) as CronSchedule[];
    for (const schedule of saved) { intervalMs(schedule.cron); schedules.set(schedule.id, schedule); }
  }
  return {
    add(schedule: CronSchedule) { intervalMs(schedule.cron); schedules.set(schedule.id, { enabled: true, ...schedule }); persist(options.storagePath, schedules); },
    get(id: string) { return schedules.get(id); },
    async tick(now: Date = new Date()) {
      for (const schedule of schedules.values()) {
        if (schedule.enabled === false) continue;
        const interval = intervalMs(schedule.cron);
        let next = new Date(schedule.nextFireAt);
        while (next <= now) {
          const fireAt = next.toISOString();
          await submitJob(schedule.input, `cron:${schedule.id}:${fireAt}`);
          schedule.lastFiredAt = fireAt;
          next = new Date(next.getTime() + interval);
        }
        schedule.nextFireAt = next.toISOString();
      }
      persist(options.storagePath, schedules);
    }
  };
}
