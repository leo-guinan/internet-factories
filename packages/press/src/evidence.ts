import { sha256Of } from "../../runtime/src/index.js";
import type { FactoryObjective, FactoryObservation } from "../../objectives/src/index.js";
import type { EvidenceEntry, EvidenceRef, FactoryDossier } from "./types.js";

/** Hash of a value as it will look after a JSON round-trip, so records and evidence verify the same in memory and on disk. */
export const stableHash = (value: unknown) => sha256Of(value === undefined ? null : JSON.parse(JSON.stringify(value)));
export const refKey = (ref: EvidenceRef) => `${ref.kind}:${ref.id}`;
const money = (n: number) => `$${n.toFixed(n < 1 ? 4 : 2)}`;

/** Indexes everything in a dossier that can be cited, with a content hash taken now. Re-indexing later and comparing hashes is how an audit detects edits. */
export class EvidenceIndex {
  private readonly entries = new Map<string, EvidenceEntry>();
  constructor(dossier: FactoryDossier) {
    const add = (ref: EvidenceRef, summary: string, value: unknown) => this.entries.set(refKey(ref), { ref, summary, value, sha256: stableHash(value) });
    for (const run of dossier.runs ?? []) {
      const { nodeRuns, output, ...rest } = run;
      add({ kind: "run", id: run.id }, `run ${run.id} ${run.status}, quality ${run.qualityScore ?? "n/a"}, cost ${money(run.totalCostUsd)}, ${run.artifacts.length} artifact(s)`, { ...rest, outputSha256: output === undefined ? undefined : stableHash(output), nodeRunIds: nodeRuns.map((n) => n.id) });
      for (const node of nodeRuns) {
        const { output: nodeOutput, ...nodeRest } = node;
        add({ kind: "node_run", id: node.id }, `node ${node.nodeId} attempt ${node.attempt} ${node.status}${node.error ? `: ${node.error.message}` : ""}`, { ...nodeRest, hasOutput: nodeOutput !== undefined });
      }
      for (const artifact of run.artifacts) add({ kind: "artifact", id: artifact.id }, `artifact ${artifact.id} (${artifact.type}) from run ${run.id}`, artifact);
    }
    for (const objective of dossier.objectives ?? []) add({ kind: "objective", id: objective.id }, `objective ${objective.target} ${objective.unit}${objective.unit === objective.metric ? "" : ` of ${objective.metric}`} per ${objective.window.duration}`, objective);
    for (const obs of dossier.observations ?? []) add({ kind: "observation", id: obs.id }, `${obs.metric} = ${obs.value} (${obs.measurement}, ${obs.scope}) observed ${obs.observedAt} from ${obs.sourceId}, confidence ${obs.confidence}`, obs);
    for (const decision of dossier.decisions ?? []) add({ kind: "decision", id: decision.id }, `decision ${decision.action}: ${decision.reason}`, decision);
    for (const plan of dossier.plans ?? []) add({ kind: "plan", id: `${plan.id}@${plan.version}` }, `plan ${plan.id} v${plan.version}, ${plan.candidates.length} candidate(s)`, plan);
    for (const ext of dossier.external ?? []) add({ kind: "external", id: ext.id }, `${ext.description} (${ext.uri}, captured ${ext.capturedAt})`, ext);
    const prev = dossier.previousRecord;
    if (prev) {
      for (const beat of prev.beats) for (const ex of beat.exchanges) add({ kind: "exchange", id: ex.id }, `${prev.heldAt.slice(0, 10)} ${ex.reporterName} asked "${ex.question}"; answer graded ${ex.grade.status}`, { question: ex.question, answer: ex.answer, grade: ex.grade.status, recordId: prev.id, recordHash: prev.hash });
      for (const c of prev.openCommitments) add({ kind: "commitment", id: c.id }, `commitment: ${c.statement} (${c.target} ${c.unit} of ${c.metric} by ${c.due})`, c);
    }
  }
  resolve(ref: EvidenceRef): EvidenceEntry | undefined { return this.entries.get(refKey(ref)); }
  has(ref: EvidenceRef): boolean { return this.entries.has(refKey(ref)); }
  all(): EvidenceEntry[] { return [...this.entries.values()]; }
}

/** Mirrors ObservationLedger.windowValue semantics without a file: latest cumulative snapshot, plus later increments, plus the latest later window total. */
export function observedValue(observations: FactoryObservation[]): { value: number; used: FactoryObservation[] } | undefined {
  const items = observations.filter((o) => o.scope === "account" && o.subjectId === "account").sort((a, b) => a.observedAt.localeCompare(b.observedAt));
  if (!items.length) return undefined;
  const snapshot = [...items].reverse().find((o) => o.measurement === "cumulative_snapshot");
  const after = snapshot ? items.filter((o) => o.observedAt > snapshot.observedAt) : items;
  const windowTotal = [...after].reverse().find((o) => o.measurement === "window_total");
  const increments = after.filter((o) => o.measurement === "increment");
  const used = [...(snapshot ? [snapshot] : []), ...increments, ...(windowTotal ? [windowTotal] : [])];
  return { value: (snapshot?.value ?? 0) + increments.reduce((s, o) => s + o.value, 0) + (windowTotal?.value ?? 0), used };
}

export function objectiveProgress(objective: FactoryObjective, observations: FactoryObservation[], period: { start: string; end: string }) {
  return observedValue(observations.filter((o) => o.objectiveId === objective.id && o.metric === objective.metric && o.observedAt >= period.start && o.observedAt <= period.end));
}

/** Reads a numeric metric out of a cited entry, so a claimed number can be checked against what the evidence says. */
export function metricFromEntry(entry: EvidenceEntry, metric: string): number | undefined {
  const value = entry.value as Record<string, unknown> | null;
  if (!value || typeof value !== "object") return undefined;
  if (entry.ref.kind === "observation") return value.metric === metric && typeof value.value === "number" ? value.value : undefined;
  const direct = value[metric];
  if (typeof direct === "number") return direct;
  const economics = value.economics as Record<string, unknown> | undefined;
  return economics && typeof economics[metric] === "number" ? (economics[metric] as number) : undefined;
}
