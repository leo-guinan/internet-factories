import type { NodeRun } from "../../runtime/src/index.js";
import type { EnergyReading, EnergyTotals } from "./contracts.js";

/**
 * Energy is recorded per node run in `metadata.energy`. Nothing is converted silently:
 * a step with no reading counts as unknown, and estimates keep their method.
 */
export function readEnergy(metadata: Record<string, unknown> | undefined): EnergyReading {
  const e = metadata?.energy as EnergyReading | undefined;
  if (!e || !Number.isFinite(e.wh) || e.wh < 0 || !["measured", "provider_reported", "estimated"].includes(e.source)) return { wh: 0, source: "unknown" };
  if (e.source === "estimated" && !e.method) return { wh: 0, source: "unknown" };
  return e;
}

export function energyTotals(nodeRuns: NodeRun[]): EnergyTotals {
  const totals: EnergyTotals = { measuredWh: 0, providerReportedWh: 0, estimatedWh: 0, unknownSteps: 0, methods: [] };
  for (const node of nodeRuns.filter((n) => n.status === "completed" || n.status === "failed")) {
    const e = readEnergy(node.metadata);
    if (e.source === "measured") totals.measuredWh += e.wh;
    else if (e.source === "provider_reported") totals.providerReportedWh += e.wh;
    else if (e.source === "estimated") { totals.estimatedWh += e.wh; if (!totals.methods.includes(e.method!)) totals.methods.push(e.method!); }
    else totals.unknownSteps += 1;
  }
  return totals;
}

/** A declared estimate for a provider call, e.g. { whPerCall: 0.3, method: "vendor-published 0.3 Wh/image" }. */
export interface EnergyEstimate { whPerCall?: number; whPer1kChars?: number; method: string; }
export function estimateEnergy(estimate: EnergyEstimate | undefined, chars = 0): EnergyReading | undefined {
  if (!estimate) return undefined;
  const wh = (estimate.whPerCall ?? 0) + (estimate.whPer1kChars ?? 0) * (chars / 1000);
  return { wh, source: "estimated", method: estimate.method };
}
