import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { ObservationLedger, VersionedPlanStore, OutcomeController, type FactoryObjective, type FactoryObservation, type WeeklyPlan } from "../packages/objectives/src/index.js";

const objective: FactoryObjective = { id: "obj-impressions", factoryId: "linkedin-draft", metric: "impressions", target: 1000, unit: "impressions", window: { duration: "day", timezone: "UTC" }, constraints: { maxActionsPerWindow: 1, minimumActionSpacingMinutes: 60 } };
const observation = (id: string, value: number, measurement: FactoryObservation["measurement"], observedAt = "2026-10-18T12:00:00.000Z"): FactoryObservation => ({ id, objectiveId: objective.id, metric: "impressions", value, measurement, observedAt, sourceId: "attention-lens:notification", confidence: 0.95 });
const plan: WeeklyPlan = { id: "plan-week-1", objectiveId: objective.id, version: 1, createdAt: "2026-10-18T00:00:00.000Z", candidates: [{ id: "candidate-a", hypothesis: "artifact-a earns attention", artifactId: "artifact-a", artifactHash: "hash-a", estimatedCostUsd: 0.01, approved: true, published: false }] };

test("observation ledger is idempotent and cumulative snapshots are not added", async () => {
  const dir = await mkdtemp(join(process.cwd(), ".tmp-objectives-")); const ledger = new ObservationLedger(join(dir, "observations.json"));
  ledger.record(observation("notification-209", 209, "cumulative_snapshot")); ledger.record(observation("notification-209", 209, "cumulative_snapshot")); ledger.record(observation("notification-80", 80, "cumulative_snapshot", "2026-10-18T11:00:00.000Z"));
  assert.equal(ledger.list(objective.id).length, 2);
  assert.equal(ledger.currentValue(objective), 209);
});

test("window totals sum increments but cumulative snapshots use the latest value", async () => {
  const dir = await mkdtemp(join(process.cwd(), ".tmp-objectives-")); const ledger = new ObservationLedger(join(dir, "observations.json"));
  ledger.record(observation("a", 80, "cumulative_snapshot", "2026-10-18T10:00:00.000Z")); ledger.record(observation("b", 200, "cumulative_snapshot", "2026-10-18T12:00:00.000Z")); ledger.record(observation("c", 3, "increment", "2026-10-18T12:30:00.000Z"));
  assert.equal(ledger.currentValue(objective), 203);
});

test("stale or absent evidence requests observation", async () => {
  const dir = await mkdtemp(join(process.cwd(), ".tmp-objectives-")); const ledger = new ObservationLedger(join(dir, "observations.json")); const controller = new OutcomeController(ledger);
  const decision = controller.decide(objective, plan, new Date("2026-10-19T12:00:00.000Z"));
  assert.equal(decision.action, "observe");
  ledger.record(observation("stale", 100, "cumulative_snapshot", "2026-10-17T12:00:00.000Z"));
  assert.equal(controller.decide(objective, plan, new Date("2026-10-19T12:00:00.000Z")).action, "observe");
});

test("met target holds and does not release another action", async () => {
  const dir = await mkdtemp(join(process.cwd(), ".tmp-objectives-")); const ledger = new ObservationLedger(join(dir, "observations.json")); ledger.record(observation("met", 1000, "cumulative_snapshot"));
  const decision = new OutcomeController(ledger).decide(objective, plan, new Date("2026-10-18T12:30:00.000Z"));
  assert.equal(decision.action, "hold"); assert.match(decision.reason, /target/i);
});

test("reliable unmet evidence releases an eligible candidate", async () => {
  const dir = await mkdtemp(join(process.cwd(), ".tmp-objectives-")); const ledger = new ObservationLedger(join(dir, "observations.json")); ledger.record(observation("partial", 100, "cumulative_snapshot"));
  const decision = new OutcomeController(ledger).decide(objective, plan, new Date("2026-10-18T12:30:00.000Z"));
  assert.equal(decision.action, "release"); assert.equal(decision.candidateId, "candidate-a"); assert.deepEqual(decision.evidenceIds, ["partial"]);
});

test("new hypothesis evidence requests a versioned plan revision without changing published artifacts", async () => {
  const dir = await mkdtemp(join(process.cwd(), ".tmp-objectives-")); const store = new VersionedPlanStore(join(dir, "plans.json")); store.create(plan);
  const revised = store.revise(plan.id, [{ ...plan.candidates[0], published: true, publishedArtifactId: "artifact-a" }, { id: "candidate-b", hypothesis: "artifact-b earns attention", artifactId: "artifact-b", artifactHash: "hash-b", estimatedCostUsd: 0.01, approved: true, published: false }], "new evidence favors candidate-b", ["obs-b"]);
  assert.equal(revised.version, 2); assert.equal(revised.candidates.find((candidate) => candidate.id === "candidate-a")?.publishedArtifactId, "artifact-a");
  const reloaded = new VersionedPlanStore(join(dir, "plans.json")); assert.equal((await readFile(join(dir, "plans.json"), "utf8")).includes("candidate-b"), true); assert.equal(reloaded.get(plan.id)?.version, 2);
});
