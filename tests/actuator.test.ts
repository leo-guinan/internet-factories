import assert from "node:assert/strict";
import { test } from "node:test";
import { assessOperatingEnvelope, chooseActuatorActions, type OperatingEnvelope, type ActuatorSpec } from "../packages/controller/src/index.js";

const envelope: OperatingEnvelope = { qualityMin: 0.9, costMaxUsd: 1, latencyMaxMs: 5000, throughputMinPerHour: 10 };
const actuators: ActuatorSpec[] = [
  { id: "parallelism", variable: "parallelism", kind: "number", value: 2, min: 1, max: 8, step: 1, addresses: ["throughputPerHour", "latencyMs"] },
  { id: "model", variable: "model", kind: "choice", value: "small", options: ["small", "large"], addresses: ["quality", "costUsd"] }
];

test("actuator selection turns metric error into an actual configurable change", () => {
  const assessment = assessOperatingEnvelope(envelope, { quality: 0.7, costUsd: 0.8, latencyMs: 2000, throughputPerHour: 4, failureRate: 0, retryRate: 0, recoveryEfficiency: 0 });
  const actions = chooseActuatorActions(assessment, actuators, { maxActions: 2, maxAdjustment: 0.25 });
  assert.deepEqual(actions, [
    { actuatorId: "model", variable: "model", from: "small", to: "large", metric: "quality", reason: "quality is below its minimum by 0.20000000000000007" },
    { actuatorId: "parallelism", variable: "parallelism", from: 2, to: 3, metric: "throughputPerHour", reason: "throughputPerHour is below its minimum by 6" }
  ]);
});

test("uncontrollable violations produce no fabricated actuator", () => {
  const assessment = assessOperatingEnvelope(envelope, { quality: 0.7, costUsd: 0.8, latencyMs: 2000, throughputPerHour: 10, failureRate: 0, retryRate: 0, recoveryEfficiency: 0 });
  assert.deepEqual(chooseActuatorActions(assessment, [], { maxActions: 3 }), []);
});
