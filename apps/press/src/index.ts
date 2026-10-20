import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { assertPressCorps, auditRecord, holdPressConference, ledgerManager, PressLedger, preparePressConference, renderTranscript, scriptedManager, type DraftAnswer, type FactoryDossier, type ManagerScript } from "../../../packages/press/src/index.js";
import { pressCorpsFromCard, type PressCorpsCard } from "../../../packages/studio/src/index.js";
import type { PressCorps } from "../../../packages/press/src/index.js";
import { demoWeek } from "./demo.js";

const args = process.argv.slice(2);
const cmd = args[0];
const flag = (name: string) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined; };
const has = (name: string) => args.includes(`--${name}`);
const readJson = <T>(path: string) => JSON.parse(readFileSync(path, "utf8")) as T;
const write = (path: string, body: string) => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, body); };
/** Accepts a creator's press-corps@1 card (from Creator APIs) or a plain PressCorps file. */
function loadCorps(path: string): PressCorps { const raw = readJson<PressCorps | PressCorpsCard>(path); return (raw as PressCorpsCard).schema === "press-corps@1" ? pressCorpsFromCard(raw as PressCorpsCard) : assertPressCorps(raw as PressCorps); }
const corps = () => { const path = flag("corps"); if (!path) throw new Error("--corps is required: pass a press-corps@1 card from Creator APIs or a press corps JSON file"); return loadCorps(path); };
const ledgerPath = () => flag("ledger") ?? "data/press/ledger.json";

/** The ledger supplies the previous record automatically, so last week's commitments always come back. */
function withPrevious(dossier: FactoryDossier, ledger: PressLedger): FactoryDossier { return dossier.previousRecord ? dossier : { ...dossier, previousRecord: ledger.latest(dossier.factoryId) }; }

async function main() {
  if (cmd === "prep") {
    const ledger = new PressLedger(ledgerPath());
    const dossier = withPrevious(readJson<FactoryDossier>(flag("dossier")!), ledger);
    const plan = await preparePressConference(dossier, { corps: corps() });
    const out = flag("out") ?? `data/press/${dossier.factoryId}/plan.json`;
    write(out, JSON.stringify(plan, null, 2));
    const template: ManagerScript = { opening: { text: "", claims: [] }, answers: Object.fromEntries(plan.beats.flatMap((b) => b.questions).map((q) => [q.id, { text: "", claims: q.probes.length ? [{ statement: "", evidence: q.probes }] : [] } satisfies DraftAnswer])), commitments: [] };
    write(join(dirname(out), "answers.template.json"), JSON.stringify(template, null, 2));
    for (const b of plan.beats) { console.log(`\n${b.spec.name}`); for (const q of b.questions) console.log(`  [${q.id}] ${q.reporterName}: ${q.text}`); }
    console.log(`\nplan → ${out}\nanswers template → ${join(dirname(out), "answers.template.json")}`);
    return;
  }
  if (cmd === "hold") {
    const ledger = new PressLedger(ledgerPath());
    const dossier = withPrevious(readJson<FactoryDossier>(flag("dossier")!), ledger);
    const auto = ledgerManager({ id: dossier.managerId, name: flag("manager-name") ?? dossier.managerId });
    const manager = flag("answers") ? scriptedManager({ id: dossier.managerId, name: flag("manager-name") ?? dossier.managerId }, readJson<ManagerScript>(flag("answers")!), has("auto") ? auto : undefined) : auto;
    const record = ledger.append(await holdPressConference(dossier, manager, { corps: corps(), heldAt: flag("at") }));
    const dir = `data/press/${dossier.factoryId}`;
    write(`${dir}/${record.id}.json`, JSON.stringify(record, null, 2));
    write(flag("transcript") ?? `${dir}/${record.id}.md`, renderTranscript(record));
    console.log(`${record.factoryName}: ${record.summary.documented}/${record.summary.questions} documented, ${record.openCommitments.length} open commitment(s) → ${dir}/${record.id}.md`);
    return;
  }
  if (cmd === "audit") {
    const ledger = new PressLedger(ledgerPath());
    const factory = flag("factory")!;
    const chain = ledger.verifyChain(factory);
    const dossier = flag("dossier") ? readJson<FactoryDossier>(flag("dossier")!) : undefined;
    const reports = ledger.list(factory).map((r) => auditRecord(r, dossier));
    console.log(JSON.stringify({ factory, chainIssues: chain, records: reports }, null, 2));
    process.exitCode = chain.length || reports.some((r) => !r.ok) ? 1 : 0;
    return;
  }
  if (cmd === "demo") {
    const ledger = new PressLedger(flag("ledger") ?? "data/press/demo-ledger.json");
    const demoCorps = loadCorps(flag("corps") ?? "tests/fixtures/press-corps.json");
    for (const [week, at] of [[1, "2026-10-19T13:00:00.000Z"], [2, "2026-10-26T13:00:00.000Z"]] as const) {
      for (const dossier of await demoWeek(week)) {
        const record = ledger.append(await holdPressConference(withPrevious(dossier, ledger), ledgerManager({ id: "leo", name: "Leo" }), { corps: demoCorps, heldAt: at }));
        write(`data/press/demo/${dossier.factoryId}-week${week}.md`, renderTranscript(record));
        console.log(`week ${week} ${record.factoryName}: ${record.summary.documented}/${record.summary.questions} documented · scoreboard ${record.scoreboard.map((s) => s.status).join(",") || "none"} · chain ${ledger.verifyChain(dossier.factoryId).length ? "BROKEN" : "ok"}`);
      }
    }
    return;
  }
  console.log("usage: press <prep|hold|audit|demo> --dossier file.json --corps press-corps.json [--answers file.json] [--auto] [--ledger file.json] [--factory id] [--at iso]");
  process.exitCode = 2;
}

main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
