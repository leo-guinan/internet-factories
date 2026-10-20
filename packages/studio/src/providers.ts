import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ExecutionContext } from "../../runtime/src/index.js";
import type { EnergyReading } from "./contracts.js";
import { estimateEnergy, type EnergyEstimate } from "./energy.js";

export interface MediaResult { bytes: Uint8Array; mime: string; providerRef?: string; costUsd?: number; energy?: EnergyReading; }
export interface VoiceProvider { id: string; synthesize(req: { text: string; voiceDirection?: string; voiceId?: string }, ctx: ExecutionContext): Promise<MediaResult>; }
export interface ImageProvider { id: string; generate(req: { prompt: string; size?: string }, ctx: ExecutionContext): Promise<MediaResult>; }

/** Where binary assets go. Artifacts carry the uri and hash, never the bytes. */
export interface AssetStore { put(bytes: Uint8Array, mime: string, hint: string): Promise<{ uri: string; sha256: string }>; }

export class LocalAssetStore implements AssetStore {
  constructor(private readonly dir: string) {}
  async put(bytes: Uint8Array, mime: string, hint: string) {
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const ext = mime.includes("png") ? "png" : mime.includes("jpeg") ? "jpg" : mime.includes("mpeg") ? "mp3" : mime.includes("wav") ? "wav" : "bin";
    mkdirSync(this.dir, { recursive: true });
    const path = join(this.dir, `${hint.replace(/[^a-z0-9-]/gi, "_")}-${sha256.slice(0, 12)}.${ext}`);
    writeFileSync(path, bytes);
    return { uri: `file://${path}`, sha256 };
  }
}

export interface OpenAICompatibleMediaOptions { endpoint: string; apiKey: string; model: string; costPerCallUsd?: number; costPer1kCharsUsd?: number; energy?: EnergyEstimate; transport?: (url: string, init: RequestInit) => Promise<Response>; }

/** POST {endpoint}/audio/speech. Energy is only recorded if you declare an estimate method; providers don't report it. */
export class OpenAICompatibleVoiceProvider implements VoiceProvider {
  readonly id: string;
  constructor(private readonly o: OpenAICompatibleMediaOptions & { defaultVoice: string; format?: "mp3" | "wav" }) { this.id = `openai-compatible:${o.model}`; }
  async synthesize(req: { text: string; voiceDirection?: string; voiceId?: string }, ctx: ExecutionContext): Promise<MediaResult> {
    const response = await (this.o.transport ?? fetch)(`${this.o.endpoint.replace(/\/$/, "")}/audio/speech`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${this.o.apiKey}`, "idempotency-key": ctx.idempotencyKey }, body: JSON.stringify({ model: this.o.model, input: req.text, voice: req.voiceId ?? this.o.defaultVoice, instructions: req.voiceDirection, response_format: this.o.format ?? "mp3" }) });
    if (!response.ok) throw new Error(`speech HTTP ${response.status}`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    return { bytes, mime: this.o.format === "wav" ? "audio/wav" : "audio/mpeg", providerRef: req.voiceId ?? this.o.defaultVoice, costUsd: (this.o.costPerCallUsd ?? 0) + (this.o.costPer1kCharsUsd ?? 0) * req.text.length / 1000, energy: estimateEnergy(this.o.energy, req.text.length) };
  }
}

/** POST {endpoint}/images/generations with b64_json output. */
export class OpenAICompatibleImageProvider implements ImageProvider {
  readonly id: string;
  constructor(private readonly o: OpenAICompatibleMediaOptions) { this.id = `openai-compatible:${o.model}`; }
  async generate(req: { prompt: string; size?: string }, ctx: ExecutionContext): Promise<MediaResult> {
    const response = await (this.o.transport ?? fetch)(`${this.o.endpoint.replace(/\/$/, "")}/images/generations`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${this.o.apiKey}`, "idempotency-key": ctx.idempotencyKey }, body: JSON.stringify({ model: this.o.model, prompt: req.prompt, size: req.size ?? "1024x1024", response_format: "b64_json", n: 1 }) });
    if (!response.ok) throw new Error(`image HTTP ${response.status}`);
    const payload = await response.json() as { data?: Array<{ b64_json?: string }> };
    const b64 = payload.data?.[0]?.b64_json;
    if (!b64) throw new Error("image response had no b64_json");
    return { bytes: Uint8Array.from(Buffer.from(b64, "base64")), mime: "image/png", costUsd: this.o.costPerCallUsd ?? 0, energy: estimateEnergy(this.o.energy) };
  }
}

/** Deterministic providers for tests and dry runs. Bytes are a function of the request, so reruns are reproducible. */
export const fixtureVoiceProvider = (energy?: EnergyReading): VoiceProvider => ({ id: "fixture-voice", async synthesize(req) { return { bytes: new TextEncoder().encode(`VOICE:${req.voiceId ?? "default"}:${req.text}`), mime: "audio/wav", providerRef: req.voiceId ?? "fixture-default", costUsd: 0.001, energy }; } });
export const fixtureImageProvider = (energy?: EnergyReading): ImageProvider => ({ id: "fixture-image", async generate(req) { return { bytes: new TextEncoder().encode(`IMAGE:${req.prompt}`), mime: "image/png", costUsd: 0.002, energy }; } });
