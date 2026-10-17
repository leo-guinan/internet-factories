import assert from "node:assert/strict";
import { test } from "node:test";
import { learnActuatorResponses, observeActuatorChange, type ObservedFactoryState } from "../packages/controller/src/index.js";

const before: ObservedFactoryState = { quality: 0.9, costUsd: 1, latencyMs: 1000, throughputPerHour: 10, failureRate: 0.1, retryRate: 0.1, recoveryEfficiency: 0.5 };
const after: ObservedFactoryState = { quality: 0.91, costUsd: 1.03, latencyMs: 800, throughputPerHour: 17, failureRate: 0.104, retryRate: 0.1, recoveryEfficiency: 0.5 };

test("actuator observation records a multivariate response", () => {
  const observation = observeActuatorChange({ actuatorId: "parallelism", from: 2, to: 3, stateBefore: before, stateAfter: after, sampleCount: 20, observedAt: "2026-10-15T12:00:00.000Z" });
  assert.deepEqual(observation.delta, { quality: 0.01, costUsd: 0.03, latencyMs: -200, throughputPerHour: 7, failureRate: 0.004, retryRate: 0, recoveryEfficiency: 0 });
  assert.equal(observation.actuatorId, "parallelism");
});

test("response learner estimates delta output per actuator unit", () => {
  const first = observeActuatorChange({ actuatorId: "parallelism", from: 2, to: 3, stateBefore: before, stateAfter: after, sampleCount: 20 });
  const second = observeActuatorChange({ actuatorId: "parallelism", from: 3, to: 4, stateBefore: after, stateAfter: { ...after, quality: 0.92, costUsd: 1.06, latencyMs: 600, throughputPerHour: 24, failureRate: 0.108 }, sampleCount: 20 });
  const models = learnActuatorResponses([first, second]);
  assert.deepEqual(models, [{ actuatorId: "parallelism", sampleCount: 2, responsePerUnit: { quality: 0.01, costUsd: 0.03, latencyMs: -200, throughputPerHour: 7, failureRate: 0.004, retryRate: 0, recoveryEfficiency: 0 } }]);
});
