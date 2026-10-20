import { executeFactory, sha256Of, type ExecutionContext, type FactoryFunction, type FactoryRun, type FactorySpec } from "../../runtime/src/index.js";
import type { BeatSpec, PressRecord } from "../../press/src/types.js";
import { cardHash, pressCorpsFromCard } from "./agents.js";
import { validateAgentCard, type AgentCard, type AssetRef, type OperationName, type OperationReceipt, type PressCorpsCard, type StoryDraft, type StoryTemplate } from "./contracts.js";
import { energyTotals, estimateEnergy, type EnergyEstimate } from "./energy.js";
import type { AssetStore, ImageProvider, VoiceProvider } from "./providers.js";
import { draftStory } from "./story.js";

export type ReporterDraft = Omit<AgentCard, "schema" | "version" | "custody" | "origin"> & { version?: number; source?: string };
export interface CreateReporterInput { creatorId: string; draft: ReporterDraft; }
export interface CreatePressCorpsInput { creatorId: string; id: string; name: string; version?: number; reporters: AgentCard[]; beats: BeatSpec[]; }
export interface CreateVoiceInput { agent: AgentCard; sampleText: string; voiceId?: string; }
export interface CreateImageInput { prompt: string; agent?: AgentCard; size?: string; }
export interface CreateStoryInput { template: StoryTemplate; record: PressRecord; }
export interface MediaOutput { asset: AssetRef; agent?: AgentCard; }

export interface StudioOptions {
  factoryId: string;
  voice?: VoiceProvider;
  image?: ImageProvider;
  assets?: AssetStore;
  /** Declared estimate for this factory's own compute (reporter, corps and story steps). Without it, their energy is unknown. */
  localEnergy?: EnergyEstimate;
  now?: () => string;
}

export interface OperationContext { operatorId: string; creatorId?: string; orderRef?: string; hosting: OperationReceipt["hosting"]; runId?: string; }

const outputSchema: Record<OperationName, string> = { "create-reporter": "agent-card@1", "create-press-corps": "press-corps@1", "create-voice": "studio-media@1", "create-image": "studio-media@1", "create-story": "story-draft@1" };

function attachAsset(agent: AgentCard, asset: AssetRef): AgentCard {
  const assets = { voices: [...(agent.assets?.voices ?? [])], images: [...(agent.assets?.images ?? [])] };
  (asset.kind === "voice" ? assets.voices : assets.images).push(asset);
  return { ...agent, version: agent.version + 1, assets };
}

