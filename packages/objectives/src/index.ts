import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export interface FactoryObjective { id: string; factoryId: string; metric: string; target: number; unit: string; window: { duration: "day" | "week"; timezone: string }; constraints: { maxActionsPerWindow: number; maxCostUsd?: number; minimumActionSpacingMinutes?: number }; }
export type ObservationMeasurement = "cumulative_snapshot" | "window_total" | "increment";
export interface FactoryObservation { id: string; objectiveId: string; metric: string; value: number; measurement: ObservationMeasurement; subjectId: string; scope: "post" | "account"; period: { start: string; end: string }; observedAt: string; sourceId: string; confidence: number; hypothesisId?: string; }
export interface PlanCandidate { id: string; hypothesis: string; artifactId: string; artifactHash: string; estimatedCostUsd: number; approved: boolean; published: boolean; publishedArtifactId?: string; }
export interface WeeklyPlan { id: string; objectiveId: string; version: number; createdAt: string; candidates: PlanCandidate[]; evidenceIds?: string[]; revisionReason?: string; }
export type ControlAction = "hold" | "release" | "replan" | "observe";
export interface ControlDecision { id: string; objectiveId: string; planId: string; planVersion: number; action: ControlAction; reason: string; evidenceIds: string[]; candidateId?: string; decidedAt: string; }
export interface ActionRecord { id: string; objectiveId: string; candidateId: string; decisionId: string; status: "proposed" | "reserved" | "dispatched" | "confirmed" | "reconciliation_required" | "failed"; releasedAt: string; estimatedCostUsd: number; }
export type ControllerMode = "shadow" | "live";
export interface OutcomeControllerOptions { minimumConfidence?: number; actions?: ActionLedger; mode?: ControllerMode; }
export class ActionLedger {
  private actions: ActionRecord[] = [];
  constructor(private readonly path?: string) { if (path) { try { this.actions = (JSON.parse(readFileSync(path, "utf8")) as { actions: ActionRecord[] }).actions ?? []; } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; } } }
  list(objectiveId: string): ActionRecord[] { return this.actions.filter((item) => item.objectiveId === objectiveId).map((item) => ({ ...item })); }
  record(action: ActionRecord): ActionRecord { if (!this.actions.some((item) => item.id === action.id)) { this.actions.push({ ...action }); this.persist(); } return { ...this.actions.find((item) => item.id === action.id)! }; }
  isDurable(): boolean { return this.path !== undefined; }
  update(id: string, status: ActionRecord["status"]): ActionRecord { const action = this.actions.find((item) => item.id === id); if (!action) throw new Error(`action not found: ${id}`); action.status = status; this.persist(); return { ...action }; }
  private persist() { if (this.path) atomicWrite(this.path, { actions: this.actions }); }
}

type Persisted = { observations: FactoryObservation[] };
const atomicWrite = (path: string, value: unknown) => { mkdirSync(dirname(path), { recursive: true }); const tmp = `${path}.${process.pid}.tmp`; writeFileSync(tmp, JSON.stringify(value, null, 2)); renameSync(tmp, path); };

export class ObservationLedger {
  private observations: FactoryObservation[] = [];
  constructor(private readonly path: string) { try { this.observations = (JSON.parse(readFileSync(path, "utf8")) as Persisted).observations ?? []; } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; } }
  record(observation: FactoryObservation): FactoryObservation { if (!this.observations.some((item) => item.id === observation.id)) { if (!Number.isFinite(observation.value) || observation.value < 0) throw new Error("observation value must be non-negative"); if (!Number.isFinite(observation.confidence) || observation.confidence < 0 || observation.confidence > 1) throw new Error("observation confidence must be between 0 and 1"); this.observations.push({ ...observation }); this.persist(); } return { ...(this.observations.find((item) => item.id === observation.id)!) }; }
  list(objectiveId: string): FactoryObservation[] { return this.observations.filter((item) => item.objectiveId === objectiveId).map((item) => ({ ...item })); }
  windowValue(objective: FactoryObjective, period: { start: string; end: string }): number | undefined { const items = this.list(objective.id).filter((item) => item.metric === objective.metric && item.scope === "account" && item.subjectId === "account" && item.period.start <= period.start && item.period.end >= period.start).sort((a, b) => a.observedAt.localeCompare(b.observedAt)); if (!items.length) return undefined; const latestSnapshot = [...items].reverse().find((item) => item.measurement === "cumulative_snapshot"); const base = latestSnapshot?.value ?? 0; const after = latestSnapshot ? items.filter((item) => item.observedAt > latestSnapshot.observedAt) : items; return base + after.filter((item) => item.measurement === "increment" || item.measurement === "window_total").reduce((sum, item) => sum + item.value, 0); }
  currentValue(objective: FactoryObjective): number { const items = this.list(objective.id).filter((item) => item.metric === objective.metric && item.scope === "account" && item.subjectId === "account").sort((a, b) => a.observedAt.localeCompare(b.observedAt)); const latestSnapshot = [...items].reverse().find((item) => item.measurement === "cumulative_snapshot"); const base = latestSnapshot?.value ?? 0; const after = latestSnapshot ? items.filter((item) => item.observedAt > latestSnapshot.observedAt) : items; return base + after.filter((item) => item.measurement === "increment" || item.measurement === "window_total").reduce((sum, item) => sum + item.value, 0); }
  private persist() { atomicWrite(this.path, { observations: this.observations }); }
}

