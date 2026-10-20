import { sha256Of } from "../../runtime/src/index.js";
import { EvidenceIndex, metricFromEntry, observedValue, refKey, stableHash } from "./evidence.js";
import { factoryFacts, finalQuestion, lenses, type LensContext } from "./lenses.js";
import { assertPressCorps } from "./corps.js";
import type { AnswerGrade, BeatRecord, Commitment, CommitmentDraft, DraftAnswer, EvidenceRef, Exchange, FactoryDossier, FactoryManager, GradedClaim, ManagerContext, PreparedBeat, PreparedQuestion, PressCorps, PressPlan, PressRecord, QuestionDraft, ReporterPersona, ScoredCommitment } from "./types.js";

export const MIN_CONFIDENCE = 0.8;
const short = (value: unknown, n = 12) => sha256Of(value).slice(0, n);

// ---------------------------------------------------------------- scoreboard

/** Scores the previous record's open commitments against observations. No evidence is never a win. */
export function scoreCommitments(dossier: FactoryDossier): ScoredCommitment[] {
  const open = dossier.previousRecord?.openCommitments ?? [];
  return open.map((commitment) => {
    if (!commitment.accountable) return { commitment, status: "unknown", evidence: [], reason: "commitment was not measurable when it was made" };
    if (commitment.due > dossier.period.end) return { commitment, status: "pending", evidence: [], reason: `due ${commitment.due.slice(0, 10)}, after this period` };
    const window = (dossier.observations ?? []).filter((o) => o.metric === commitment.metric && (!commitment.objectiveId || o.objectiveId === commitment.objectiveId) && o.observedAt > commitment.madeAt && o.observedAt <= commitment.due);
    const trusted = window.filter((o) => o.confidence >= MIN_CONFIDENCE);
    if (!window.length) return { commitment, status: "unknown", evidence: [], reason: "no observation recorded between the commitment and its due date" };
    const measured = observedValue(trusted);
    if (!measured) return { commitment, status: "unknown", evidence: window.map((o) => ({ kind: "observation", id: o.id })), reason: `observations exist but none are account-level at confidence >= ${MIN_CONFIDENCE}` };
    const evidence: EvidenceRef[] = measured.used.map((o) => ({ kind: "observation", id: o.id }));
    const down = commitment.direction === "down";
    const status = down ? (measured.value <= commitment.target ? "achieved" : "missed") : measured.value >= commitment.target ? "achieved" : measured.value > 0 ? "partial" : "missed";
    return { commitment, status, actual: measured.value, evidence, reason: `${measured.value} ${commitment.unit} against ${down ? "a ceiling" : "a target"} of ${commitment.target}` };
  });
}

// ---------------------------------------------------------------- prepare

export type Phraser = (draft: QuestionDraft, persona: ReporterPersona, dossier: FactoryDossier) => Promise<string>;
export interface PrepareOptions { /** Creator-supplied press corps (personas + run of show). */ corps: PressCorps; preparedAt?: string; /** Optional rewording (e.g. an LLM in the reporter's voice). It may change wording only; probes stay fixed. */ phrase?: Phraser; }

/** Deterministic: the same dossier and corps always produce the same questions with the same ids, so answers can be written ahead of time. */
export async function preparePressConference(dossier: FactoryDossier, options: PrepareOptions): Promise<PressPlan> {
  const corps = assertPressCorps(options.corps);
  const index = new EvidenceIndex(dossier);
  const scoreboard = scoreCommitments(dossier);
  const ctx: LensContext = { dossier, index, scoreboard, facts: factoryFacts(dossier) };
  const asked = new Set<string>();
  const beats: PreparedBeat[] = [];
  for (const spec of corps.beats) {
    const questions: PreparedQuestion[] = [];
    for (const reporterId of spec.reporters) {
      const persona = corps.reporters.find((r) => r.id === reporterId);
      if (!persona) throw new Error(`beat ${spec.id} references unknown reporter ${reporterId}`);
      const drafts = spec.kind === "final" ? [finalQuestion(persona)] : spec.kind === "questions" ? lenses[persona.lens](ctx, persona).sort((a, b) => b.priority - a.priority) : [];
      for (const draft of drafts.filter((d) => !asked.has(`${persona.id}:${d.about}`)).slice(0, spec.kind === "final" ? 1 : persona.questionsPerBeat ?? 2)) {
        asked.add(`${persona.id}:${draft.about}`);
        const text = options.phrase ? await options.phrase(draft, persona, dossier) : draft.text;
        questions.push({ ...draft, text, id: `q_${short({ factory: dossier.factoryId, period: dossier.period, beat: spec.id, reporter: persona.id, about: draft.about })}`, beatId: spec.id, reporterId: persona.id, reporterName: persona.name });
      }
    }
    beats.push({ spec, questions });
  }
  return { factoryId: dossier.factoryId, factoryName: dossier.factoryName ?? dossier.factoryId, managerId: dossier.managerId, period: dossier.period, preparedAt: options.preparedAt ?? new Date().toISOString(), corpsId: corps.id, beats, scoreboard };
}

// ---------------------------------------------------------------- grading

