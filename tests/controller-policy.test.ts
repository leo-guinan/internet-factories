import assert from "node:assert/strict";
import { test } from "node:test";
import { assessOperatingEnvelope, proposeControlActions, type OperatingEnvelope } from "../packages/controller/src/index.js";

const envelope: OperatingEnvelope = { qualityMin: 0.9, costMaxUsd: 1, latencyMaxMs: 5000, throughputMinPerHour: 10, failureRateMax: 0.1, retryRateMax: 0.2, recoveryEfficiencyMin: 0.5 };

test("controller proposes bounded actions for envelope violations", () => {
  const assessment = assessOperatingEnvelope(envelope, { quality: 0.7, costUsd: 1.4, latencyMs: 7000, throughputPerHour: 4, failureRate: 0.3, retryRate: 0.4, recoveryEfficiency: 0.1 });
  const actions = proposeControlActions(assessment, { maxAdjustment: 0.25 });
  assert.deepEqual(actions.map((action) => action.type), ["quality", "throughputPerHour", "recoveryEfficiency", "costUsd", "latencyMs", "failureRate", "retryRate"]);
  assert.ok(actions.every((action) => action.adjustment >= 0 && action.adjustment <= 0.25));
});

test("controller emits no action inside the envelope", () => {
  const assessment = assessOperatingEnvelope(envelope, { quality: 0.95, costUsd: 0.4, latencyMs: 2000, throughputPerHour: 20, failureRate: 0.02, retryRate: 0.05, recoveryEfficiency: 0.8 });
  assert.deepEqual(proposeControlActions(assessment), []);
});
