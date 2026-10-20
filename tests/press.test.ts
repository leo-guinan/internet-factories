import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import {
  auditRecord, EvidenceIndex, gradeAnswer, holdForEveryFactory, holdPressConference, ledgerManager, loadPressCorps, PressLedger,
  preparePressConference, renderTranscript, scoreCommitments, scriptedManager, validateCommitment, validatePressCorps,
  type Commitment, type FactoryDossier, type FactoryManager, type PressRecord
} from "../packages/press/src/index.js";
import { demoWeek, impressions, observation } from "../apps/press/src/demo.js";

const commitment = (over: Partial<Commitment> = {}): Commitment => ({ id: "c1", statement: "reach 1000 impressions", metric: "impressions", target: 1000, unit: "impressions", due: "2026-10-25T23:59:59.999Z", direction: "up", objectiveId: impressions.id, madeAt: "2026-10-19T13:00:00.000Z", recordId: "prs_prev", accountable: true, issues: [], ...over });
const withOpen = (dossier: FactoryDossier, open: Commitment[]): FactoryDossier => ({ ...dossier, previousRecord: { openCommitments: open, beats: [], id: "prs_prev", hash: "h" } as unknown as PressRecord });
const period = { start: "2026-10-19T00:00:00.000Z", end: "2026-10-25T23:59:59.999Z" };
const empty: FactoryDossier = { factoryId: "empty", managerId: "leo", period };
const corps = loadPressCorps(join(process.cwd(), "tests/fixtures/press-corps.json"));

test("a press corps is required and validated; the fixture corps is valid", async () => {
  assert.deepEqual(validatePressCorps(corps), []);
  await assert.rejects(preparePressConference(empty, { corps: { ...corps, reporters: [] } }), /at least one reporter/);
});

test("corps validation catches unknown reporters and lenses", () => {
  const bad = { ...corps, reporters: [{ ...corps.reporters[0], lens: "vibes" as never }], beats: [{ id: "x", name: "x", kind: "questions" as const, minutes: 1, reporters: ["nobody"] }] };
  const errors = validatePressCorps(bad);
  assert.ok(errors.some((e) => /unknown lens/.test(e)));
  assert.ok(errors.some((e) => /unknown reporter nobody/.test(e)));
});

test("preparation is deterministic and every probe resolves in the dossier", async () => {
  const [dossier] = await demoWeek(1);
  const a = await preparePressConference(dossier, { corps, preparedAt: "x" });
  const b = await preparePressConference(dossier, { corps, preparedAt: "x" });
  assert.deepEqual(a.beats.map((x) => x.questions.map((q) => q.id)), b.beats.map((x) => x.questions.map((q) => q.id)));
  const index = new EvidenceIndex(dossier);
  for (const q of a.beats.flatMap((x) => x.questions)) for (const p of q.probes) assert.ok(index.has(p), `${q.id} probes missing ${p.kind}:${p.id}`);
  for (const beat of a.beats.filter((x) => x.spec.kind === "questions" || x.spec.kind === "final")) assert.ok(beat.questions.length > 0, `beat ${beat.spec.id} has no questions`);
});

test("a factory with nothing on its ledger still gets a full press conference", async () => {
  const plan = await preparePressConference(empty, { corps });
  assert.ok(plan.beats.flatMap((b) => b.questions).length >= 6);
  assert.ok(plan.beats.flatMap((b) => b.questions).some((q) => /zero runs/.test(q.text)));
});

test("the lens questions find the failures, divergence and self-grading in a real run set", async () => {
  const [, research] = await demoWeek(1);
  const text = (await preparePressConference(research, { corps })).beats.flatMap((b) => b.questions).map((q) => q.text).join("\n");
  assert.match(text, /upstream timeout/);
  assert.match(text, /rejected at quality 0.6/);
  assert.match(text, /different outputs/);
  assert.match(text, /graded by your own evaluator/);
});

test("a phraser can reword questions but cannot change what they probe", async () => {
  const [dossier] = await demoWeek(1);
  const plain = await preparePressConference(dossier, { corps, preparedAt: "x" });
  const loud = await preparePressConference(dossier, { corps, preparedAt: "x", phrase: async (d) => d.text.toUpperCase() });
  const q0 = plain.beats[1].questions[0], q1 = loud.beats[1].questions[0];
  assert.equal(q1.text, q0.text.toUpperCase());
  assert.deepEqual(q1.probes, q0.probes);
  assert.equal(q1.id, q0.id);
});

