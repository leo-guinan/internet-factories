import { readFileSync } from "node:fs";
import type { BeatSpec, LensId, PressCorps, ReporterPersona } from "./types.js";

export const LENSES: LensId[] = ["scoreboard", "film", "business", "people", "reproducibility", "skeptic"];

/** Run of show adapted from the Monday Morning Presser kit. Beats reference reporters by id, so a corps can be recast without touching beats. */
export const defaultBeats: BeatSpec[] = [
  { id: "open", name: "Opening statement", kind: "statement", minutes: 1, reporters: [], defaultShot: "coach" },
  { id: "score", name: "The scoreboard", kind: "questions", minutes: 3, reporters: ["ari"], defaultShot: "film" },
  { id: "tough", name: "The tough questions", kind: "questions", minutes: 5, reporters: ["darius", "june", "graham"], defaultShot: "wide" },
  { id: "film", name: "Film-room breakdown", kind: "questions", minutes: 3, reporters: ["mara", "nia"], defaultShot: "film" },
  { id: "plan", name: "Next week's game plan", kind: "commitments", minutes: 2, reporters: [], defaultShot: "coach" },
  { id: "final", name: "Final question", kind: "final", minutes: 1, reporters: ["graham"], defaultShot: "wide" }
];

/** Press Corps Character Bible v1 cast. Lens assignments are read from the bible's dialogue; change `lens` to recast. */
export const defaultReporters: ReporterPersona[] = [
  { id: "ari", name: "Ari Chen", title: "Scoreboard", lens: "scoreboard", theoryOfWinning: "You win if the number moved against the target you named.", persona: "Fast, numerate, allergic to adjectives. Reads the target back to you, then the actual, then waits.", rights: { mayChallenge: true, refusesUnevidencedWins: true }, maxFollowups: 1, questionsPerBeat: 3 },
  { id: "mara", name: "Mara Quinn", title: "Film room", lens: "film", theoryOfWinning: "You win by making the right call at the moment it mattered.", persona: "Freezes the tape on a single decision or failure and asks why it went that way and what changed after.", rights: { mayChallenge: true }, maxFollowups: 1, questionsPerBeat: 2 },
  { id: "darius", name: "Darius Cole", title: "Business", lens: "business", theoryOfWinning: "You win when output is worth more than it cost.", persona: "Smooth, patient, practical. Prices everything: cost per accepted artifact, retries, recovery spend.", rights: { mayChallenge: true }, maxFollowups: 1, questionsPerBeat: 2 },
  { id: "june", name: "June Park", title: "People", lens: "people", theoryOfWinning: "You win when it reached a person and changed something for them.", persona: "Warm and expressive. Asks who the work was for, whether they got it, and who signed off.", rights: { mayChallenge: false }, maxFollowups: 0, questionsPerBeat: 2 },
  { id: "nia", name: "Nia Brooks", title: "Reproducibility", lens: "reproducibility", theoryOfWinning: "You win if it happens again tomorrow with the same inputs.", persona: "Playful, then dead serious. One run is a sample of one; same input with different outputs is a bug until shown otherwise.", rights: { mayChallenge: true }, maxFollowups: 1, questionsPerBeat: 2 },
  { id: "graham", name: "Graham Pike", title: "Skeptic", lens: "skeptic", theoryOfWinning: "Nobody wins until someone outside the system can check it.", persona: "Gravel voice, slow. Accountable to reality, not the manager. Hunts self-graded metrics, claims without evidence, and contradictions with last week's record.", rights: { mayChallenge: true, challengesOthers: true, refusesUnevidencedWins: true }, maxFollowups: 2, questionsPerBeat: 2 }
];

export const defaultPressCorps: PressCorps = { id: "press-corps-bible-v1", name: "Press Corps Character Bible v1", reporters: defaultReporters, beats: defaultBeats };

export function validatePressCorps(corps: PressCorps): string[] {
  const errors: string[] = [];
  if (!corps.id) errors.push("corps id is required");
  const ids = new Set<string>();
  for (const r of corps.reporters ?? []) {
    if (!r.id || !r.name) errors.push("every reporter needs an id and a name");
    if (ids.has(r.id)) errors.push(`duplicate reporter id ${r.id}`);
    ids.add(r.id);
    if (!LENSES.includes(r.lens)) errors.push(`reporter ${r.id} has unknown lens ${r.lens}`);
    if (!r.rights || typeof r.rights.mayChallenge !== "boolean") errors.push(`reporter ${r.id} needs rights.mayChallenge`);
  }
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

export function loadPressCorps(path: string): PressCorps {
  const corps = JSON.parse(readFileSync(path, "utf8")) as PressCorps;
  const errors = validatePressCorps(corps);
  if (errors.length) throw new Error(`invalid press corps ${path}: ${errors.join("; ")}`);
  return corps;
}
