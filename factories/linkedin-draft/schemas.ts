import type { FactoryFunction, FactorySpec } from "../../packages/runtime/src/index.js";

export interface InsightInput {
  insightId: string;
  campaignId: string;
  sourceText: string;
  audience: string;
  coreClaim: string;
  supportingEvidence: string[];
  targetAction: string;
  destinationUrl: string;
  sixPs: SixPsBrief;
}

export interface SixPsBrief { people: string; positioning: string; promise: string; proof: string[]; priority: string; process: string; }

export interface LinkedInDraft {
  insightId: string;
  campaignId: string;
  hook: string;
  body: string;
  cta: string;
  targetAction: string;
  destinationUrl: string;
}

export const linkedinDraftSpec: FactorySpec = {
  id: "linkedin-draft",
  version: "1.0.0",
  nodes: [{ id: "generate", functionId: "linkedin-draft-generator", functionVersion: "1", maxAttempts: 1 }],
  minimumQuality: 0.8
};

export function isInsightInput(value: unknown): value is InsightInput {
  if (!value || typeof value !== "object") return false;
  const input = value as Partial<InsightInput>;
  const sixPs = input.sixPs as Partial<SixPsBrief> | undefined;
  return [input.insightId, input.campaignId, input.sourceText, input.audience, input.coreClaim, input.targetAction, input.destinationUrl].every((item) => typeof item === "string" && item.trim().length > 0)
    && Array.isArray(input.supportingEvidence) && input.supportingEvidence.length > 0 && input.supportingEvidence.every((item) => typeof item === "string" && item.trim().length > 0)
    && !!sixPs && [sixPs.people, sixPs.positioning, sixPs.promise, sixPs.priority, sixPs.process].every((item) => typeof item === "string" && item.trim().length > 0)
    && Array.isArray(sixPs.proof) && sixPs.proof.length > 0 && sixPs.proof.every((item) => typeof item === "string" && item.trim().length > 0);
}

export function isLinkedInDraft(value: unknown): value is LinkedInDraft {
  if (!value || typeof value !== "object") return false;
  const draft = value as Partial<LinkedInDraft>;
  return [draft.insightId, draft.campaignId, draft.hook, draft.body, draft.cta, draft.targetAction, draft.destinationUrl].every((item) => typeof item === "string" && item.trim().length > 0);
}

export interface DraftGenerator {
  generate(input: InsightInput, context: Parameters<FactoryFunction["execute"]>[1]): Promise<{ draft: LinkedInDraft; costUsd?: number; metadata?: Record<string, unknown> }>;
}

export function generatorFunction(generator: DraftGenerator): FactoryFunction {
  return { async execute(input, context) { if (!isInsightInput(input)) throw new Error("invalid insight input"); const result = await generator.generate(input, context); return { output: result.draft, costUsd: result.costUsd, metadata: result.metadata }; } };
}
