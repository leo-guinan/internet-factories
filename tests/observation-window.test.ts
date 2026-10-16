import assert from "node:assert/strict";
import { test } from "node:test";
import { createObservationWindow, type ObservedFactoryState } from "../packages/controller/src/index.js";

const baseline: ObservedFactoryState = { quality: 0.9, costUsd: 1, latencyMs: 1000, throughputPerHour: 10, failureRate: 0.1, retryRate: 0.1, recoveryEfficiency: 0.5 };

test("observation window smooths noisy factory measurements with EWMA", () => {
  const window = createObservationWindow({ alpha: 0.5, maxSamples: 3 });
  window.add(baseline, "2026-10-15T12:00:00.000Z");
  const snapshot = window.add({ ...baseline, quality: 0.5, latencyMs: 5000 }, "2026-10-15T12:01:00.000Z");
  assert.equal(snapshot.sampleCount, 2);
  assert.equal(snapshot.windowSize, 2);
  assert.equal(snapshot.observedAt, "2026-10-15T12:01:00.000Z");
  assert.equal(snapshot.state.quality, 0.7);
  assert.equal(snapshot.state.latencyMs, 3000);
});

test("observation window retains bounded recent samples and reports confidence", () => {
  const window = createObservationWindow({ alpha: 1, maxSamples: 2, minSamplesForConfidence: 4 });
  window.add(baseline);
  window.add(baseline);
  window.add(baseline);
  const snapshot = window.snapshot();
  assert.equal(snapshot?.sampleCount, 3);
  assert.equal(snapshot?.windowSize, 2);
  assert.equal(snapshot?.confidence, 0.75);
});