/** An answer is documented only if every claim cites evidence that resolves in the dossier, and any number it states matches that evidence. */
export function gradeAnswer(answer: DraftAnswer, probes: EvidenceRef[], index: EvidenceIndex): AnswerGrade {
  if (answer.declined || !answer.text?.trim()) return { status: "declined", claims: [], issues: ["manager declined to answer"], addressesProbes: false };
  const issues: string[] = [];
  const claims: GradedClaim[] = (answer.claims ?? []).map((claim) => {
    const evidence = claim.evidence.map((ref) => { const entry = index.resolve(ref); return { ref, resolved: !!entry, sha256: entry?.sha256 }; });
    const graded: GradedClaim = { statement: claim.statement, evidence, metric: claim.metric, check: "supported" };
    if (!evidence.length || evidence.some((e) => !e.resolved)) {
      graded.check = "unresolved";
      graded.note = evidence.length ? `unresolved: ${evidence.filter((e) => !e.resolved).map((e) => refKey(e.ref)).join(", ")}` : "cites no evidence";
      issues.push(`claim "${claim.statement.slice(0, 60)}" ${graded.note}`);
    }
    if (claim.metric) {
      const values = claim.evidence.map((ref) => index.resolve(ref)).filter((e) => !!e).map((e) => metricFromEntry(e!, claim.metric!.name)).filter((v): v is number => v !== undefined);
      if (values.length) {
        const match = values.some((v) => Math.abs(v - claim.metric!.value) <= 1e-6 * Math.max(1, Math.abs(v)));
        graded.metricVerified = match;
        if (!match) { graded.check = "contradicted"; graded.note = `claimed ${claim.metric.name}=${claim.metric.value}; evidence says ${values.join(", ")}`; issues.push(`claim "${claim.statement.slice(0, 60)}" ${graded.note}`); }
      } else if (graded.check === "supported") { graded.check = "unresolved"; graded.note = `states ${claim.metric.name}=${claim.metric.value} but no cited evidence carries ${claim.metric.name}`; issues.push(`claim "${claim.statement.slice(0, 60)}" ${graded.note}`); }
    }
    return graded;
  });
  const probeKeys = new Set(probes.map(refKey));
  const addressesProbes = !probes.length || claims.some((c) => c.evidence.some((e) => e.resolved && probeKeys.has(refKey(e.ref))));
  if (!addressesProbes) issues.push("answer does not cite any of the evidence the question was about");
  const supported = claims.filter((c) => c.check === "supported").length;
  const status = claims.some((c) => c.check === "contradicted") ? "contradicted" : claims.length && supported === claims.length ? "documented" : supported ? "partial" : "undocumented";
  return { status, claims, issues, addressesProbes };
}

function followupText(grade: AnswerGrade, ownQuestion: boolean): string {
  const lead = ownQuestion ? "" : "Following up on that. ";
  if (grade.status === "contradicted") { const c = grade.claims.find((x) => x.check === "contradicted")!; return `${lead}You said ${c.metric!.name} was ${c.metric!.value}. The evidence you cited doesn't say that (${c.note!.split("; ")[1]}). Which number is right?`; }
  if (grade.status === "partial") { const c = grade.claims.find((x) => x.check !== "supported")!; return `${lead}Part of that is on the record. The part about "${c.statement.slice(0, 80)}" isn't. Where is the evidence for it?`; }
  return `${lead}That answer cites nothing I can check. Which run, artifact or observation backs it?`;
}

// ---------------------------------------------------------------- commitments

export function validateCommitment(draft: CommitmentDraft, heldAt: string, dossier: FactoryDossier, recordId: string): Commitment {
  const issues: string[] = [];
  if (!draft.statement?.trim()) issues.push("statement is required");
  if (!draft.metric?.trim()) issues.push("a metric is required to score it");
  if (!Number.isFinite(draft.target)) issues.push("target must be a number");
  if (Number.isNaN(Date.parse(draft.due))) issues.push("due must be a date");
  else if (draft.due <= heldAt) issues.push("due date must be after the press conference");
  const accountable = issues.length === 0;
  const tracked = (dossier.objectives ?? []).some((o) => o.metric === draft.metric && (!draft.objectiveId || o.id === draft.objectiveId));
  if (accountable && !tracked) issues.push(`warning: no objective tracks ${draft.metric}; it scores only if an observation of ${draft.metric} is recorded`);
  return { ...draft, direction: draft.direction ?? "up", id: `c_${short({ recordId, draft })}`, madeAt: heldAt, recordId, accountable, issues };
}

// ---------------------------------------------------------------- hold

export interface HoldOptions { heldAt?: string; corps: PressCorps; plan?: PressPlan; }

export function sealRecord(record: Omit<PressRecord, "hash">): PressRecord { const clean = JSON.parse(JSON.stringify(record)) as Omit<PressRecord, "hash">; return { ...clean, hash: stableHash(clean) }; }

