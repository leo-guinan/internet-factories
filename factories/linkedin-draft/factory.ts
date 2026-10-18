import type { FactoryFunction } from "../../packages/runtime/src/index.js";
import type { DraftGenerator } from "./schemas.js";
import { linkedinDraftSpec } from "./schemas.js";
import { linkedinQualityEvaluator } from "./evaluator.js";

export function createLinkedInDraftFactory(generator: DraftGenerator): { spec: typeof linkedinDraftSpec; functions: Record<string, FactoryFunction>; outputSchema: string; inputSchemas: string[]; quality: (output: unknown) => number } {
  return {
    spec: linkedinDraftSpec,
    functions: { "linkedin-draft-generator": { execute: async (input, context) => { const result = await generator.generate(input as Parameters<DraftGenerator["generate"]>[0], context); return { output: result.draft, costUsd: result.costUsd, metadata: result.metadata }; } } },
    outputSchema: "linkedin-draft@1",
    inputSchemas: ["insight@1"],
    quality: linkedinQualityEvaluator
  };
}
