import type { FactoryRun, NodeRun } from "../../runtime/src/index.js";
import { EvidenceIndex, objectiveProgress } from "./evidence.js";
import type { EvidenceRef, FactoryDossier, LensId, QuestionDraft, ReporterPersona, ScoredCommitment } from "./types.js";

export interface LensContext { dossier: FactoryDossier; index: EvidenceIndex; scoreboard: ScoredCommitment[]; facts: FactoryFacts; }

export interface FactoryFacts {
  runs: FactoryRun[]; attempted: number; completed: number; rejected: number; failed: number; accepted: number;
  totalCostUsd: number; recoveryCostUsd: number; costPerAccepted?: number; avgQuality?: number;
  failedNodes: NodeRun[]; retriedNodes: NodeRun[]; reusedNodes: NodeRun[];
  divergent: Array<{ key: string; nodes: NodeRun[] }>;
  externalObservations: number;
}

const pct = (n: number) => `${Math.round(n * 100)}%`;
const usd = (n: number) => `$${n.toFixed(n < 1 ? 4 : 2)}`;
const runRefs = (runs: FactoryRun[], max = 12): EvidenceRef[] => runs.slice(0, max).map((r) => ({ kind: "run", id: r.id }));

export function factoryFacts(dossier: FactoryDossier): FactoryFacts {
  const runs = (dossier.runs ?? []).filter((r) => !r.startedAt || (r.startedAt >= dossier.period.start && r.startedAt <= dossier.period.end));
  const nodes = runs.flatMap((r) => r.nodeRuns);
  const accepted = runs.reduce((s, r) => s + r.artifacts.length, 0);
  const totalCostUsd = runs.reduce((s, r) => s + r.totalCostUsd, 0);
  const graded = runs.filter((r) => typeof r.qualityScore === "number");
  const groups = new Map<string, NodeRun[]>();
  for (const n of nodes.filter((n) => n.status === "completed" && n.inputHash && n.outputHash && !n.reused)) {
    const key = `${n.functionId}@${n.functionVersion}:${n.inputHash}`;
    groups.set(key, [...(groups.get(key) ?? []), n]);
  }
  return {
    runs, attempted: runs.length,
    completed: runs.filter((r) => r.status === "completed").length,
    rejected: runs.filter((r) => r.status === "rejected").length,
    failed: runs.filter((r) => r.status === "failed").length,
    accepted, totalCostUsd,
    recoveryCostUsd: runs.reduce((s, r) => s + r.recoveryCostUsd, 0),
    costPerAccepted: accepted ? totalCostUsd / accepted : undefined,
    avgQuality: graded.length ? graded.reduce((s, r) => s + (r.qualityScore ?? 0), 0) / graded.length : undefined,
    failedNodes: nodes.filter((n) => n.status === "failed"),
    retriedNodes: nodes.filter((n) => n.attempt > 1),
    reusedNodes: nodes.filter((n) => n.reused),
    divergent: [...groups.entries()].filter(([, ns]) => new Set(ns.map((n) => n.outputHash)).size > 1).map(([key, ns]) => ({ key, nodes: ns })),
    externalObservations: (dossier.observations ?? []).length + (dossier.external ?? []).length
  };
}

type Lens = (ctx: LensContext, persona: ReporterPersona) => QuestionDraft[];