/** Runs every beat against a manager, grades every answer, asks follow-ups, takes commitments, and seals the record. */
export async function holdPressConference(dossier: FactoryDossier, manager: FactoryManager, options: HoldOptions): Promise<PressRecord> {
  const corps = assertPressCorps(options.corps);
  const heldAt = options.heldAt ?? new Date().toISOString();
  const plan = options.plan ?? await preparePressConference(dossier, { corps, preparedAt: heldAt });
  const index = new EvidenceIndex(dossier);
  const ctx: ManagerContext = { dossier, plan, resolve: (ref) => index.resolve(ref) };
  const recordId = `prs_${short({ factory: dossier.factoryId, heldAt, manager: manager.id }, 16)}`;
  const beats: BeatRecord[] = [];
  let commitments: Commitment[] = [];
  const challenger = corps.reporters.find((r) => r.rights.challengesOthers);

  for (const prepared of plan.beats) {
    const beat: BeatRecord = { id: prepared.spec.id, name: prepared.spec.name, kind: prepared.spec.kind, exchanges: [] };
    if (prepared.spec.kind === "statement" && manager.openingStatement) { const answer = await manager.openingStatement(ctx); beat.statement = { answer, grade: gradeAnswer(answer, [], index) }; }
    if (prepared.spec.kind === "commitments") commitments = (manager.commit ? await manager.commit(ctx) : []).map((d) => validateCommitment(d, heldAt, dossier, recordId));
    for (const question of prepared.questions) {
      const persona = corps.reporters.find((r) => r.id === question.reporterId)!;
      let current: PreparedQuestion = question;
      let asker = persona;
      let followups = 0;
      for (;;) {
        const answer = await manager.answer(current, ctx);
        const grade = gradeAnswer(answer, current.probes, index);
        beat.exchanges.push({ id: current.id, beatId: beat.id, reporterId: asker.id, reporterName: asker.name, lens: asker.lens, question: current.text, probes: current.probes, answer, grade, followupOf: current === question ? undefined : question.id });
        if (grade.status === "documented" || grade.status === "declined") break;
        // A manager repeating the same answer is holding position; the record already shows it, so stop asking.
        const prior = beat.exchanges.at(-2);
        if (current !== question && prior && prior.answer.text.trim() === answer.text.trim()) break;
        const next = persona.rights.mayChallenge && followups < (persona.maxFollowups ?? 1) ? persona : challenger && challenger.id !== persona.id && followups < (challenger.maxFollowups ?? 1) ? challenger : undefined;
        if (!next) break;
        followups += 1;
        asker = next;
        current = { ...question, id: `${question.id}-f${followups}`, reporterId: next.id, reporterName: next.name, lens: next.lens, text: followupText(grade, next.id === persona.id) };
      }
    }
    beats.push(beat);
  }

  const exchanges = beats.flatMap((b) => b.exchanges);
  const count = (s: string) => exchanges.filter((e) => e.grade.status === s).length;
  const cited = new Map<string, { ref: EvidenceRef; sha256: string }>();
  const cite = (ref: EvidenceRef) => { const entry = index.resolve(ref); if (entry) cited.set(refKey(ref), { ref, sha256: entry.sha256 }); };
  for (const s of plan.scoreboard) { cite({ kind: "commitment", id: s.commitment.id }); s.evidence.forEach(cite); }
  for (const e of exchanges) { e.probes.forEach(cite); e.answer.claims?.forEach((c) => c.evidence.forEach(cite)); }
  for (const b of beats) b.statement?.answer.claims?.forEach((c) => c.evidence.forEach(cite));
  const pending = plan.scoreboard.filter((s) => s.status === "pending").map((s) => s.commitment);

  return sealRecord({
    schema: "press-record@1", id: recordId,
    factoryId: dossier.factoryId, factoryName: dossier.factoryName ?? dossier.factoryId, managerId: manager.id, managerName: manager.name,
    heldAt, period: dossier.period,
    corps: corps.reporters.map((r) => ({ id: r.id, name: r.name, lens: r.lens })),
    scoreboard: plan.scoreboard, beats, commitments,
    openCommitments: [...commitments.filter((c) => c.accountable), ...pending],
    evidence: [...cited.values()].sort((a, b) => refKey(a.ref).localeCompare(refKey(b.ref))),
    summary: { questions: exchanges.length, documented: count("documented"), partial: count("partial"), undocumented: count("undocumented"), contradicted: count("contradicted"), declined: count("declined"), documentedRate: exchanges.length ? count("documented") / exchanges.length : 0, commitmentsScored: plan.scoreboard.filter((s) => s.status !== "pending").length, commitmentsAchieved: plan.scoreboard.filter((s) => s.status === "achieved").length },
    previousRecordId: dossier.previousRecord?.id, previousRecordHash: dossier.previousRecord?.hash
  });
}

/** Hold the same press conference for every factory in the network. */
export async function holdForEveryFactory(dossiers: FactoryDossier[], managerFor: (dossier: FactoryDossier) => FactoryManager, options: HoldOptions): Promise<PressRecord[]> {
  const records: PressRecord[] = [];
  for (const dossier of dossiers) records.push(await holdPressConference(dossier, managerFor(dossier), { ...options, plan: undefined }));
  return records;
}

export type { Exchange };
