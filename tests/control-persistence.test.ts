import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { ControlDecisionStore, executeControlDecision, makeControlDecision, observeControlDecision, type ActuatorCandidate, type ObservedFactoryState } from "../packages/controller/src/index.js";

const state: ObservedFactoryState = { quality: 0.9, costUsd: 1, latencyMs: 7000, throughputPerHour: 4, failureRate: 0.1, retryRate: 0.1, recoveryEfficiency: 0.5 };
const candidate: ActuatorCandidate = { actuatorId: "parallelism", variable: "parallelism", delta: 1, predictedState: { ...state, latencyMs: 6800 }, predictedAssessment: { withinEnvelope: true, violations: [], errors: {} }, score: 0.1 };

test("control decision store survives restart and reloads pending decisions", async () => {
  const dir = await mkdtemp(join(tmpdir(), "internet-factories-control-"));
  const storagePath = join(dir, "decisions.json");
  const first = new ControlDecisionStore({ storagePath });
  const decision = makeControlDecision(state, [candidate], "2026-10-15T12:00:00.000Z");
  first.save(decision);
  const restarted = new ControlDecisionStore({ storagePath });
  assert.equal(restarted.get(decision.id)?.status, "planned");
  assert.deepEqual(restarted.pending().map((item) => item.id), [decision.id]);
});

test("actuator application is idempotent and persists applied status", async () => {
  const dir = await mkdtemp(join(tmpdir(), "internet-factories-control-"));
  const store = new ControlDecisionStore({ storagePath: join(dir, "decisions.json") });
  const decision = makeControlDecision(state, [candidate]);
  store.save(decision);
  const keys: string[] = [];
  const adapter = { apply: async (_candidate: ActuatorCandidate, context: { idempotencyKey: string }) => { keys.push(context.idempotencyKey); } };
  const applied = await executeControlDecision(decision, adapter, store, "2026-10-15T12:01:00.000Z");
  assert.equal(applied.status, "applied");
  assert.deepEqual(keys, [decision.id]);
  assert.equal(store.get(decision.id)?.status, "applied");
});

test("actuator application receives the decision config version for atomic compare-and-set", async () => {
  const dir = await mkdtemp(join(tmpdir(), "internet-factories-control-"));
  const store = new ControlDecisionStore({ storagePath: join(dir, "decisions.json") });
  const decision = makeControlDecision(state, [candidate], undefined, 42);
  store.save(decision);
  let expectedConfigVersion: number | undefined;
  const adapter = { apply: async (_candidate: ActuatorCandidate, context: { idempotencyKey: string; expectedConfigVersion: number }) => { expectedConfigVersion = context.expectedConfigVersion; } };
  await executeControlDecision(decision, adapter, store);
  assert.equal(expectedConfigVersion, 42);
});

test("actuator execution persists an unsaved plan before calling the adapter", async () => {
  const dir = await mkdtemp(join(tmpdir(), "internet-factories-control-"));
  const store = new ControlDecisionStore({ storagePath: join(dir, "decisions.json") });
  const decision = makeControlDecision(state, [candidate]);
  let wasPersistedBeforeApply = false;
  const adapter = { apply: async () => { wasPersistedBeforeApply = store.get(decision.id)?.status === "planned"; } };
  await executeControlDecision(decision, adapter, store);
  assert.equal(wasPersistedBeforeApply, true);
});

test("observing a decision persists the prediction error and observed status", async () => {
  const dir = await mkdtemp(join(tmpdir(), "internet-factories-control-"));
  const store = new ControlDecisionStore({ storagePath: join(dir, "decisions.json") });
  const decision = makeControlDecision(state, [candidate]);
  store.save(decision);
  await executeControlDecision(decision, { apply: async () => undefined }, store, "2026-10-15T12:01:00.000Z");
  const observed = observeControlDecision(decision, { ...candidate.predictedState, latencyMs: 6900 }, store, "2026-10-15T12:05:00.000Z");
  assert.equal(observed.status, "observed");
  assert.equal(store.get(decision.id)?.predictionError?.latencyMs, 100);
});

test("observation cannot skip the applied lifecycle state", async () => {
  const dir = await mkdtemp(join(tmpdir(), "internet-factories-control-"));
  const store = new ControlDecisionStore({ storagePath: join(dir, "decisions.json") });
  const decision = makeControlDecision(state, [candidate]);
  store.save(decision);
  assert.throws(() => observeControlDecision(decision, candidate.predictedState, store), /must be applied/);
});