export class VersionedPlanStore {
  private plans: WeeklyPlan[] = [];
  constructor(private readonly path: string) { try { this.plans = (JSON.parse(readFileSync(path, "utf8")) as { plans: WeeklyPlan[] }).plans ?? []; } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; } }
  create(plan: WeeklyPlan): WeeklyPlan { if (this.plans.some((item) => item.id === plan.id)) throw new Error(`plan already exists: ${plan.id}`); this.plans.push(structuredClone(plan)); this.persist(); return structuredClone(plan); }
  get(id: string): WeeklyPlan | undefined { const plan = this.plans.filter((item) => item.id === id).sort((a, b) => b.version - a.version)[0]; return plan ? structuredClone(plan) : undefined; }
  revise(id: string, candidates: PlanCandidate[], reason: string, evidenceIds: string[]): WeeklyPlan { const current = this.plans.filter((item) => item.id === id).sort((a, b) => b.version - a.version)[0]; if (!current) throw new Error(`plan not found: ${id}`); for (const candidate of candidates) if (candidates.filter((item) => item.id === candidate.id).length > 1) throw new Error(`duplicate candidate ID ${candidate.id}`); for (const previous of current.candidates.filter((item) => item.published)) { const next = candidates.find((item) => item.id === previous.id); if (!next || !next.published || next.artifactId !== previous.artifactId || next.artifactHash !== previous.artifactHash || next.publishedArtifactId !== previous.publishedArtifactId) throw new Error(`published artifact ${previous.artifactId} is immutable`); } const next = { ...current, version: current.version + 1, createdAt: new Date().toISOString(), candidates: structuredClone(candidates), revisionReason: reason, evidenceIds: [...evidenceIds] }; this.plans.push(next); this.persist(); return structuredClone(next); }
  private persist() { atomicWrite(this.path, { plans: this.plans }); }
}

