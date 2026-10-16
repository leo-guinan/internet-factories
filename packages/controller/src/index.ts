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
