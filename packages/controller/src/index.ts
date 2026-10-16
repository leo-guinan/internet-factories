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
  for (const violation of assessment.violations) {
    if (actions.length >= maxActions) break;
    const actuator = actuators.find((candidate) => {
      const effect = candidate.effects[violation.metric];
      return candidate.addresses.includes(violation.metric) && effect !== undefined && effect !== 0;
    });
    if (!actuator) continue;
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
  }
  return actions;
}