test("grading: documented, partial, undocumented, contradicted, declined", () => {
  const dossier: FactoryDossier = { ...empty, objectives: [impressions], observations: [observation("o1", 870, "2026-10-24T20:00:00.000Z")] };
  const index = new EvidenceIndex(dossier);
  const probes = [{ kind: "observation" as const, id: "o1" }];
  assert.equal(gradeAnswer({ text: "870", claims: [{ statement: "870 impressions", evidence: probes, metric: { name: "impressions", value: 870 } }] }, probes, index).status, "documented");
  assert.equal(gradeAnswer({ text: "x", claims: [{ statement: "a", evidence: probes }, { statement: "b", evidence: [{ kind: "run", id: "made-up" }] }] }, probes, index).status, "partial");
  assert.equal(gradeAnswer({ text: "trust me", claims: [] }, probes, index).status, "undocumented");
  const contradicted = gradeAnswer({ text: "1000", claims: [{ statement: "we hit 1000", evidence: probes, metric: { name: "impressions", value: 1000 } }] }, probes, index);
  assert.equal(contradicted.status, "contradicted");
  assert.match(contradicted.claims[0].note!, /evidence says 870/);
  assert.equal(gradeAnswer({ text: "", claims: [], declined: true }, probes, index).status, "declined");
  const unverifiable = gradeAnswer({ text: "500", claims: [{ statement: "500 impressions", evidence: [{ kind: "objective", id: impressions.id }], metric: { name: "impressions", value: 500 } }] }, [], index);
  assert.equal(unverifiable.status, "undocumented", "a number nothing cited can confirm is not documented");
  assert.equal(gradeAnswer({ text: "x", claims: [{ statement: "objective", evidence: [{ kind: "objective", id: impressions.id }] }] }, probes, index).addressesProbes, false);
});

test("scoreboard: no evidence is unknown, never a win", () => {
  const base: FactoryDossier = { ...empty, objectives: [impressions] };
  const score = (d: FactoryDossier, c = commitment()) => scoreCommitments(withOpen(d, [c]))[0];
  assert.equal(score(base).status, "unknown");
  assert.equal(score({ ...base, observations: [observation("o", 1200, "2026-10-24T20:00:00.000Z")] }).status, "achieved");
  assert.equal(score({ ...base, observations: [observation("o", 870, "2026-10-24T20:00:00.000Z")] }).status, "partial");
  assert.equal(score({ ...base, observations: [observation("o", 0, "2026-10-24T20:00:00.000Z")] }).status, "missed");
  assert.equal(score({ ...base, observations: [observation("o", 1200, "2026-10-24T20:00:00.000Z", 0.4)] }).status, "unknown");
  assert.equal(score({ ...base, observations: [observation("o", 1200, "2026-10-18T20:00:00.000Z")] }).status, "unknown", "observations before the commitment do not count");
  assert.equal(score({ ...base, observations: [observation("o", 40, "2026-10-24T20:00:00.000Z")] }, commitment({ direction: "down", target: 50 })).status, "achieved");
  assert.equal(score(base, commitment({ due: "2026-11-30T00:00:00.000Z" })).status, "pending");
  assert.equal(score(base, commitment({ accountable: false })).status, "unknown");
});

test("commitments need a metric, a number and a future due date to be accountable", () => {
  const heldAt = "2026-10-26T13:00:00.000Z";
  assert.equal(validateCommitment({ statement: "ship more", metric: "", target: 1, unit: "x", due: "2026-11-01T00:00:00.000Z" }, heldAt, empty, "r").accountable, false);
  assert.equal(validateCommitment({ statement: "ship", metric: "artifacts", target: 5, unit: "artifacts", due: "2026-10-01T00:00:00.000Z" }, heldAt, empty, "r").accountable, false);
  const ok = validateCommitment({ statement: "ship", metric: "artifacts", target: 5, unit: "artifacts", due: "2026-11-01T00:00:00.000Z" }, heldAt, empty, "r");
  assert.equal(ok.accountable, true);
  assert.ok(ok.issues.some((i) => i.startsWith("warning: no objective")));
});

test("follow-ups: own reporter challenges, the skeptic covers reporters who can't, and repeated answers stop the chain", async () => {
  const [dossier] = await demoWeek(1);
  const stonewall: FactoryManager = { id: "m", name: "M", async answer() { return { text: "It went great.", claims: [] }; } };
  const record = await holdPressConference(dossier, stonewall, { corps, heldAt: "2026-10-19T13:00:00.000Z" });
  const ex = record.beats.flatMap((b) => b.exchanges);
  const ariFirst = ex.find((e) => e.reporterId === "scoreboard" && !e.followupOf)!;
  assert.ok(ex.some((e) => e.followupOf === ariFirst.id && e.reporterId === "scoreboard"));
  const juneFirst = ex.find((e) => e.reporterId === "people" && !e.followupOf)!;
  const juneFollow = ex.filter((e) => e.followupOf === juneFirst.id);
  assert.ok(juneFollow.length >= 1 && juneFollow.every((e) => e.reporterId === "skeptic"));
  assert.ok(juneFollow.length < 2, "a repeated answer ends the follow-up chain");
  assert.equal(record.summary.documented, 0);
});

