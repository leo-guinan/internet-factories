import assert from "node:assert/strict";
import { test } from "node:test";
import { learnResponseFromControlDecision, observationFromControlDecision, type ActuatorCandidate, type ObservedFactoryState, type ControlDecision } from "../packages/controller/src/index.js";

const before: ObservedFactoryState = { quality: 0.9, costUsd: 1, latencyMs: 7000, throughputPerHour: 4, failureRate: 0.1, retryRate: 0.1, recoveryEfficiency: 0.5 };
const candidate: ActuatorCandidate = { actuatorId: "parallelism", variable: "parallelism", delta: 1, from: 2, to: 3, predictedState: { ...before, latencyMs: 6800, throughputPerHour: 11 }, predictedAssessment: { withinEnvelope: true, violations: [], errors: {} }, score: 0.1 };
const decision: ControlDecision = { id: "ctl_test", status: "observed", observedState: before, candidateSet: [candidate], selectedCandidate: candidate, predictedState: candidate.predictedState, scoreBefore: 1, scoreAfterPredicted: 0.1, resultingObservation: { ...before, latencyMs: 6900, throughputPerHour: 10 }, observedAt: "2026-10-15T12:05:00.000Z" };

test("observed control decision becomes actuator evidence", () => {
  const observation = observationFromControlDecision(decision);
  assert.equal(observation?.actuatorId, "parallelism");
  assert.equal(observation?.from, 2);
  assert.equal(observation?.to, 3);
  assert.equal(observation?.delta.latencyMs, -100);
});

test("control learning ignores noop decisions", () => {
  const noop = { ...decision, selectedCandidate: { ...candidate, actuatorId: "noop", variable: "none", delta: 0, from: undefined, to: undefined } };
  assert.equal(observationFromControlDecision(noop), undefined);
  assert.deepEqual(learnResponseFromControlDecision(noop), undefined);
});

test("control learning returns a response model from observed evidence", () => {
  const model = learnResponseFromControlDecision(decision);
  assert.equal(model?.actuatorId, "parallelism");
  assert.equal(model?.sampleCount, 1);
  assert.equal(model?.responsePerUnit.latencyMs, -100);
});
