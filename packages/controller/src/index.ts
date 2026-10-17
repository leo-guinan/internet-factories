export interface OperatingEnvelope {
  qualityMin?: number;
  costMaxUsd?: number;
  latencyMaxMs?: number;
  throughputMinPerHour?: number;
  failureRateMax?: number;
  retryRateMax?: number;
  recoveryEfficiencyMin?: number;
}

export interface ObservedFactoryState {
  quality: number;
  costUsd: number;
  latencyMs: number;
  throughputPerHour: number;
  failureRate: number;
  retryRate: number;
  recoveryEfficiency: number;
}

export interface EnvelopeViolation { metric: keyof ObservedFactoryState; observed: number; target: number; error: number; }
export interface EnvelopeAssessment { withinEnvelope: boolean; violations: EnvelopeViolation[]; errors: Partial<Record<keyof ObservedFactoryState, number>>; }
export interface ControlAction { type: keyof ObservedFactoryState; adjustment: number; direction: "increase" | "decrease"; reason: string; }
export interface ControlPolicy { maxAdjustment?: number; }
export interface ActuatorSpec { id: string; variable: string; kind: "number" | "choice"; value: number | string; min?: number; max?: number; step?: number; options?: string[]; addresses: Array<keyof ObservedFactoryState>; effects: Partial<Record<keyof ObservedFactoryState, -1 | 0 | 1>>; }
export interface ActuatorAction { actuatorId: string; variable: string; from: number | string; to: number | string; metric: keyof ObservedFactoryState; reason: string; }
export interface ObservationSnapshot { state: ObservedFactoryState; sampleCount: number; windowSize: number; confidence: number; observedAt?: string; }
export interface ObservationWindowOptions { alpha?: number; maxSamples?: number; minSamplesForConfidence?: number; }
export interface ActuatorChangeInput { actuatorId: string; from: number; to: number; stateBefore: ObservedFactoryState; stateAfter: ObservedFactoryState; sampleCount: number; observedAt?: string; }
export interface ActuatorObservation { actuatorId: string; from: number; to: number; stateBefore: ObservedFactoryState; stateAfter: ObservedFactoryState; delta: ObservedFactoryState; sampleCount: number; observedAt?: string; }
export interface ActuatorResponseModel { actuatorId: string; sampleCount: number; responsePerUnit: ObservedFactoryState; }

export function assessOperatingEnvelope(envelope: OperatingEnvelope, observed: ObservedFactoryState): EnvelopeAssessment {
  const errors: Partial<Record<keyof ObservedFactoryState, number>> = {};
  const violations: EnvelopeViolation[] = [];
  const minimums: Array<[keyof ObservedFactoryState, number | undefined]> = [
    ["quality", envelope.qualityMin], ["throughputPerHour", envelope.throughputMinPerHour], ["recoveryEfficiency", envelope.recoveryEfficiencyMin]
  ];
  const maximums: Array<[keyof ObservedFactoryState, number | undefined]> = [
    ["costUsd", envelope.costMaxUsd], ["latencyMs", envelope.latencyMaxMs], ["failureRate", envelope.failureRateMax], ["retryRate", envelope.retryRateMax]
  ];
  for (const [metric, target] of minimums) {
    if (target === undefined) continue;
    const error = observed[metric] - target;
    errors[metric] = error;
    if (error < 0) violations.push({ metric, observed: observed[metric], target, error });
  }
  for (const [metric, target] of maximums) {
    if (target === undefined) continue;
    const error = observed[metric] - target;
    errors[metric] = error;
    if (error > 0) violations.push({ metric, observed: observed[metric], target, error });
  }
  return { withinEnvelope: violations.length === 0, violations, errors };
}

export function proposeControlActions(assessment: EnvelopeAssessment, policy: ControlPolicy = {}): ControlAction[] {
  const maxAdjustment = policy.maxAdjustment ?? 0.25;
  if (!Number.isFinite(maxAdjustment) || maxAdjustment < 0) throw new Error("maxAdjustment must be a non-negative finite number");
  return assessment.violations.map((violation) => {
    const adjustment = Math.min(maxAdjustment, Math.abs(violation.error) / Math.max(Math.abs(violation.target), 1));
    const minimumMetric = violation.metric === "quality" || violation.metric === "throughputPerHour" || violation.metric === "recoveryEfficiency";
    return {
      type: violation.metric,
      adjustment,
      direction: minimumMetric ? "increase" : "decrease",
      reason: `${violation.metric} is outside its operating envelope by ${Math.abs(violation.error)}`
    };
  });
}

