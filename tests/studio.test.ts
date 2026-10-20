import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { holdPressConference, ledgerManager, type FactoryDossier, type FactoryManager, type PressRecord } from "../packages/press/src/index.js";
import {
  cardHash, createStudio, currentLocation, custodyChanges, draftStory, fixtureImageProvider, fixtureVoiceProvider, importAgent, LocalAssetStore, moveAgent,
  OpenAICompatibleImageProvider, pressCorpsFromCard, readEnergy, receiptHashValid, validateAgentCard, type AgentCard, type StoryTemplate
} from "../packages/studio/src/index.js";
import { demoWeek } from "../apps/press/src/demo.js";

const ctx = { operatorId: "op-leo", creatorId: "leo", hosting: "operator" as const };
const at = "2026-10-20T12:00:00.000Z";
const draft = (id: string, lens: "scoreboard" | "skeptic" = "scoreboard", challengesOthers = false) => ({ id, name: id.toUpperCase(), role: "reporter", persona: { summary: `${id} persona`, theoryOfWinning: "numbers", voiceDirection: "dry" }, press: { lens, rights: { mayChallenge: true, challengesOthers }, maxFollowups: 1, questionsPerBeat: 2 } });
const studio = async (extra: Partial<Parameters<typeof createStudio>[0]> = {}) => createStudio({ factoryId: "presser", now: () => at, assets: new LocalAssetStore(await mkdtemp(join(process.cwd(), ".tmp-studio-"))), voice: fixtureVoiceProvider({ wh: 0.4, source: "provider_reported" }), image: fixtureImageProvider(), ...extra });

test("create-reporter makes a valid agent card born in the factory, with a hashed receipt", async () => {
  const s = await studio({ localEnergy: { whPerCall: 0.01, method: "declared: 10 mWh per local step" } });
  const { output: card, receipt } = await s.createReporter({ creatorId: "leo", draft: draft("ari") }, ctx);
  assert.deepEqual(validateAgentCard(card!), []);
  assert.equal(currentLocation(card!), "factory:presser");
  assert.equal(card!.custody[0].cardSha256, cardHash(card!));
  assert.equal(receipt.status, "completed");
  assert.equal(receipt.artifact?.schema, "agent-card@1");
  assert.equal(receipt.energy.estimatedWh, 0.01);
  assert.deepEqual(receipt.energy.methods, ["declared: 10 mWh per local step"]);
  assert.ok(receiptHashValid(receipt));
  assert.equal(receiptHashValid({ ...receipt, costUsd: 99 }), false);
});

test("energy with no reading is unknown, and an estimate without a method doesn't count", async () => {
  const s = await studio();
  const { receipt } = await s.createReporter({ creatorId: "leo", draft: draft("ari") }, ctx);
  assert.deepEqual([receipt.energy.estimatedWh, receipt.energy.unknownSteps], [0, 1]);
  assert.equal(readEnergy({ energy: { wh: 5, source: "estimated" } }).source, "unknown");
  assert.equal(readEnergy({ energy: { wh: -1, source: "measured" } }).source, "unknown");
});

test("an invalid reporter fails the operation and produces no artifact", async () => {
  const s = await studio();
  const { receipt, output } = await s.createReporter({ creatorId: "leo", draft: { ...draft("ari"), press: undefined } }, ctx);
  assert.equal(receipt.status, "failed");
  assert.equal(receipt.artifact, undefined);
  assert.equal(output, undefined);
});

