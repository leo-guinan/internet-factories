import { recordHashValid } from "../../press/src/record.js";
import type { AnswerStatus, Exchange, PressRecord } from "../../press/src/types.js";
import { validateStoryTemplate, type StoryDraft, type StoryMoment, type StoryTemplate } from "./contracts.js";

const why: Record<AnswerStatus, string> = { contradicted: "the evidence contradicts the answer", undocumented: "the answer cites nothing checkable", partial: "only part of the answer is on the record", declined: "the manager declined", documented: "the answer is on the record" };

function exchangeMoment(ex: Exchange): StoryMoment {
  return { kind: "exchange", ref: `exchange:${ex.id}`, speaker: ex.reporterName, line: ex.question, reply: ex.answer.text, status: ex.grade.status, why: why[ex.grade.status] };
}

/**
 * Runs a creator's story template over a sealed press record. Deterministic: the same template and record
 * always give the same draft. It refuses a record whose hash doesn't match, so a story can't be built on an edited record.
 */
export function draftStory(template: StoryTemplate, record: PressRecord): StoryDraft {
  const errors = validateStoryTemplate(template);
  if (errors.length) throw new Error(`invalid story template ${template?.id}: ${errors.join("; ")}`);
  if (record.schema !== "press-record@1" || !recordHashValid(record)) throw new Error(`press record ${record.id} is not a valid sealed record`);
  const rank = (s: string) => { const i = template.highlightOrder.indexOf(s as AnswerStatus); return i < 0 ? template.highlightOrder.length : i; };
  const fill = (s: string) => s.replaceAll("{factoryName}", record.factoryName).replaceAll("{date}", record.heldAt.slice(0, 10)).replaceAll("{documented}", String(record.summary.documented)).replaceAll("{questions}", String(record.summary.questions));
  const scenes = template.scenes.map((scene) => {
    let moments: StoryMoment[] = [];
    if (scene.from === "statement") { const b = record.beats.find((x) => x.statement); if (b?.statement) moments = [{ kind: "statement", ref: `beat:${b.id}`, speaker: record.managerName, line: b.statement.answer.text, status: b.statement.grade.status, why: "opening statement" }]; }
    if (scene.from === "scoreboard") moments = record.scoreboard.map((s) => ({ kind: "scoreboard" as const, ref: `commitment:${s.commitment.id}`, line: s.commitment.statement, status: s.status, why: s.reason }));
    if (scene.from === "commitments") moments = record.commitments.map((c) => ({ kind: "commitment" as const, ref: `commitment:${c.id}`, speaker: record.managerName, line: c.statement, status: c.accountable ? "accountable" : "not_scoreable", why: c.accountable ? `${c.target} ${c.unit} by ${c.due.slice(0, 10)}` : c.issues.join("; ") }));
    if (scene.from === "beat") moments = (record.beats.find((b) => b.id === scene.beatId)?.exchanges ?? []).map(exchangeMoment);
    if (scene.pick === "highlights") moments = [...moments].sort((a, b) => rank(a.status ?? "") - rank(b.status ?? "") || moments.indexOf(a) - moments.indexOf(b));
    return { id: scene.id, title: fill(scene.title), moments: moments.slice(0, scene.max ?? moments.length) };
  });
  return { schema: "story-draft@1", templateId: template.id, templateVersion: template.version, source: { schema: "press-record@1", id: record.id, hash: record.hash, factoryId: record.factoryId }, title: fill(template.title), logline: fill(template.logline), scenes, provenance: [...new Set(scenes.flatMap((s) => s.moments.map((m) => m.ref)))] };
}
