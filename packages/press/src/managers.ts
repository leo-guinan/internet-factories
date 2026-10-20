import type { Claim, CommitmentDraft, DraftAnswer, FactoryManager, ManagerContext, PreparedQuestion } from "./types.js";

/** Answers strictly from the dossier: cites exactly what the question probed and says plainly when nothing is on record. A baseline every factory gets for free. */
export function ledgerManager(options: { id?: string; name?: string; commitmentHorizonDays?: number } = {}): FactoryManager {
  const horizon = options.commitmentHorizonDays ?? 7;
  return {
    id: options.id ?? "ledger-manager",
    name: options.name ?? "Factory manager (ledger)",
    async openingStatement(ctx) {
      const runs = ctx.dossier.runs ?? [];
      const claims: Claim[] = [];
      if (runs.length) claims.push({ statement: `${runs.length} run(s) recorded this period`, evidence: runs.slice(0, 12).map((r) => ({ kind: "run", id: r.id })) });
      for (const o of ctx.dossier.objectives ?? []) claims.push({ statement: `working toward ${o.target} ${o.unit}${o.unit === o.metric ? "" : ` of ${o.metric}`} per ${o.window.duration}`, evidence: [{ kind: "objective", id: o.id }] });
      return claims.length ? { text: `This is the record for ${ctx.plan.factoryName}. ${claims.map((c) => c.statement).join("; ")}. Everything I say today points at an entry in the ledger.`, claims } : { text: `${ctx.plan.factoryName} has nothing on its ledger this period. I'll take questions anyway.`, claims: [] };
    },
    async answer(question: PreparedQuestion, ctx: ManagerContext): Promise<DraftAnswer> {
      if (question.about === "final") {
        const graded = (ctx.dossier.runs ?? []).filter((r) => typeof r.qualityScore === "number");
        if (graded.length) return { text: "The quality scores. Our own evaluator grades them and nothing outside the factory has checked them yet.", claims: [{ statement: `quality on ${graded.length} run(s) is self-graded`, evidence: graded.slice(0, 12).map((r) => ({ kind: "run" as const, id: r.id })) }] };
        return { text: "Anything I'd claim about whether this factory works. There's no run on record to point to.", claims: [] };
      }
      const entries = question.probes.map((ref) => ctx.resolve(ref)).filter((e) => !!e);
      if (!entries.length) return { text: "There's nothing on the record that answers that yet. I won't guess.", claims: [] };
      return { text: "For the record: " + entries.slice(0, 4).map((e) => e!.summary).join(". ") + (entries.length > 4 ? `. Plus ${entries.length - 4} more entries.` : "."), claims: entries.map((e) => ({ statement: e!.summary, evidence: [e!.ref] })) };
    },
    async commit(ctx): Promise<CommitmentDraft[]> {
      const due = new Date(Date.parse(ctx.dossier.period.end) + horizon * 86_400_000).toISOString();
      return (ctx.dossier.objectives ?? []).map((o) => ({ statement: `reach ${o.target} ${o.unit}${o.unit === o.metric ? "" : ` of ${o.metric}`} per ${o.window.duration}`, metric: o.metric, target: o.target, unit: o.unit, due, objectiveId: o.id }));
    }
  };
}

export interface ManagerScript {
  opening?: DraftAnswer;
  /** Keyed by question id, `${reporterId}:${about}`, or `about`. Follow-ups use `${questionId}-f1`, `-f2`. */
  answers?: Record<string, DraftAnswer>;
  commitments?: CommitmentDraft[];
}

/** Answers a person (or agent) wrote in advance or live. Anything unscripted goes to the fallback, or is recorded as declined. */
export function scriptedManager(identity: { id: string; name: string }, script: ManagerScript, fallback?: FactoryManager): FactoryManager {
  return {
    ...identity,
    async openingStatement(ctx) { return script.opening ?? (await fallback?.openingStatement?.(ctx)) ?? { text: "", claims: [], declined: true }; },
    async answer(question, ctx) {
      const base = question.id.replace(/-f\d+$/, "");
      const key = [question.id, `${question.reporterId}:${question.about}`, question.about].find((k) => script.answers?.[k] && (question.id === base || k === question.id));
      if (key) return script.answers![key];
      return fallback ? fallback.answer(question, ctx) : { text: "", claims: [], declined: true };
    },
    async commit(ctx) { return script.commitments ?? (await fallback?.commit?.(ctx)) ?? []; }
  };
}