test("agents move between creator and factory; custody shows where they changed", async () => {
  const s = await studio();
  const born = (await s.createReporter({ creatorId: "leo", draft: draft("ari") }, ctx)).output!;
  const home = moveAgent(born, "creator:leo", "leo", at, "returned to creator");
  assert.throws(() => importAgent(home, "presser"), /move it first/);
  const back = importAgent(moveAgent(home, "factory:presser", "leo", at), "presser");
  const voiced = (await s.createVoice({ agent: back, sampleText: "Hold on. Freeze it there." }, ctx)).output!.agent!;
  const returned = moveAgent(voiced, "creator:leo", "op-leo", at);
  assert.deepEqual(returned.custody.map((h) => h.location), ["factory:presser", "creator:leo", "factory:presser", "creator:leo"]);
  assert.deepEqual(custodyChanges(returned).map((c) => c.changed), [false, false, true]);
  assert.throws(() => moveAgent({ ...returned, persona: { summary: "" } }, "factory:x", "leo"), /invalid agent/);
});

test("create-voice stores the asset by hash, bumps the card version and links the receipt", async () => {
  const s = await studio();
  const card = (await s.createReporter({ creatorId: "leo", draft: draft("mara") }, ctx)).output!;
  const { output, receipt } = await s.createVoice({ agent: card, sampleText: "Walk us through that call.", voiceId: "audition_mara_3" }, { ...ctx, orderRef: "order_42" });
  const asset = output!.asset;
  const bytes = await readFile(fileURLToPath(asset.uri));
  assert.equal(createHash("sha256").update(bytes).digest("hex"), asset.sha256);
  assert.equal(asset.receiptId, receipt.id);
  assert.equal(output!.agent!.version, card.version + 1);
  assert.equal(output!.agent!.assets!.voices![0].providerRef, "audition_mara_3");
  assert.deepEqual([receipt.energy.providerReportedWh, receipt.orderRef, receipt.hosting], [0.4, "order_42", "operator"]);
});

test("create-image works through an OpenAI-compatible endpoint and records a declared energy estimate", async () => {
  const png = Buffer.from("fake-png-bytes");
  const transport = async (url: string, init: RequestInit) => { assert.match(url, /\/images\/generations$/); assert.equal(JSON.parse(String(init.body)).response_format, "b64_json"); return new Response(JSON.stringify({ data: [{ b64_json: png.toString("base64") }] }), { status: 200 }); };
  const s = await studio({ image: new OpenAICompatibleImageProvider({ endpoint: "https://img.example/v1", apiKey: "k", model: "img-1", costPerCallUsd: 0.04, energy: { whPerCall: 2.9, method: "vendor-published per-image estimate" }, transport }) });
  const { output, receipt } = await s.createImage({ prompt: "press room, wide shot" }, { ...ctx, hosting: "provider" });
  assert.equal(output!.asset.sha256, createHash("sha256").update(png).digest("hex"));
  assert.deepEqual([receipt.costUsd, receipt.energy.estimatedWh, receipt.hosting], [0.04, 2.9, "provider"]);
});

test("create-press-corps builds a corps from agent cards that the press conference can use", async () => {
  const s = await studio();
  const ari = (await s.createReporter({ creatorId: "leo", draft: draft("ari") }, ctx)).output!;
  const graham = (await s.createReporter({ creatorId: "leo", draft: draft("graham", "skeptic", true) }, ctx)).output!;
  const beats = [{ id: "score", name: "Scoreboard", kind: "questions" as const, minutes: 3, reporters: ["ari"] }, { id: "final", name: "Final question", kind: "final" as const, minutes: 1, reporters: ["graham"] }];
  const { output: card, receipt } = await s.createPressCorps({ creatorId: "leo", id: "mini", name: "Mini corps", reporters: [ari, graham], beats }, ctx);
  assert.equal(receipt.status, "completed");
  const [dossier] = await demoWeek(1);
  const record = await holdPressConference(dossier, ledgerManager(), { corps: pressCorpsFromCard(card!), heldAt: at });
  assert.deepEqual(record.corps.map((r) => r.name), ["ARI", "GRAHAM"]);
  const bad = await s.createPressCorps({ creatorId: "leo", id: "bad", name: "Bad", reporters: [ari], beats: [{ ...beats[0], reporters: ["nobody"] }] }, ctx);
  assert.equal(bad.receipt.status, "failed");
});

