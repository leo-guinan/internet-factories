import { executeFactory, type FactoryFunction, type FactoryRun } from "../../../packages/runtime/src/index.js";
import type { FactoryObjective, FactoryObservation } from "../../../packages/objectives/src/index.js";
import { createLinkedInDraftFactory } from "../../../factories/linkedin-draft/factory.js";
import type { InsightInput } from "../../../factories/linkedin-draft/schemas.js";
import type { FactoryDossier } from "../../../packages/press/src/index.js";

const insight = (n: number): InsightInput => ({
  insightId: `insight-${n}`, campaignId: "attention-factory", sourceText: "Factories that answer to a press corps get better faster.",
  audience: "founders running agent teams", coreClaim: "Accountable factories improve faster than unaccountable ones",
  supportingEvidence: ["Every answer at the presser cites a run, artifact or observation"], targetAction: "read the build log", destinationUrl: "https://example.com/log",
  sixPs: { people: "founders running agent teams", positioning: "accountable factories", promise: "improve faster", proof: ["every answer cites a run"], priority: "accountability this week", process: "weekly press conference" }
});

export async function linkedinRuns(count: number, startedAt: string): Promise<FactoryRun[]> {
  const factory = createLinkedInDraftFactory({ async generate(input) {
    return { costUsd: 0.012, draft: { insightId: input.insightId, campaignId: input.campaignId, hook: "Founders running agent teams: accountable factories improve faster.", body: `For ${input.audience}: accountable factories improve faster than unaccountable ones. ${input.supportingEvidence[0]}. Accountability this week comes from a weekly press conference.`, cta: "Read the build log this week", targetAction: input.targetAction, destinationUrl: input.destinationUrl } };
  } });
  const runs: FactoryRun[] = [];
  for (let i = 0; i < count; i++) { const input = insight(i); const run = await executeFactory(factory.spec, factory.functions, input, { runId: `run_li_${startedAt.slice(0, 10)}_${i}`, quality: factory.quality }); run.startedAt = startedAt; runs.push(run); }
  return runs;
}

/** A small research factory with a flaky fetch node and a summarizer that is not deterministic, so the film room and Nia have something to find. */
export async function researchRuns(count: number, startedAt: string): Promise<FactoryRun[]> {
  let calls = 0;
  const functions: Record<string, FactoryFunction> = {
    fetch: { async execute(input) { calls += 1; if (calls % 3 === 1) throw new Error("upstream timeout after 30s"); return { output: { topic: input, sources: 3 }, costUsd: 0.004 }; } },
    summarize: { async execute(_input, ctx) { return { output: { brief: `Brief drafted on attempt ${ctx.attempt} at ${ctx.executionId.slice(-4)}` }, costUsd: 0.03 }; } }
  };
  const spec = { id: "research-factory", version: "1", minimumQuality: 0.85, nodes: [{ id: "fetch", functionId: "fetch", functionVersion: "1", maxAttempts: 2 }, { id: "summarize", functionId: "summarize", functionVersion: "1", dependsOn: ["fetch"] }] };
  const runs: FactoryRun[] = [];
  for (let i = 0; i < count; i++) { const run = await executeFactory(spec, functions, "agent accountability", { runId: `run_rs_${startedAt.slice(0, 10)}_${i}`, quality: () => (i === 1 ? 0.6 : 0.9) }); run.startedAt = startedAt; runs.push(run); }
  return runs;
}

export const impressions: FactoryObjective = { id: "obj-impressions", factoryId: "linkedin-draft", metric: "impressions", target: 1000, unit: "impressions", window: { duration: "day", timezone: "America/New_York" }, constraints: { maxActionsPerWindow: 3 } };

export const observation = (id: string, value: number, observedAt: string, confidence = 0.95): FactoryObservation => ({ id, objectiveId: impressions.id, metric: "impressions", value, measurement: "cumulative_snapshot", subjectId: "account", scope: "account", period: { start: observedAt.slice(0, 10) + "T00:00:00.000Z", end: observedAt.slice(0, 10) + "T23:59:59.999Z" }, periodKind: "calendar_day_to_date", observedAt, sourceId: "attention-lens:notifications", confidence });

export async function demoWeek(week: 1 | 2): Promise<FactoryDossier[]> {
  const period = week === 1 ? { start: "2026-10-12T00:00:00.000Z", end: "2026-10-18T23:59:59.999Z" } : { start: "2026-10-19T00:00:00.000Z", end: "2026-10-25T23:59:59.999Z" };
  const startedAt = week === 1 ? "2026-10-14T15:00:00.000Z" : "2026-10-21T15:00:00.000Z";
  return [
    { factoryId: "linkedin-draft", factoryName: "LinkedIn Draft Factory", managerId: "leo", period, runs: await linkedinRuns(week === 1 ? 2 : 4, startedAt), objectives: [impressions], observations: week === 1 ? [observation("obs-w1", 412, "2026-10-17T20:00:00.000Z")] : [observation("obs-w2a", 640, "2026-10-22T20:00:00.000Z"), observation("obs-w2b", 870, "2026-10-24T20:00:00.000Z")] },
    { factoryId: "research-factory", factoryName: "Research Factory", managerId: "leo", period, runs: await researchRuns(3, startedAt) }
  ];
}
