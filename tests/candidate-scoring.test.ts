import assert from "node:assert/strict";
import { test } from "node:test";
import { rankActuatorCandidates, type ActuatorResponseModel, type ActuatorSpec, type ObservedFactoryState, type OperatingEnvelope } from "../packages/controller/src/index.js";

const envelope: OperatingEnvelope = { qualityMin: 0.9, costMaxUsd: 1.1, latencyMaxMs: 5000, throughputMinPerHour: 10 };
const current: ObservedFactoryState = { quality: 0.9, costUsd: 1, latencyMs: 7000, throughputPerHour: 4, failureRate: 0, retryRate: 0, recoveryEfficiency: 0 };
const actuators: ActuatorSpec[] = [
  { id: "parallelism", variable: "parallelism", kind: "number", value: 2, min: 1, max: 8, step: 1, addresses: ["throughputPerHour", "latencyMs"], effects: { throughputPerHour: 1, latencyMs: -1 } },
  { id: "model", variable: "model", kind: "choice", value: "small", options: ["small", "large"], addresses: ["quality", "costUsd"], effects: { quality: 1, costUsd: 1 } }
];
const responses: ActuatorResponseModel[] = [
  { actuatorId: "parallelism", sampleCount: 200, responsePerUnit: { quality: 0, costUsd: 0.03, latencyMs: -200, throughputPerHour: 7, failureRate: 0.004, retryRate: 0, recoveryEfficiency: 0 } },
  { actuatorId: "model", sampleCount: 200, responsePerUnit: { quality: 0.08, costUsd: 0.2, latencyMs: 400, throughputPerHour: 0, failureRate: 0, retryRate: 0, recoveryEfficiency: 0 } }
];

test("candidate ranking predicts the whole envelope before choosing an actuator", () => {
  const ranked = rankActuatorCandidates(envelope, current, actuators, responses);
  assert.equal(ranked[0].actuatorId, "parallelism");
  assert.equal(ranked[0].delta, 1);
  assert.equal(ranked[0].predictedState.throughputPerHour, 11);
  assert.equal(ranked[0].predictedState.latencyMs, 6800);
  assert.equal(ranked[0].predictedAssessment.violations.some((v) => v.metric === "throughputPerHour"), false);
  assert.equal(ranked[1].actuatorId, "model");
  assert.ok(ranked[0].score < ranked[1].score);
});

test("candidate ranking ignores actuators without learned response data", () => {
  assert.deepEqual(rankActuatorCandidates(envelope, current, actuators, []).map((candidate) => candidate.actuatorId), []);
});
