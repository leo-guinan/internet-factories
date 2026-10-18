import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { InsightInput } from "./schemas.js";

export type InsightQueueStatus = "approved" | "reserved" | "consumed";
export interface ApprovedInsightRecord { id: string; input: InsightInput; status: InsightQueueStatus; reservedAt?: string; consumedAt?: string; }
export interface QueueSkip { scheduleId: string; fireAt: string; reason: "no_approved_insight"; recordedAt: string; }

type QueueState = { insights: ApprovedInsightRecord[]; skips: QueueSkip[] };

export class ApprovedInsightQueue {
  private readonly storagePath: string;
  private readonly insights: ApprovedInsightRecord[] = [];
  private readonly skips: QueueSkip[] = [];
  constructor(storagePath: string) {
    this.storagePath = storagePath;
    if (existsSync(storagePath)) { const state = JSON.parse(readFileSync(storagePath, "utf8")) as QueueState; this.insights.push(...state.insights); this.skips.push(...state.skips); }
  }
  enqueue(id: string, input: InsightInput) {
    if (this.insights.some((record) => record.id === id)) throw new Error(`insight already queued: ${id}`);
    this.insights.push({ id, input, status: "approved" });
    this.persist();
  }
  reserve(now = new Date()): ApprovedInsightRecord | undefined {
    const record = this.insights.find((candidate) => candidate.status === "approved");
    if (!record) return undefined;
    record.status = "reserved"; record.reservedAt = now.toISOString(); this.persist(); return { ...record };
  }
  consume(id: string, now = new Date()) {
    const record = this.insights.find((candidate) => candidate.id === id);
    if (!record || record.status !== "reserved") throw new Error(`insight is not reserved: ${id}`);
    record.status = "consumed"; record.consumedAt = now.toISOString(); this.persist();
  }
  release(id: string) {
    const record = this.insights.find((candidate) => candidate.id === id);
    if (!record || record.status !== "reserved") throw new Error(`insight is not reserved: ${id}`);
    record.status = "approved"; record.reservedAt = undefined; this.persist();
  }
  recordSkip(scheduleId: string, fireAt: string, now = new Date()) {
    if (this.skips.some((skip) => skip.scheduleId === scheduleId && skip.fireAt === fireAt)) return;
    this.skips.push({ scheduleId, fireAt, reason: "no_approved_insight", recordedAt: now.toISOString() }); this.persist();
  }
  list() { return this.insights.map((record) => ({ ...record })); }
  skipsRecorded() { return this.skips.map((skip) => ({ ...skip })); }
  private persist() { mkdirSync(dirname(this.storagePath), { recursive: true }); const temporary = `${this.storagePath}.${process.pid}.tmp`; writeFileSync(temporary, JSON.stringify({ insights: this.insights, skips: this.skips }, null, 2)); renameSync(temporary, this.storagePath); }
}
