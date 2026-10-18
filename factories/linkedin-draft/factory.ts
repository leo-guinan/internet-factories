import type { FactoryFunction } from "../../packages/runtime/src/index.js";
import type { DraftGenerator } from "./schemas.js";
import { generatorFunction, isInsightInput, linkedinDraftSpec } from "./schemas.js";
import { evaluateLinkedInDraft } from "./evaluator.js";

export function createLinkedInDraftFactory(generator: DraftGenerator): { spec: typeof linkedinDraftSpec; functions: Record<string, FactoryFunction>; outputSchema: string; inputSchemas: string[]; quality: (output: unknown, input: unknown) => number } {
  return {
    spec: linkedinDraftSpec,
    functions: { "linkedin-draft-generator": generatorFunction(generator) },
    outputSchema: "linkedin-draft@1",
    inputSchemas: ["insight@1"],
    quality: (output, input) => isInsightInput(input) ? evaluateLinkedInDraft(input, output).score : 0
  };
}
