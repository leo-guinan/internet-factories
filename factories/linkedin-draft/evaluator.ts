import { isInsightInput, isLinkedInDraft, type InsightInput, type LinkedInDraft, type SixPsBrief } from "./schemas.js";

export interface SixPsTargets { people: number; positioning: number; promise: number; proof: number; priority: number; process: number; }
export interface SixPsEvaluation { scores: SixPsTargets; targets: SixPsTargets; accepted: boolean; issues: string[]; }
export interface DraftEvaluation { score: number; accepted: boolean; issues: string[]; checks: { schema: boolean; audience: boolean; grounding: boolean; action: boolean; structure: boolean; sixPs: boolean }; sixPs: SixPsEvaluation; }

export const defaultSixPsTargets: SixPsTargets = { people: 0.5, positioning: 0.5, promise: 0.5, proof: 0.5, priority: 0.5, process: 0.5 };
const words = (value: string) => new Set(value.toLowerCase().split(/[^a-z0-9]+/).filter((word) => word.length >= 4));
const overlap = (target: string, text: string) => { const expected = words(target); if (!expected.size) return 0; const actual = words(text); return [...expected].filter((word) => actual.has(word)).length / expected.size; };

export function evaluateSixPs(input: InsightInput, draft: LinkedInDraft, targets: SixPsTargets = defaultSixPsTargets): SixPsEvaluation {
  const text = `${draft.hook} ${draft.body} ${draft.cta}`;
  const brief: SixPsBrief = input.sixPs;
  const scores: SixPsTargets = {
    people: overlap(brief.people, text),
    positioning: overlap(brief.positioning, text),
    promise: overlap(brief.promise, text),
    proof: Math.max(...brief.proof.map((proof) => overlap(proof, text)), 0),
    priority: overlap(brief.priority, text),
    process: overlap(brief.process, text)
  };
  const issues = (Object.keys(scores) as Array<keyof SixPsTargets>).filter((key) => scores[key] < targets[key]).map((key) => `${key} score ${scores[key].toFixed(2)} is below target ${targets[key].toFixed(2)}`);
  return { scores, targets, accepted: issues.length === 0, issues };
}

export function evaluateLinkedInDraft(input: InsightInput, output: unknown, minimumScore = 0.8, sixPsTargets: SixPsTargets = defaultSixPsTargets): DraftEvaluation {
  const schema = isLinkedInDraft(output);
  if (!schema) return { score: 0, accepted: false, issues: ["output does not match LinkedInDraft"], checks: { schema: false, audience: false, grounding: false, action: false, structure: false, sixPs: false }, sixPs: { scores: { ...defaultSixPsTargets }, targets: sixPsTargets, accepted: false, issues: ["output does not match LinkedInDraft"] } };
  const draft = output as LinkedInDraft;
  const audience = draft.body.toLowerCase().includes(input.audience.toLowerCase().split(/\s+/)[0]);
  const grounding = draft.body.toLowerCase().includes(input.coreClaim.toLowerCase().slice(0, 20)) || input.supportingEvidence.some((evidence) => draft.body.toLowerCase().includes(evidence.toLowerCase().slice(0, 20)));
  const action = draft.targetAction === input.targetAction && draft.destinationUrl === input.destinationUrl;
  const structure = draft.hook.length >= 10 && draft.body.length >= 40 && draft.cta.length >= 10;
  const sixPs = evaluateSixPs(input, draft, sixPsTargets);
  const checks = { schema, audience, grounding, action, structure, sixPs: sixPs.accepted };
  const score = Object.values(checks).filter(Boolean).length / Object.keys(checks).length;
  const issues = [...sixPs.issues];
  if (!audience) issues.push("body is not visibly audience-specific");
  if (!grounding) issues.push("body is not grounded in the supplied claim or evidence");
  if (!action) issues.push("target action or destination URL changed");
  if (!structure) issues.push("hook, body, or CTA is too short");
  return { score, accepted: schema && action && sixPs.accepted && score >= minimumScore, issues, checks, sixPs };
}

export function linkedinQualityEvaluator(output: unknown): number {
  if (!isLinkedInDraft(output)) return 0;
  const draft = output as LinkedInDraft;
  const checks = [draft.hook.length >= 10, draft.body.length >= 40, draft.cta.length >= 10, /^https?:\/\//.test(draft.destinationUrl), draft.targetAction.length > 0];
  return checks.filter(Boolean).length / checks.length;
}