test("a scripted manager's answers are graded; unscripted questions fall back or are declined", async () => {
  const [dossier] = await demoWeek(1);
  const plan = await preparePressConference(dossier, { corps, preparedAt: "2026-10-19T13:00:00.000Z" });
  const q = plan.beats[1].questions[0];
  const scripted = scriptedManager({ id: "leo", name: "Leo" }, { answers: { [q.id]: { text: "It's on the board.", claims: [{ statement: "see probe", evidence: q.probes }] } } });
  const record = await holdPressConference(dossier, scripted, { corps, heldAt: "2026-10-19T13:00:00.000Z", plan });
  const ex = record.beats.flatMap((b) => b.exchanges);
  assert.equal(ex.find((e) => e.id === q.id)!.grade.status, "documented");
  assert.ok(ex.filter((e) => e.id !== q.id).every((e) => e.grade.status === "declined"));
});

test("two weeks in a row: commitments are scored, records chain, and the ledger rejects forks and edits", async () => {
  const dir = await mkdtemp(join(process.cwd(), ".tmp-press-"));
  const ledger = new PressLedger(join(dir, "ledger.json"));
  const [w1] = await demoWeek(1);
  const r1 = ledger.append(await holdPressConference(w1, ledgerManager({ id: "leo", name: "Leo" }), { corps, heldAt: "2026-10-19T13:00:00.000Z" }));
  assert.equal(r1.openCommitments.length, 1);
  const [w2] = await demoWeek(2);
  const r2 = await holdPressConference({ ...w2, previousRecord: ledger.latest(w2.factoryId) }, ledgerManager({ id: "leo", name: "Leo" }), { corps, heldAt: "2026-10-26T13:00:00.000Z" });
  assert.equal(r2.scoreboard[0].status, "partial");
  assert.equal(r2.scoreboard[0].actual, 870);
  assert.equal(r2.previousRecordHash, r1.hash);
  ledger.append(r2);
  assert.deepEqual(ledger.verifyChain(w1.factoryId), []);
  const reloaded = new PressLedger(join(dir, "ledger.json"));
  assert.deepEqual(reloaded.verifyChain(w1.factoryId), [], "records still verify after a round-trip through disk");
  assert.equal(auditRecord(reloaded.latest(w1.factoryId)!, JSON.parse(JSON.stringify(w2))).ok, true, "evidence hashes match a dossier loaded from JSON");
  assert.equal(ledger.append(r2).hash, r2.hash, "re-appending is idempotent");
  const fork = await holdPressConference({ ...w2, previousRecord: r1 }, ledgerManager({ id: "leo", name: "Leo" }), { corps, heldAt: "2026-10-27T13:00:00.000Z" });
  assert.throws(() => ledger.append(fork), /chain break/);
  assert.throws(() => ledger.append({ ...r2, summary: { ...r2.summary, documented: 99 } }), /hash does not match/);
  const saved = JSON.parse(await readFile(join(dir, "ledger.json"), "utf8")) as { records: PressRecord[] };
  saved.records[0].beats[1].exchanges[0].answer.text = "rewritten later";
  const { writeFile } = await import("node:fs/promises"); await writeFile(join(dir, "ledger.json"), JSON.stringify(saved));
  assert.ok(new PressLedger(join(dir, "ledger.json")).verifyChain(w1.factoryId).some((i) => /changed after it was sealed/.test(i)));
});

test("audit flags evidence that changed or disappeared after it was cited", async () => {
  const [w2] = await demoWeek(2);
  const record = await holdPressConference(w2, ledgerManager(), { corps, heldAt: "2026-10-26T13:00:00.000Z" });
  assert.equal(auditRecord(record, w2).ok, true);
  const edited = { ...w2, observations: w2.observations!.map((o) => (o.id === "obs-w2b" ? { ...o, value: 999 } : o)) };
  assert.deepEqual(auditRecord(record, edited).changed, [{ kind: "observation", id: "obs-w2b" }]);
  const dropped = { ...w2, runs: w2.runs!.slice(1) };
  assert.ok(auditRecord(record, dropped).missing.some((r) => r.kind === "run"));
  assert.equal(auditRecord({ ...record, managerName: "someone else" }).sealed, false);
});

test("the same press conference runs across every factory", async () => {
  const records = await holdForEveryFactory([...(await demoWeek(1)), empty], () => ledgerManager({ id: "leo", name: "Leo" }), { corps, heldAt: "2026-10-19T13:00:00.000Z" });
  assert.deepEqual(records.map((r) => r.factoryId), ["linkedin-draft", "research-factory", "empty"]);
  for (const r of records) { assert.equal(r.beats.length, corps.beats.length); assert.match(renderTranscript(r), /## Final question/); }
  assert.ok(records[0].summary.documentedRate > records[2].summary.documentedRate, "an empty ledger can't document much");
});