const template: StoryTemplate = {
  schema: "story-template@1", id: "presser-episode", version: 1, creatorId: "leo", source: "press-record@1",
  title: "{factoryName}, {date}", logline: "{documented} of {questions} answers held up.",
  scenes: [
    { id: "cold-open", title: "Cold open", from: "beat", beatId: "tough", pick: "highlights", max: 1 },
    { id: "statement", title: "Statement", from: "statement", pick: "all" },
    { id: "score", title: "The scoreboard", from: "scoreboard", pick: "all" },
    { id: "plan", title: "What they promised", from: "commitments", pick: "all" }
  ],
  highlightOrder: ["contradicted", "undocumented", "partial", "declined", "documented"]
};

test("create-story runs a creator template over a sealed record; highlights lead with what didn't hold up", async () => {
  const [dossier] = await demoWeek(1);
  const corps = (await import("../packages/press/src/index.js")).loadPressCorps(join(process.cwd(), "tests/fixtures/press-corps.json"));
  const fibber: FactoryManager = { ...ledgerManager(), id: "m", name: "M", async answer(q, c) { return q.reporterId === "skeptic" ? { text: "Trust me.", claims: [] } : ledgerManager().answer(q, c); } };
  const record: PressRecord = await holdPressConference(dossier as FactoryDossier, fibber, { corps, heldAt: at });
  const s = await studio();
  const { output: story, receipt } = await s.createStory({ template, record }, ctx);
  assert.equal(receipt.status, "completed");
  assert.equal(story!.title, `LinkedIn Draft Factory, ${at.slice(0, 10)}`);
  assert.equal(story!.scenes[0].moments[0].status, "undocumented");
  assert.equal(story!.scenes[0].moments[0].speaker, "Skeptic Reporter");
  assert.equal(story!.source.hash, record.hash);
  const refs = new Set(record.beats.flatMap((b) => b.exchanges.map((e) => `exchange:${e.id}`)));
  for (const ref of story!.provenance.filter((r) => r.startsWith("exchange:"))) assert.ok(refs.has(ref));
  assert.deepEqual(draftStory(template, record), story);
  assert.throws(() => draftStory(template, { ...record, managerName: "Someone Else" }), /not a valid sealed record/);
});

test("cross-repo: the Creator APIs cast card and receipt verify here byte-for-byte", async () => {
  const card = JSON.parse(await readFile(join(process.cwd(), "tests/fixtures/creator-apis.press-corps.json"), "utf8"));
  for (const r of card.reporters as AgentCard[]) { assert.deepEqual(validateAgentCard(r), []); assert.equal(r.custody[0].cardSha256, cardHash(r), `${r.id} hash agrees across repos`); }
  const corps = pressCorpsFromCard(card);
  assert.deepEqual(corps.reporters.map((r) => [r.name, r.lens]), [["Ari Chen", "scoreboard"], ["Mara Quinn", "film"], ["Darius Cole", "business"], ["June Park", "people"], ["Nia Brooks", "reproducibility"], ["Graham Pike", "skeptic"]]);
  assert.equal(corps.reporters[0].voice?.["clipping-lab"], "ari");
  const ari = importAgent(moveAgent(card.reporters[0], "factory:presser", "leo", at), "presser");
  assert.deepEqual(custodyChanges(ari).map((c) => c.changed), [false]);
  const [dossier] = await demoWeek(1);
  const record = await holdPressConference(dossier, ledgerManager(), { corps, heldAt: at });
  assert.ok(record.beats.flatMap((b) => b.exchanges).some((e) => e.reporterName === "Graham Pike"));
  const receipt = JSON.parse(await readFile(join(process.cwd(), "tests/fixtures/creator-apis.operation-receipt.json"), "utf8"));
  assert.ok(receiptHashValid(receipt));
});
