import assert from "node:assert/strict";
import { test } from "node:test";
import { completeControlDecision, makeControlDecision, type ActuatorCandidate, type ObservedFactoryState } from "../packages/controller/src/index.js";

const state: ObservedFactoryState = { quality: 0.9, costUsd: 1, latencyMs: 7000, throughputPerHour: 4, failureRate: 0.1, retryRate: 0.1, recoveryEfficiency: 0.5 };
const noop: ActuatorCandidate = { actuatorId: "noop", variable: "none", delta: 0, predictedState: state, predictedAssessment: { withinEnvelope: false, violations: [], errors: {} }, score: 0.4 };
const action: ActuatorCandidate = { actuatorId: "parallelism", variable: "parallelism", delta: 1, predictedState: { ...state, latencyMs: 6800, throughputPerHour: 11 }, predictedAssessment: { withinEnvelope: true, violations: [], errors: {} }, score: 0.1 };

test("control decision records the selected candidate and prediction", () => {
  const decision = makeControlDecision(state, [action, noop], "2026-10-15T12:00:00.000Z");
  assert.match(decision.id, /^ctl_/);
  assert.equal(decision.selectedCandidate.actuatorId, "parallelism");
  assert.equal(decision.scoreBefore, 0.4);
  assert.equal(decision.scoreAfterPredicted, 0.1);
  assert.equal(decision.appliedAt, "2026-10-15T12:00:00.000Z");
});

test("control decision records actual response and prediction error", () => {
  const decision = makeControlDecision(state, [action, noop]);
  const completed = completeControlDecision(decision, { ...action.predictedState, latencyMs: 6900, throughputPerHour: 10 }, "2026-10-15T12:05:00.000Z");
  assert.equal(completed.observedAt, "2026-10-15T12:05:00.000Z");
  assert.equal(completed.predictionError?.latencyMs, 100);
  assert.equal(completed.predictionError?.throughputPerHour, -1);
});
