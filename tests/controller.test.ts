import assert from "node:assert/strict";
import { test } from "node:test";
import { assessOperatingEnvelope, type OperatingEnvelope } from "../packages/controller/src/index.js";

const envelope: OperatingEnvelope = { qualityMin: 0.9, costMaxUsd: 1, latencyMaxMs: 5000, throughputMinPerHour: 10, failureRateMax: 0.1, retryRateMax: 0.2, recoveryEfficiencyMin: 0.5 };

test("operating envelope reports a stable factory without choosing an action", () => {
  const assessment = assessOperatingEnvelope(envelope, { quality: 0.95, costUsd: 0.4, latencyMs: 2000, throughputPerHour: 20, failureRate: 0.02, retryRate: 0.05, recoveryEfficiency: 0.8 });
  assert.equal(assessment.withinEnvelope, true);
  assert.deepEqual(assessment.violations, []);
});

test("operating envelope exposes each measured error", () => {
  const assessment = assessOperatingEnvelope(envelope, { quality: 0.7, costUsd: 1.4, latencyMs: 7000, throughputPerHour: 4, failureRate: 0.3, retryRate: 0.4, recoveryEfficiency: 0.1 });
  assert.equal(assessment.withinEnvelope, false);
  assert.deepEqual(assessment.violations.map((item) => item.metric).sort(), ["costUsd", "failureRate", "latencyMs", "quality", "recoveryEfficiency", "retryRate", "throughputPerHour"].sort());
  for (const [metric, expected] of Object.entries({ quality: -0.2, costUsd: 0.4, latencyMs: 2000, throughputPerHour: -6, failureRate: 0.2, retryRate: 0.2, recoveryEfficiency: -0.4 })) {
    assert.ok(Math.abs((assessment.errors[metric as keyof typeof assessment.errors] ?? 0) - expected) < 1e-12, `${metric} error`);
  }
});