const scoreboard: Lens = (ctx, persona) => {
  const out: QuestionDraft[] = [];
  const { facts, dossier } = ctx;
  for (const s of ctx.scoreboard) {
    const c = s.commitment;
    const shown = s.actual === undefined ? "the ledger has no number" : `the ledger shows ${s.actual} ${c.unit}`;
    const verdict = s.status === "unknown" && persona.rights.refusesUnevidencedWins ? "Until there's evidence, I'm scoring it unknown." : `That reads as ${s.status}.`;
    if (s.status === "pending") continue;
    out.push({ lens: "scoreboard", about: `commitment:${c.id}`, priority: s.status === "achieved" ? 70 : 95, text: `Last time you committed to "${c.statement}", due ${c.due.slice(0, 10)}. ${shown[0].toUpperCase()}${shown.slice(1)}. ${verdict} Do you agree with that grade?`, probes: [{ kind: "commitment", id: c.id }, ...s.evidence] });
  }
  for (const objective of dossier.objectives ?? []) {
    const progress = objectiveProgress(objective, dossier.observations ?? [], dossier.period);
    if (!progress) out.push({ lens: "scoreboard", about: `objective:${objective.id}`, priority: 90, text: `Your objective is ${objective.target} ${objective.unit} per ${objective.window.duration}. There is no account-level observation of ${objective.metric} in this period. What's the number, and where is it recorded?`, probes: [{ kind: "objective", id: objective.id }] });
    else out.push({ lens: "scoreboard", about: `objective:${objective.id}`, priority: progress.value >= objective.target ? 60 : 85, text: `The target is ${objective.target} ${objective.unit} per ${objective.window.duration}. The latest measurement says ${progress.value}. ${progress.value >= objective.target ? "Target met. What did it cost to get there?" : `That's ${pct(progress.value / objective.target)} of target. What closes the gap?`}`, probes: [{ kind: "objective", id: objective.id }, ...progress.used.map((o) => ({ kind: "observation" as const, id: o.id }))] });
  }
  if (!(dossier.objectives ?? []).length) out.push({ lens: "scoreboard", about: "no-objective", priority: 88, text: `This factory has no stated objective. What number should we hold you to next week?`, probes: [] });
  if (facts.attempted) out.push({ lens: "scoreboard", about: "yield", priority: 65, text: `${facts.attempted} run(s) attempted, ${facts.accepted} artifact(s) accepted. That's a ${pct(facts.accepted / facts.attempted)} yield. Is that the yield you expected?`, probes: runRefs(facts.runs) });
  else out.push({ lens: "scoreboard", about: "no-runs", priority: 80, text: `The ledger shows zero runs this period. Was this factory switched off, or did it run somewhere we can't see?`, probes: [] });
  return out;
};

const film: Lens = (ctx) => {
  const out: QuestionDraft[] = [];
  const { facts, dossier } = ctx;
  const worst = [...facts.failedNodes].sort((a, b) => b.attempt - a.attempt)[0];
  if (worst) out.push({ lens: "film", about: `node:${worst.id}`, priority: 90, text: `Freeze it at node "${worst.nodeId}" in run ${worst.factoryRunId}. Attempt ${worst.attempt} failed with "${worst.error?.message ?? "unknown error"}". What happened there, and what changed afterwards?`, probes: [{ kind: "node_run", id: worst.id }, { kind: "run", id: worst.factoryRunId }] });
  const rejected = facts.runs.find((r) => r.status === "rejected");
  if (rejected) out.push({ lens: "film", about: `rejected:${rejected.id}`, priority: 80, text: `Run ${rejected.id} finished but was rejected at quality ${rejected.qualityScore ?? "n/a"}. Was the evaluator right to throw that away?`, probes: [{ kind: "run", id: rejected.id }] });
  for (const decision of (dossier.decisions ?? []).filter((d) => d.action !== "observe").slice(0, 2)) out.push({ lens: "film", about: `decision:${decision.id}`, priority: 75, text: `On ${decision.decidedAt.slice(0, 10)} the controller chose to ${decision.action} because "${decision.reason}". Walk us through that call. Would you make it again?`, probes: [{ kind: "decision", id: decision.id }, ...decision.evidenceIds.slice(0, 6).map((id) => ({ kind: "observation" as const, id }))] });
  if (!out.length) out.push({ lens: "film", about: "no-tape", priority: 50, text: facts.attempted ? `Every run this period completed cleanly. Which decision were you least sure about?` : `There's no tape to review this week. What should we be watching next week?`, probes: runRefs(facts.runs, 3) });
  return out;
};

const business: Lens = (ctx) => {
  const { facts } = ctx;
  const out: QuestionDraft[] = [];
  if (facts.costPerAccepted !== undefined) out.push({ lens: "business", about: "unit-cost", priority: 85, text: `You spent ${usd(facts.totalCostUsd)} for ${facts.accepted} accepted artifact(s): ${usd(facts.costPerAccepted)} each. What is one of those artifacts worth to whoever receives it?`, probes: runRefs(facts.runs) });
  else if (facts.attempted) out.push({ lens: "business", about: "spend-no-output", priority: 92, text: `${usd(facts.totalCostUsd)} spent across ${facts.attempted} run(s) and nothing accepted. What did that money buy?`, probes: runRefs(facts.runs) });
  if (facts.recoveryCostUsd > 0 || facts.retriedNodes.length) out.push({ lens: "business", about: "rework", priority: 70, text: `${facts.retriedNodes.length} retried node attempt(s)${facts.recoveryCostUsd > 0 ? ` and ${usd(facts.recoveryCostUsd)} in recovery spend` : ""}. Is rework a cost of doing business here, or a leak?`, probes: facts.retriedNodes.slice(0, 8).map((n) => ({ kind: "node_run" as const, id: n.id })) });
  if (!out.length) out.push({ lens: "business", about: "no-spend", priority: 45, text: `No spend recorded this period. What would you spend the next dollar on?`, probes: [] });
  return out;
};

const people: Lens = (ctx) => {
  const { facts, dossier } = ctx;
  const out: QuestionDraft[] = [];
  const plans = dossier.plans ?? [];
  const candidates = plans.flatMap((p) => p.candidates.map((c) => ({ plan: p, c })));
  const published = candidates.filter(({ c }) => c.published);
  if (facts.accepted) out.push({ lens: "people", about: "reach", priority: 85, text: `${facts.accepted} artifact(s) were accepted by your own evaluator. How many reached a person, and who?`, probes: facts.runs.flatMap((r) => r.artifacts).slice(0, 8).map((a) => ({ kind: "artifact" as const, id: a.id })) });
  if (candidates.length) out.push({ lens: "people", about: "approval", priority: 75, text: `${candidates.filter(({ c }) => c.approved).length} of ${candidates.length} planned candidate(s) were approved, and ${published.length} published. Who approved them, and did anyone say no?`, probes: plans.map((p) => ({ kind: "plan" as const, id: `${p.id}@${p.version}` })) });
  if (!facts.externalObservations) out.push({ lens: "people", about: "no-outside-signal", priority: 80, text: `Nothing outside the factory was recorded this period: no observations and no captured feedback. How would you know if this helped anyone?`, probes: [] });
  return out.length ? out : [{ lens: "people", about: "who-for", priority: 40, text: `Who is this factory for, in one sentence?`, probes: [] }];
};

const reproducibility: Lens = (ctx) => {
  const { facts } = ctx;
  const out: QuestionDraft[] = [];
  for (const group of facts.divergent.slice(0, 2)) out.push({ lens: "reproducibility", about: `divergent:${group.key}`, priority: 92, text: `Same function, same input hash, ${new Set(group.nodes.map((n) => n.outputHash)).size} different outputs across ${group.nodes.length} runs. Is that a creative choice or a bug?`, probes: group.nodes.slice(0, 6).map((n) => ({ kind: "node_run" as const, id: n.id })) });
  if (facts.attempted > 0 && facts.attempted < 3) out.push({ lens: "reproducibility", about: "sample-size", priority: 70, text: `That's ${facts.attempted} run(s). A sample of ${facts.attempted}. Why should we believe any of this week's numbers would hold on a rerun?`, probes: runRefs(facts.runs) });
  if (facts.reusedNodes.length) out.push({ lens: "reproducibility", about: "reuse", priority: 55, text: `${facts.reusedNodes.length} node result(s) were reused on recovery instead of recomputed. How do you know a reused result is still valid?`, probes: facts.reusedNodes.slice(0, 6).map((n) => ({ kind: "node_run" as const, id: n.id })) });
  if (!out.length) out.push({ lens: "reproducibility", about: "rerun", priority: 50, text: facts.attempted ? `If we reran this whole week tomorrow with the same inputs, what would come out different?` : `Nothing ran, so nothing can be reproduced. What's the first run you'd want repeated?`, probes: runRefs(facts.runs, 3) });
  return out;
};

const skeptic: Lens = (ctx, persona) => {
  const { facts, dossier } = ctx;
  const out: QuestionDraft[] = [];
  const prev = dossier.previousRecord;
  if (prev) {
    // The final beat asks for the manager's weakest claim, so it is excluded from carry-over: an honest gap there is the point of the question.
    const carried = prev.beats.filter((b) => b.kind !== "final").flatMap((b) => b.exchanges).filter((e) => !e.followupOf);
    const who = (ex: { reporterId: string; reporterName: string }) => (ex.reporterId === persona.id ? "I" : ex.reporterName);
    for (const ex of carried.filter((e) => e.grade.status === "contradicted").slice(0, 1)) out.push({ lens: "skeptic", about: `contradicted:${ex.id}`, priority: 99, text: `Last time you told ${ex.reporterId === persona.id ? "me" : ex.reporterName} "${ex.answer.text.slice(0, 140)}". Your own evidence contradicted the number. Do you want to correct the record?`, probes: [{ kind: "exchange", id: ex.id }] });
    for (const ex of carried.filter((e) => e.grade.status === "undocumented").slice(0, 1)) out.push({ lens: "skeptic", about: `undocumented:${ex.id}`, priority: 90, text: `Last time ${who(ex)} asked "${ex.question.slice(0, 120)}" and you answered without evidence. Can you document it now?`, probes: [{ kind: "exchange", id: ex.id }] });
  }
  if (facts.avgQuality !== undefined) out.push({ lens: "skeptic", about: "self-graded", priority: facts.externalObservations ? 70 : 88, text: `Average quality ${facts.avgQuality.toFixed(2)}, graded by your own evaluator. ${facts.externalObservations ? "Which outside measurement agrees with it?" : "Nothing outside the factory has checked it. Why should anyone trust that number?"}`, probes: runRefs(facts.runs) });
  const unknowns = ctx.scoreboard.filter((s) => s.status === "unknown");
  if (unknowns.length && persona.rights.refusesUnevidencedWins) out.push({ lens: "skeptic", about: "unknown-commitments", priority: 85, text: `${unknowns.length} commitment(s) from last time have no evidence either way. Why did you make promises you didn't plan to measure?`, probes: unknowns.map((s) => ({ kind: "commitment" as const, id: s.commitment.id })) });
  if (!out.length) out.push({ lens: "skeptic", about: "show-me", priority: 60, text: `Name one thing in this factory that someone outside it could verify today without asking you.`, probes: [] });
  return out;
};

export const lenses: Record<LensId, Lens> = { scoreboard, film, business, people, reproducibility, skeptic };

/** The final beat question is the same for every lens: it asks the manager to name their own weakest claim. */
export const finalQuestion = (persona: ReporterPersona): QuestionDraft => ({ lens: persona.lens, about: "final", priority: 100, text: `Last question. Of everything you said today, which claim would you least want audited next week, and why?`, probes: [] });
