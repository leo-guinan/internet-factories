import { readFileSync } from "node:fs";
import type { LensId, PressCorps } from "./types.js";

/**
 * Lenses are factory operations: each one reads factory evidence and drafts questions.
 * Who asks them (personas, voices, run of show) is creator-level content supplied as a PressCorps,
 * usually built from agent cards with the studio `create-press-corps` operation.
 */
export const LENSES: LensId[] = ["scoreboard", "film", "business", "people", "reproducibility", "skeptic"];

export function validatePressCorps(corps: PressCorps): string[] {
  const errors: string[] = [];
  if (!corps || typeof corps !== "object") return ["corps must be an object"];
  if (!corps.id) errors.push("corps id is required");
  const ids = new Set<string>();
  for (const r of corps.reporters ?? []) {
    if (!r.id || !r.name) errors.push("every reporter needs an id and a name");
    if (ids.has(r.id)) errors.push(`duplicate reporter id ${r.id}`);
    ids.add(r.id);
    if (!LENSES.includes(r.lens)) errors.push(`reporter ${r.id} has unknown lens ${r.lens}`);
    if (!r.rights || typeof r.rights.mayChallenge !== "boolean") errors.push(`reporter ${r.id} needs rights.mayChallenge`);
  }
  if (!corps.reporters?.length) errors.push("at least one reporter is required");
  const beatIds = new Set<string>();
  for (const b of corps.beats ?? []) {
    if (beatIds.has(b.id)) errors.push(`duplicate beat id ${b.id}`);
    beatIds.add(b.id);
    if (!["statement", "questions", "commitments", "final"].includes(b.kind)) errors.push(`beat ${b.id} has unknown kind ${b.kind}`);
    for (const rid of b.reporters ?? []) if (!ids.has(rid)) errors.push(`beat ${b.id} references unknown reporter ${rid}`);
    if ((b.kind === "questions" || b.kind === "final") && !b.reporters?.length) errors.push(`beat ${b.id} needs at least one reporter`);
  }
  if (!corps.beats?.length) errors.push("at least one beat is required");
  return errors;
}

export function assertPressCorps(corps: PressCorps): PressCorps {
  const errors = validatePressCorps(corps);
  if (errors.length) throw new Error(`invalid press corps ${corps?.id ?? "(no id)"}: ${errors.join("; ")}`);
  return corps;
}

export function loadPressCorps(path: string): PressCorps {
  return assertPressCorps(JSON.parse(readFileSync(path, "utf8")) as PressCorps);
}
