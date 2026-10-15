export interface ProductionMetrics { attemptedRuns: number; completedRuns: number; acceptedArtifacts: number; rejectedRuns: number; totalCostUsd: number; totalLatencyMs: number; }
export function yieldRate(m: ProductionMetrics): number { return m.attemptedRuns === 0 ? 0 : m.acceptedArtifacts / m.attemptedRuns; }
export function costPerAcceptedArtifact(m: ProductionMetrics): number { return m.acceptedArtifacts === 0 ? Infinity : m.totalCostUsd / m.acceptedArtifacts; }
export function throughput(m: ProductionMetrics, intervalMs: number): number { return intervalMs <= 0 ? 0 : m.acceptedArtifacts / (intervalMs / 3_600_000); }