/** The factory-side creative operations. Each one is a factory function, so it gets runs, retries, costs, energy and artifacts like any other work. */
export function createStudio(options: StudioOptions) {
  const now = options.now ?? (() => new Date().toISOString());
  const local = () => estimateEnergy(options.localEnergy);
  const media = async (kind: "voice" | "image", result: Awaited<ReturnType<VoiceProvider["synthesize"]>>, provider: string, ctx: ExecutionContext, hint: string): Promise<AssetRef> => {
    if (!options.assets) throw new Error("an asset store is required for media operations");
    const stored = await options.assets.put(result.bytes, result.mime, hint);
    return { id: `ast_${stored.sha256.slice(0, 16)}`, kind, provider, providerRef: result.providerRef, uri: stored.uri, sha256: stored.sha256, mime: result.mime, createdAt: ctx.startedAt };
  };
  const functions: Record<OperationName, FactoryFunction> = {
    "create-reporter": { async execute(raw) {
      const input = raw as CreateReporterInput;
      const at = now();
      const { version, source, ...draft } = input.draft;
      const base: AgentCard = { schema: "agent-card@1", ...draft, version: version ?? 1, origin: { creatorId: input.creatorId, createdAt: at, source }, custody: [] };
      const card: AgentCard = { ...base, custody: [{ location: `factory:${options.factoryId}`, at, by: input.creatorId, reason: "created", cardSha256: cardHash(base) }] };
      const errors = validateAgentCard(card);
      if (errors.length) throw new Error(`invalid reporter: ${errors.join("; ")}`);
      return { output: card, metadata: { energy: local() } };
    } },
    "create-press-corps": { async execute(raw) {
      const input = raw as CreatePressCorpsInput;
      const card: PressCorpsCard = { schema: "press-corps@1", id: input.id, version: input.version ?? 1, name: input.name, creatorId: input.creatorId, reporters: input.reporters, beats: input.beats };
      pressCorpsFromCard(card); // throws with every problem listed
      return { output: card, metadata: { energy: local() } };
    } },
    "create-voice": { async execute(raw, ctx) {
      const input = raw as CreateVoiceInput;
      if (!options.voice) throw new Error("no voice provider configured");
      const errors = validateAgentCard(input.agent);
      if (errors.length) throw new Error(`invalid agent: ${errors.join("; ")}`);
      const result = await options.voice.synthesize({ text: input.sampleText, voiceDirection: input.agent.persona.voiceDirection, voiceId: input.voiceId }, ctx);
      const asset = await media("voice", result, options.voice.id, ctx, `${input.agent.id}-voice`);
      return { output: { asset, agent: attachAsset(input.agent, asset) } satisfies MediaOutput, costUsd: result.costUsd, metadata: { energy: result.energy, provider: options.voice.id } };
    } },
    "create-image": { async execute(raw, ctx) {
      const input = raw as CreateImageInput;
      if (!options.image) throw new Error("no image provider configured");
      if (input.agent) { const errors = validateAgentCard(input.agent); if (errors.length) throw new Error(`invalid agent: ${errors.join("; ")}`); }
      const result = await options.image.generate({ prompt: input.prompt, size: input.size }, ctx);
      const asset = await media("image", result, options.image.id, ctx, `${input.agent?.id ?? "image"}-image`);
      return { output: { asset, agent: input.agent ? attachAsset(input.agent, asset) : undefined } satisfies MediaOutput, costUsd: result.costUsd, metadata: { energy: result.energy, provider: options.image.id } };
    } },
    "create-story": { async execute(raw) {
      const input = raw as CreateStoryInput;
      return { output: draftStory(input.template, input.record) satisfies StoryDraft, metadata: { energy: local() } };
    } }
  };

  const specFor = (op: OperationName): FactorySpec => ({ id: `${options.factoryId}.${op}`, version: "1", nodes: [{ id: op, functionId: op, functionVersion: "1", maxAttempts: op === "create-voice" || op === "create-image" ? 2 : 1 }], minimumQuality: 1 });

  async function run<T = unknown>(op: OperationName, input: unknown, ctx: OperationContext): Promise<{ run: FactoryRun; output?: T; receipt: OperationReceipt }> {
    const factoryRun = await executeFactory(specFor(op), functions, input, { runId: ctx.runId, quality: (output) => (op === "create-reporter" ? (validateAgentCard(output as AgentCard).length ? 0 : 1) : 1) });
    const artifact = factoryRun.artifacts[0];
    const body: Omit<OperationReceipt, "sha256"> = {
      schema: "operation-receipt@1", id: `rcp_${sha256Of({ run: factoryRun.id, op }).slice(0, 16)}`, operation: op, factoryId: options.factoryId, runId: factoryRun.id,
      status: factoryRun.status === "completed" ? "completed" : factoryRun.status === "rejected" ? "rejected" : "failed",
      operatorId: ctx.operatorId, creatorId: ctx.creatorId, orderRef: ctx.orderRef,
      artifact: artifact ? { id: artifact.id, sha256: artifact.sha256, schema: outputSchema[op] } : undefined,
      costUsd: factoryRun.totalCostUsd, energy: energyTotals(factoryRun.nodeRuns), hosting: ctx.hosting,
      startedAt: factoryRun.startedAt!, finishedAt: factoryRun.finishedAt!
    };
    const receipt = { ...JSON.parse(JSON.stringify(body)), sha256: sha256Of(JSON.parse(JSON.stringify(body))) } as OperationReceipt;
    let output = factoryRun.output as T | undefined;
    if (output && (op === "create-voice" || op === "create-image")) {
      const m = output as unknown as MediaOutput;
      const asset = { ...m.asset, receiptId: receipt.id };
      output = { asset, agent: m.agent ? { ...m.agent, assets: { voices: (m.agent.assets?.voices ?? []).map((a) => (a.id === asset.id ? asset : a)), images: (m.agent.assets?.images ?? []).map((a) => (a.id === asset.id ? asset : a)) } } : undefined } as unknown as T;
    }
    return { run: factoryRun, output, receipt };
  }

  return {
    functions, specFor, run,
    createReporter: (input: CreateReporterInput, ctx: OperationContext) => run<AgentCard>("create-reporter", input, ctx),
    createPressCorps: (input: CreatePressCorpsInput, ctx: OperationContext) => run<PressCorpsCard>("create-press-corps", input, ctx),
    createVoice: (input: CreateVoiceInput, ctx: OperationContext) => run<MediaOutput>("create-voice", input, ctx),
    createImage: (input: CreateImageInput, ctx: OperationContext) => run<MediaOutput>("create-image", input, ctx),
    createStory: (input: CreateStoryInput, ctx: OperationContext) => run<StoryDraft>("create-story", input, ctx)
  };
}

export function receiptHashValid(receipt: OperationReceipt): boolean { const { sha256, ...rest } = receipt; return sha256Of(JSON.parse(JSON.stringify(rest))) === sha256; }
