import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export interface FactoryObjective { id: string; factoryId: string; metric: string; target: number; unit: string; window: { duration: "day" | "week"; timezone: string }; constraints: { maxActionsPerWindow: number; maxCostUsd?: number; minimumActionSpacingMinutes?: number }; }
export type ObservationMeasurement = "cumulative_snapshot" | "window_total" | "increment";
export interface FactoryObservation { id: string; objectiveId: string; metric: string; value: number; measurement: ObservationMeasurement; observedAt: string; sourceId: string; confidence: number; hypothesisId?: string; }
export interface PlanCandidate { id: string; hypothesis: string; artifactId: string; artifactHash: string; estimatedCostUsd: number; approved: boolean; published: boolean; publishedArtifactId?: string; }
export interface WeeklyPlan { id: string; objectiveId: string; version: number; createdAt: string; candidates: PlanCandidate[]; evidenceIds?: string[]; revisionReason?: string; }
export type ControlAction = "hold" | "release" | "replan" | "observe";
export interface ControlDecision { id: string; objectiveId: string; planId: string; planVersion: number; action: ControlAction; reason: string; evidenceIds: string[]; candidateId?: string; decidedAt: string; }

type Persisted = { observations: FactoryObservation[] };
const atomicWrite = (path: string, value: unknown) => { mkdirSync(dirname(path), { recursive: true }); const tmp = `${path}.${process.pid}.tmp`; writeFileSync(tmp, JSON.stringify(value, null, 2)); renameSync(tmp, path); };

export class ObservationLedger {
  private observations: FactoryObservation[] = [];
  constructor(private readonly path: string) { try { this.observations = (JSON.parse(readFileSync(path, "utf8")) as Persisted).observations ?? []; } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; } }
  record(observation: FactoryObservation): FactoryObservation { if (!this.observations.some((item) => item.id === observation.id)) { if (!Number.isFinite(observation.value) || observation.value < 0) throw new Error("observation value must be non-negative"); if (!Number.isFinite(observation.confidence) || observation.confidence < 0 || observation.confidence > 1) throw new Error("observation confidence must be between 0 and 1"); this.observations.push({ ...observation }); this.persist(); } return { ...(this.observations.find((item) => item.id === observation.id)!) }; }
  list(objectiveId: string): FactoryObservation[] { return this.observations.filter((item) => item.objectiveId === objectiveId).map((item) => ({ ...item })); }
  currentValue(objective: FactoryObjective): number { const items = this.list(objective.id).filter((item) => item.metric === objective.metric).sort((a, b) => a.observedAt.localeCompare(b.observedAt)); const latestSnapshot = [...items].reverse().find((item) => item.measurement === "cumulative_snapshot"); const base = latestSnapshot?.value ?? 0; const after = latestSnapshot ? items.filter((item) => item.observedAt > latestSnapshot.observedAt) : items; return base + after.filter((item) => item.measurement === "increment" || item.measurement === "window_total").reduce((sum, item) => sum + item.value, 0); }
  private persist() { atomicWrite(this.path, { observations: this.observations }); }
}

export class VersionedPlanStore {
  private plans: WeeklyPlan[] = [];
  constructor(private readonly path: string) { try { this.plans = (JSON.parse(readFileSync(path, "utf8")) as { plans: WeeklyPlan[] }).plans ?? []; } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; } }
  create(plan: WeeklyPlan): WeeklyPlan { if (this.plans.some((item) => item.id === plan.id)) throw new Error(`plan already exists: ${plan.id}`); this.plans.push(structuredClone(plan)); this.persist(); return structuredClone(plan); }
  get(id: string): WeeklyPlan | undefined { const plan = this.plans.filter((item) => item.id === id).sort((a, b) => b.version - a.version)[0]; return plan ? structuredClone(plan) : undefined; }
  revise(id: string, candidates: PlanCandidate[], reason: string, evidenceIds: string[]): WeeklyPlan { const current = this.plans.filter((item) => item.id === id).sort((a, b) => b.version - a.version)[0]; if (!current) throw new Error(`plan not found: ${id}`); const next = { ...current, version: current.version + 1, createdAt: new Date().toISOString(), candidates: structuredClone(candidates), revisionReason: reason, evidenceIds: [...evidenceIds] }; this.plans.push(next); this.persist(); return structuredClone(next); }
  private persist() { atomicWrite(this.path, { plans: this.plans }); }
}

export class OutcomeController {
  constructor(private readonly ledger: ObservationLedger, private readonly minimumConfidence = 0.8) {}
  decide(objective: FactoryObjective, plan: WeeklyPlan, now = new Date()): ControlDecision {
    const observations = this.ledger.list(objective.id).filter((item) => item.metric === objective.metric).sort((a, b) => a.observedAt.localeCompare(b.observedAt));
    const latest = observations.at(-1); const maxAgeMs = (objective.window.duration === "day" ? 24 : 168) * 60 * 60 * 1000;
    const base = { id: `decision_${randomUUID()}`, objectiveId: objective.id, planId: plan.id, planVersion: plan.version, evidenceIds: observations.map((item) => item.id), decidedAt: now.toISOString() };
    if (!latest || now.getTime() - new Date(latest.observedAt).getTime() > maxAgeMs || latest.confidence < this.minimumConfidence) return { ...base, action: "observe", reason: "evidence is absent, stale, or below the confidence threshold" };
    const current = this.ledger.currentValue(objective);
    if (current >= objective.target) return { ...base, action: "hold", reason: `objective target met: ${current} ${objective.unit} >= ${objective.target}` };
    const hypothesis = [...observations].reverse().find((item) => item.hypothesisId)?.hypothesisId;
    if (hypothesis && plan.candidates[0] && hypothesis !== plan.candidates[0].id) return { ...base, action: "replan", reason: `evidence favors hypothesis ${hypothesis} over current candidate ${plan.candidates[0].id}` };
    const candidate = plan.candidates.find((item) => item.approved && !item.published && item.estimatedCostUsd <= (objective.constraints.maxCostUsd ?? Number.POSITIVE_INFINITY));
    return candidate ? { ...base, action: "release", candidateId: candidate.id, reason: `objective is below target and candidate ${candidate.id} is approved within constraints` } : { ...base, action: "observe", reason: "objective is below target but no eligible approved candidate exists" };
  }
}
