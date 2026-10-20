import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { EvidenceIndex, refKey, stableHash } from "./evidence.js";
import type { EvidenceRef, FactoryDossier, PressRecord } from "./types.js";

export function recordHashValid(record: PressRecord): boolean { const { hash, ...rest } = record; return stableHash(rest) === hash; }

/** Append-only, per-factory hash chain of press records. A record can only follow the latest record for its factory. */
export class PressLedger {
  private records: PressRecord[] = [];
  constructor(private readonly path: string) { try { this.records = (JSON.parse(readFileSync(path, "utf8")) as { records: PressRecord[] }).records ?? []; } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; } }
  latest(factoryId: string): PressRecord | undefined { const r = this.records.filter((x) => x.factoryId === factoryId).at(-1); return r ? structuredClone(r) : undefined; }
  list(factoryId?: string): PressRecord[] { return this.records.filter((r) => !factoryId || r.factoryId === factoryId).map((r) => structuredClone(r)); }
  append(record: PressRecord): PressRecord {
    if (!recordHashValid(record)) throw new Error(`record ${record.id} hash does not match its contents`);
    const existing = this.records.find((r) => r.id === record.id);
    if (existing) { if (existing.hash !== record.hash) throw new Error(`record ${record.id} already exists with different content`); return structuredClone(existing); }
    const last = this.latest(record.factoryId);
    if (last && record.previousRecordHash !== last.hash) throw new Error(`chain break for ${record.factoryId}: record ${record.id} does not follow ${last.id}`);
    if (!last && record.previousRecordHash) throw new Error(`chain break for ${record.factoryId}: previous record ${record.previousRecordId} is not in this ledger`);
    this.records.push(structuredClone(record));
    mkdirSync(dirname(this.path), { recursive: true });
    const tmp = `${this.path}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify({ records: this.records }, null, 2));
    renameSync(tmp, this.path);
    return structuredClone(record);
  }
  verifyChain(factoryId: string): string[] {
    const issues: string[] = [];
    let previous: PressRecord | undefined;
    for (const record of this.records.filter((r) => r.factoryId === factoryId)) {
      if (!recordHashValid(record)) issues.push(`${record.id}: contents changed after it was sealed`);
      if ((previous?.hash ?? undefined) !== (record.previousRecordHash ?? undefined)) issues.push(`${record.id}: does not link to ${previous?.id ?? "nothing"}`);
      previous = record;
    }
    return issues;
  }
}

export interface AuditReport { recordId: string; sealed: boolean; evidenceChecked: number; missing: EvidenceRef[]; changed: EvidenceRef[]; ok: boolean; }

/** Re-checks a sealed record against the factory's current ledgers: every cited item must still exist and hash the same as when it was cited. */
export function auditRecord(record: PressRecord, dossier?: FactoryDossier): AuditReport {
  const sealed = recordHashValid(record);
  const missing: EvidenceRef[] = [];
  const changed: EvidenceRef[] = [];
  if (dossier) {
    const index = new EvidenceIndex(dossier);
    for (const cited of record.evidence) {
      if (cited.ref.kind === "exchange" || cited.ref.kind === "commitment") continue; // these live in the previous record, which the chain covers
      const entry = index.resolve(cited.ref);
      if (!entry) missing.push(cited.ref); else if (entry.sha256 !== cited.sha256) changed.push(cited.ref);
    }
  }
  return { recordId: record.id, sealed, evidenceChecked: dossier ? record.evidence.length : 0, missing, changed, ok: sealed && !missing.length && !changed.length };
}

const badge: Record<string, string> = { documented: "DOCUMENTED", partial: "PARTIAL", undocumented: "UNDOCUMENTED", contradicted: "CONTRADICTED", declined: "DECLINED" };

/** A readable transcript. The JSON record is the source of truth; this is for the show and for people. */
export function renderTranscript(record: PressRecord): string {
  const s = record.summary;
  const lines = [
    `# ${record.factoryName}: press conference`,
    "",
    `Held ${record.heldAt.slice(0, 16).replace("T", " ")} UTC · period ${record.period.start.slice(0, 10)} to ${record.period.end.slice(0, 10)} · manager ${record.managerName}`,
    `Record \`${record.id}\` · hash \`${record.hash.slice(0, 16)}\`${record.previousRecordHash ? ` · follows \`${record.previousRecordId}\`` : " · first record"}`,
    "",
    `**${s.documented} of ${s.questions} answers documented** (${Math.round(s.documentedRate * 100)}%) · ${s.partial} partial · ${s.undocumented} undocumented · ${s.contradicted} contradicted · ${s.declined} declined · commitments achieved ${s.commitmentsAchieved}/${s.commitmentsScored}`,
    ""
  ];
  if (record.scoreboard.length) { lines.push("## Scoreboard: last time's commitments", ""); for (const sc of record.scoreboard) lines.push(`- **${sc.status.toUpperCase()}**: ${sc.commitment.statement} (${sc.reason})`); lines.push(""); }
  for (const beat of record.beats) {
    lines.push(`## ${beat.name}`, "");
    if (beat.statement) lines.push(`> ${beat.statement.answer.text}`, "", `*${badge[beat.statement.grade.status]}*`, "");
    if (beat.kind === "commitments") { if (!record.commitments.length) lines.push("No commitments made.", ""); for (const c of record.commitments) lines.push(c.accountable ? `- **ACCOUNTABLE**: ${c.statement}: ${c.target} ${c.unit} of \`${c.metric}\` by ${c.due.slice(0, 10)}${c.issues.length ? ` (${c.issues.join("; ")})` : ""}` : `- **NOT SCOREABLE**: ${c.statement} (${c.issues.join("; ")})`); lines.push(""); }
    for (const ex of beat.exchanges) {
      lines.push(`**${ex.reporterName}**${ex.followupOf ? " (follow-up)" : ""}: ${ex.question}`, "", `**${record.managerName}**: ${ex.answer.text || "(no answer)"}`, "");
      const refs = ex.grade.claims.flatMap((c) => c.evidence.map((e) => `${e.resolved ? "" : "~~"}${e.ref.kind}:${e.ref.id}${e.resolved ? "" : "~~"}`));
      lines.push(`*${badge[ex.grade.status]}*${refs.length ? ` · cites ${refs.join(", ")}` : ""}${ex.grade.issues.length ? ` · ${ex.grade.issues.join("; ")}` : ""}`, "");
    }
  }
  return lines.join("\n");
}

export { refKey };