export function chooseActuatorActions(assessment: EnvelopeAssessment, actuators: ActuatorSpec[], policy: { maxActions?: number; maxAdjustment?: number } = {}): ActuatorAction[] {
  const maxActions = policy.maxActions ?? assessment.violations.length;
  const maxAdjustment = policy.maxAdjustment ?? 0.25;
  if (!Number.isInteger(maxActions) || maxActions < 0) throw new Error("maxActions must be a non-negative integer");
  if (!Number.isFinite(maxAdjustment) || maxAdjustment < 0) throw new Error("maxAdjustment must be a non-negative finite number");
  const actions: ActuatorAction[] = [];
  const usedActuators = new Set<string>();
  for (const violation of assessment.violations) {
    if (actions.length >= maxActions) break;
    const actuator = actuators.find((candidate) => {
      const effect = candidate.effects[violation.metric];
      return candidate.addresses.includes(violation.metric) && effect !== undefined && effect !== 0;
    });
    if (!actuator || usedActuators.has(actuator.id)) continue;
    const effect = actuator.effects[violation.metric]!;
    const minimum = violation.metric === "quality" || violation.metric === "throughputPerHour" || violation.metric === "recoveryEfficiency";
    const desiredEffect = minimum ? 1 : -1;
    const direction = desiredEffect * effect;
    let next: number | string;
    if (actuator.kind === "number") {
      if (typeof actuator.value !== "number") throw new Error(`Numeric actuator ${actuator.id} has a non-numeric value`);
      const step = actuator.step ?? 1;
      const magnitude = Math.max(step, Math.abs(violation.error) / Math.max(Math.abs(violation.target), 1) * maxAdjustment);
      next = actuator.value + direction * magnitude;
      if (actuator.min !== undefined) next = Math.max(actuator.min, next);
      if (actuator.max !== undefined) next = Math.min(actuator.max, next);
      if (next === actuator.value) continue;
    } else {
      if (!actuator.options?.length) continue;
      const index = actuator.options.indexOf(String(actuator.value));
      const nextIndex = index + direction;
      if (index < 0 || nextIndex < 0 || nextIndex >= actuator.options.length) continue;
      next = actuator.options[nextIndex];
    }
    const bound = minimum ? "minimum" : "maximum";
    actions.push({ actuatorId: actuator.id, variable: actuator.variable, from: actuator.value, to: next, metric: violation.metric, reason: `${violation.metric} is ${minimum ? "below" : "above"} its ${bound} by ${Math.abs(violation.error)}` });
    usedActuators.add(actuator.id);
  }
  return actions;
}

export function createObservationWindow(options: ObservationWindowOptions = {}) {
  const alpha = options.alpha ?? 0.25;
  const maxSamples = options.maxSamples ?? 100;
  const minSamplesForConfidence = options.minSamplesForConfidence ?? 10;
  if (!Number.isFinite(alpha) || alpha <= 0 || alpha > 1) throw new Error("alpha must be greater than 0 and no greater than 1");
  if (!Number.isInteger(maxSamples) || maxSamples < 1) throw new Error("maxSamples must be a positive integer");
  if (!Number.isInteger(minSamplesForConfidence) || minSamplesForConfidence < 1) throw new Error("minSamplesForConfidence must be a positive integer");
  const samples: Array<{ state: ObservedFactoryState; observedAt?: string }> = [];
  let smoothed: ObservedFactoryState | undefined;
  let sampleCount = 0;
  const snapshot = (): ObservationSnapshot | undefined => smoothed ? { state: { ...smoothed }, sampleCount, windowSize: samples.length, confidence: Math.min(1, sampleCount / minSamplesForConfidence), observedAt: samples.at(-1)?.observedAt } : undefined;
  return {
    add(state: ObservedFactoryState, observedAt?: string) {
      smoothed = smoothed ? Object.fromEntries(Object.keys(smoothed).map((key) => [key, smoothed![key as keyof ObservedFactoryState] + alpha * (state[key as keyof ObservedFactoryState] - smoothed![key as keyof ObservedFactoryState])])) as unknown as ObservedFactoryState : { ...state };
      samples.push({ state: { ...state }, observedAt });
      if (samples.length > maxSamples) samples.shift();
      sampleCount += 1;
      return snapshot()!;
    },
    snapshot
  };
}

const observationMetrics: Array<keyof ObservedFactoryState> = ["quality", "costUsd", "latencyMs", "throughputPerHour", "failureRate", "retryRate", "recoveryEfficiency"];
const rounded = (value: number) => Math.round(value * 1e12) / 1e12;

export function observeActuatorChange(input: ActuatorChangeInput): ActuatorObservation {
  if (!Number.isFinite(input.from) || !Number.isFinite(input.to) || input.from === input.to) throw new Error("actuator change must have distinct finite numeric values");
  if (!Number.isInteger(input.sampleCount) || input.sampleCount < 1) throw new Error("sampleCount must be a positive integer");
  const delta = Object.fromEntries(observationMetrics.map((metric) => [metric, rounded(input.stateAfter[metric] - input.stateBefore[metric])])) as unknown as ObservedFactoryState;
  return { ...input, delta };
}

export function learnActuatorResponses(observations: ActuatorObservation[]): ActuatorResponseModel[] {
  const groups = new Map<string, ActuatorObservation[]>();
  for (const observation of observations) groups.set(observation.actuatorId, [...(groups.get(observation.actuatorId) ?? []), observation]);
  return [...groups.entries()].map(([actuatorId, group]) => {
    const responsePerUnit = Object.fromEntries(observationMetrics.map((metric) => [metric, rounded(group.reduce((sum, observation) => sum + observation.delta[metric] / (observation.to - observation.from), 0) / group.length)])) as unknown as ObservedFactoryState;
    return { actuatorId, sampleCount: group.length, responsePerUnit };
  });
}
