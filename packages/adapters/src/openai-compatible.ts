import type { ExecutionContext, FunctionResult } from "../../runtime/src/index.js";
import type { DraftGenerator, InsightInput, LinkedInDraft } from "../../../factories/linkedin-draft/schemas.js";

export interface OpenAICompatibleOptions {
  endpoint: string;
  apiKey: string;
  model: string;
  inputCostPerTokenUsd?: number;
  outputCostPerTokenUsd?: number;
  transport?: (url: string, init: RequestInit) => Promise<Response>;
}

type ChatResponse = { choices?: Array<{ message?: { content?: string } }>; usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number }; model?: string; };

function parseContent(content: string): LinkedInDraft {
  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)?.[1] ?? content;
  const parsed = JSON.parse(fenced) as LinkedInDraft;
  return parsed;
}

export class OpenAICompatibleDraftGenerator implements DraftGenerator {
  private readonly options: OpenAICompatibleOptions;
  constructor(options: OpenAICompatibleOptions) { this.options = options; }
  async generate(input: InsightInput, context: ExecutionContext): Promise<{ draft: LinkedInDraft; costUsd?: number; metadata?: Record<string, unknown> }> {
    const transport = this.options.transport ?? fetch;
    const response = await transport(this.options.endpoint.replace(/\/$/, "") + "/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${this.options.apiKey}`, "idempotency-key": context.idempotencyKey },
      body: JSON.stringify({ model: this.options.model, reasoning: { effort: "low" }, response_format: { type: "json_object" }, messages: [
        { role: "system", content: "Create a grounded LinkedIn post draft. Return JSON only with hook, body, cta, targetAction, destinationUrl. Do not invent evidence or change the target action or URL." },
        { role: "user", content: JSON.stringify({ insight: input, copyThinking: input.sixPs }) }
      ] })
    });
    if (!response.ok) throw new Error(`LLM HTTP ${response.status}`);
    const payload = await response.json() as ChatResponse;
    const draft = parseContent(payload.choices?.[0]?.message?.content ?? "");
    const promptTokens = payload.usage?.prompt_tokens ?? 0;
    const completionTokens = payload.usage?.completion_tokens ?? 0;
    const costUsd = promptTokens * (this.options.inputCostPerTokenUsd ?? 0) + completionTokens * (this.options.outputCostPerTokenUsd ?? 0);
    return { draft: { ...draft, insightId: input.insightId, campaignId: input.campaignId }, costUsd, metadata: { model: payload.model ?? this.options.model, promptTokens, completionTokens, totalTokens: payload.usage?.total_tokens ?? promptTokens + completionTokens } };
  }
}

export function openAICompatibleFunction(generator: DraftGenerator) {
  return { async execute(input: unknown, context: ExecutionContext): Promise<FunctionResult> { if (!input || typeof input !== "object") throw new Error("invalid insight input"); const result = await generator.generate(input as InsightInput, context); return { output: result.draft, costUsd: result.costUsd, metadata: result.metadata }; } };
}
