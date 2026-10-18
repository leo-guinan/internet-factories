import { isInsightInput, isLinkedInDraft, type InsightInput, type LinkedInDraft } from "./schemas.js";

export interface DraftEvaluation { score: number; accepted: boolean; issues: string[]; checks: { schema: boolean; audience: boolean; grounding: boolean; action: boolean; structure: boolean }; }

export function evaluateLinkedInDraft(input: InsightInput, output: unknown, minimumScore = 0.8): DraftEvaluation {
  const schema = isLinkedInDraft(output);
  if (!schema) return { score: 0, accepted: false, issues: ["output does not match LinkedInDraft"], checks: { schema: false, audience: false, grounding: false, action: false, structure: false } };
  const draft = output as LinkedInDraft;
  const audience = draft.body.toLowerCase().includes(input.audience.toLowerCase().split(/\s+/)[0]);
  const grounding = schema && (draft.body.toLowerCase().includes(input.coreClaim.toLowerCase().slice(0, 20)) || input.supportingEvidence.some((evidence) => draft.body.toLowerCase().includes(evidence.toLowerCase().slice(0, 20))));
  const action = schema && draft.targetAction === input.targetAction && draft.destinationUrl === input.destinationUrl;
  const structure = schema && draft.hook.length >= 10 && draft.body.length >= 40 && draft.cta.length >= 10;
  const checks = { schema, audience, grounding, action, structure };
  const score = Object.values(checks).filter(Boolean).length / Object.keys(checks).length;
  const issues: string[] = [];
  if (!schema) issues.push("output does not match LinkedInDraft");
  if (!audience) issues.push("body is not visibly audience-specific");
  if (!grounding) issues.push("body is not grounded in the supplied claim or evidence");
  if (!action) issues.push("target action or destination URL changed");
  if (!structure) issues.push("hook, body, or CTA is too short");
  return { score, accepted: score >= minimumScore, issues, checks };
}

export function linkedinQualityEvaluator(output: unknown): number {
  if (!isLinkedInDraft(output)) return 0;
  const draft = output as LinkedInDraft;
  const checks = [draft.hook.length >= 10, draft.body.length >= 40, draft.cta.length >= 10, /^https?:\/\//.test(draft.destinationUrl), draft.targetAction.length > 0];
  return checks.filter(Boolean).length / checks.length;
}