function localMidnightUtc(date: Date, timezone: string, dayOffset = 0): Date {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  const year = Number(parts.find((part) => part.type === "year")!.value); const month = Number(parts.find((part) => part.type === "month")!.value) - 1; const day = Number(parts.find((part) => part.type === "day")!.value) + dayOffset;
  let guess = Date.UTC(year, month, day);
  for (let i = 0; i < 3; i++) { const local = new Intl.DateTimeFormat("en-US", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).formatToParts(new Date(guess)); const asUtc = Date.UTC(Number(local.find((part) => part.type === "year")!.value), Number(local.find((part) => part.type === "month")!.value) - 1, Number(local.find((part) => part.type === "day")!.value), Number(local.find((part) => part.type === "hour")!.value) % 24, Number(local.find((part) => part.type === "minute")!.value), Number(local.find((part) => part.type === "second")!.value)); guess += Date.UTC(year, month, day) - asUtc; }
  return new Date(guess);
}
function objectiveWindow(now: Date, objective: FactoryObjective): { start: string; end: string } {
  const start = localMidnightUtc(now, objective.window.timezone); if (objective.window.duration === "day") return { start: start.toISOString(), end: new Date(localMidnightUtc(now, objective.window.timezone, 1).getTime() - 1).toISOString() };
  const day = new Intl.DateTimeFormat("en-US", { timeZone: objective.window.timezone, weekday: "short" }).format(now); const offset = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(day); const weekStart = localMidnightUtc(now, objective.window.timezone, -offset); return { start: weekStart.toISOString(), end: new Date(localMidnightUtc(now, objective.window.timezone, 7 - offset).getTime() - 1).toISOString() };
}
export class OutcomeController {
  private readonly minimumConfidence: number;
  private readonly actions: ActionLedger;
  private readonly mode: ControllerMode;
  constructor(private readonly ledger: ObservationLedger, minimumConfidenceOrOptions: number | OutcomeControllerOptions = {}, actions?: ActionLedger, mode: ControllerMode = "shadow") { if (typeof minimumConfidenceOrOptions === "number") { this.minimumConfidence = minimumConfidenceOrOptions; this.actions = actions ?? new ActionLedger(); this.mode = mode; } else { this.minimumConfidence = minimumConfidenceOrOptions.minimumConfidence ?? 0.8; this.actions = minimumConfidenceOrOptions.actions ?? new ActionLedger(); this.mode = minimumConfidenceOrOptions.mode ?? "shadow"; } }
  decide(objective: FactoryObjective, plan: WeeklyPlan, now = new Date()): ControlDecision {
    const window = objectiveWindow(now, objective);
    const observations = this.ledger.list(objective.id).filter((item) => item.metric === objective.metric).sort((a, b) => a.observedAt.localeCompare(b.observedAt));
    const latest = observations.at(-1); const maxAgeMs = (objective.window.duration === "day" ? 24 : 168) * 60 * 60 * 1000;
    const base = { id: `decision_${randomUUID()}`, objectiveId: objective.id, planId: plan.id, planVersion: plan.version, evidenceIds: observations.map((item) => item.id), decidedAt: now.toISOString() };
    if (!latest || now.getTime() - new Date(latest.observedAt).getTime() > maxAgeMs || latest.confidence < this.minimumConfidence) return { ...base, action: "observe", reason: "evidence is absent, stale, or below the confidence threshold" };
    const current = this.ledger.windowValue(objective, window);
    if (current === undefined) return { ...base, action: "observe", reason: "objective measurement window is unknown; post-scoped or differently-perioded evidence cannot establish progress" };
    if (current >= objective.target) return { ...base, action: "hold", reason: `objective target met: ${current} ${objective.unit} >= ${objective.target}` };
    const windowMs = objective.window.duration === "day" ? 24 * 60 * 60 * 1000 : 7 * 24 * 60 * 60 * 1000;
    const recentActions = this.actions.list(objective.id).filter((item) => now.getTime() - new Date(item.releasedAt).getTime() <= windowMs);
    if (recentActions.length >= objective.constraints.maxActionsPerWindow) return { ...base, action: "hold", reason: "action budget for the objective window is exhausted" };
    const latestAction = recentActions.sort((a, b) => b.releasedAt.localeCompare(a.releasedAt))[0];
    if (recentActions.some((item) => item.status === "reserved" || item.status === "dispatched" || item.status === "reconciliation_required")) return { ...base, action: "hold", reason: "an action is already reserved or awaiting reconciliation" };
    if (latestAction && objective.constraints.minimumActionSpacingMinutes !== undefined && now.getTime() - new Date(latestAction.releasedAt).getTime() < objective.constraints.minimumActionSpacingMinutes * 60 * 1000) return { ...base, action: "hold", reason: "minimum action spacing has not elapsed" };
    const comparable = observations.filter((item) => item.scope === "account" && item.subjectId === "account" && item.period.start <= window.start && item.period.end >= window.end && item.hypothesisId);
    const groups = new Map<string, FactoryObservation[]>(); for (const item of comparable) { const group = groups.get(item.hypothesisId! ) ?? []; group.push(item); groups.set(item.hypothesisId!, group); }
    const ranked = [...groups.entries()].map(([id, items]) => ({ id, value: items.reduce((sum, item) => sum + item.value, 0) / items.length, confidence: Math.min(...items.map((item) => item.confidence)), samples: items.length })).sort((a, b) => b.value - a.value);
    const currentHypothesis = plan.candidates[0]?.id; const best = ranked[0];
    if (best && currentHypothesis && best.id !== currentHypothesis && best.samples >= 1 && best.confidence >= this.minimumConfidence) return { ...base, action: "replan", reason: `comparable evidence favors hypothesis ${best.id} (${best.value}) over ${currentHypothesis}; ${best.samples} sample(s)` };
    const candidate = plan.candidates.find((item) => item.approved && !item.published && item.estimatedCostUsd <= (objective.constraints.maxCostUsd ?? Number.POSITIVE_INFINITY));
    if (!candidate) return { ...base, action: "observe", reason: "objective is below target but no eligible approved candidate exists" };
    const decision = { ...base, action: "release" as const, candidateId: candidate.id, reason: `objective is below target and candidate ${candidate.id} is approved within constraints` };
    if (this.mode === "live") { if (!this.actions.isDurable()) throw new Error("live outcome control requires a durable action ledger"); this.actions.record({ id: `action_${decision.id}`, objectiveId: objective.id, candidateId: candidate.id, decisionId: decision.id, status: "reserved", releasedAt: now.toISOString(), estimatedCostUsd: candidate.estimatedCostUsd }); }
    return decision;
  }
}
