import type { AnswerStatus, BeatSpec, LensId, ReporterRights } from "../../press/src/types.js";

/**
 * Shared contracts with Creator APIs (github.com/leo-guinan/creator-apis, contracts/).
 * Creator APIs owns the content (personas, corps setups, story templates, approved stories);
 * factories own the operations that create and use it. Agent cards are the unit that moves between them.
 */

export interface CustodyHop {
  /** "creator:<id>" or "factory:<id>" */
  location: string;
  at: string;
  by: string;
  reason?: string;
  /** Hash of the card (without custody) when it arrived at this location. */
  cardSha256: string;
}

export interface AssetRef {
  id: string;
  kind: "voice" | "image";
  provider: string;
  providerRef?: string;
  uri: string;
  sha256: string;
  mime: string;
  createdAt: string;
  /** The operation receipt that produced the asset. */
  receiptId?: string;
  note?: string;
}

/** A named voice in an outside voice system (e.g. a Clipping Lab voice key). Not an asset: no bytes here. */
export interface VoiceProfile { provider: string; key: string; note?: string; }

export interface AgentCard {
  schema: "agent-card@1";
  id: string;
  version: number;
  name: string;
  title?: string;
  role: string;
  persona: { summary: string; theoryOfWinning?: string; voiceDirection?: string; backstory?: string; questioningStyle?: string; beat?: string; signatureQuestion?: string };
  press?: { lens: LensId; rights: ReporterRights; maxFollowups?: number; questionsPerBeat?: number; color?: string };
  voiceProfiles?: VoiceProfile[];
  assets?: { voices?: AssetRef[]; images?: AssetRef[] };
  origin: { creatorId: string; createdAt: string; source?: string };
  custody: CustodyHop[];
}

export interface PressCorpsCard {
  schema: "press-corps@1";
  id: string;
  version: number;
  name: string;
  creatorId: string;
  reporters: AgentCard[];
  beats: BeatSpec[];
}

export interface StoryScene { id: string; title: string; from: "statement" | "scoreboard" | "beat" | "commitments"; beatId?: string; pick: "all" | "highlights"; max?: number; }
export interface StoryTemplate {
  schema: "story-template@1";
  id: string;
  version: number;
  creatorId: string;
  source: "press-record@1";
  /** Tokens: {factoryName} {date} {documented} {questions} */
  title: string;
  logline: string;
  scenes: StoryScene[];
  /** Which answer statuses make the best drama, first = most. */
  highlightOrder: AnswerStatus[];
}

export interface StoryMoment { kind: "statement" | "exchange" | "scoreboard" | "commitment"; ref: string; speaker?: string; line: string; reply?: string; status?: string; why: string; }
export interface StoryDraft {
  schema: "story-draft@1";
  templateId: string;
  templateVersion: number;
  source: { schema: "press-record@1"; id: string; hash: string; factoryId: string };
  title: string;
  logline: string;
  scenes: Array<{ id: string; title: string; moments: StoryMoment[] }>;
  /** Every record entry the story quotes; the story can be checked against the sealed record. */
  provenance: string[];
}

export type EnergySource = "measured" | "provider_reported" | "estimated" | "unknown";
export interface EnergyReading { wh: number; source: EnergySource; method?: string; }
export interface EnergyTotals { measuredWh: number; providerReportedWh: number; estimatedWh: number; unknownSteps: number; methods: string[]; }

export type OperationName = "create-reporter" | "create-press-corps" | "create-voice" | "create-image" | "create-story";
export interface OperationReceipt {
  schema: "operation-receipt@1";
  id: string;
  operation: OperationName;
  factoryId: string;
  runId: string;
  status: "completed" | "failed" | "rejected";
  operatorId: string;
  creatorId?: string;
  /** Links the work to a customer order so Creator APIs can settle it. */
  orderRef?: string;
  artifact?: { id: string; sha256: string; schema: string };
  costUsd: number;
  energy: EnergyTotals;
  /** platform: runs on Creator APIs compute (metered); operator: an independent operator's hardware (energy reimbursed in Qi); provider: a third-party API. */
  hosting: "platform" | "operator" | "provider";
  startedAt: string;
  finishedAt: string;
  sha256: string;
}

// ---------------------------------------------------------------- validation

const nonEmpty = (v: unknown) => typeof v === "string" && v.trim().length > 0;
const isoish = (v: unknown) => typeof v === "string" && !Number.isNaN(Date.parse(v));

export function validateAgentCard(card: AgentCard): string[] {
  const e: string[] = [];
  if (!card || typeof card !== "object") return ["agent card must be an object"];
  if (card.schema !== "agent-card@1") e.push("schema must be agent-card@1");
  if (!/^[a-z0-9][a-z0-9-]{1,63}$/.test(card.id ?? "")) e.push("id must be a lowercase slug");
  if (!Number.isInteger(card.version) || card.version < 1) e.push("version must be a positive integer");
  if (!nonEmpty(card.name)) e.push("name is required");
  if (!nonEmpty(card.role)) e.push("role is required");
  if (!nonEmpty(card.persona?.summary)) e.push("persona.summary is required");
  if (!nonEmpty(card.origin?.creatorId) || !isoish(card.origin?.createdAt)) e.push("origin.creatorId and origin.createdAt are required");
  if (!Array.isArray(card.custody) || !card.custody.length) e.push("custody must start with the origin location");
  for (const hop of card.custody ?? []) if (!/^(creator|factory):[A-Za-z0-9._-]+$/.test(hop.location ?? "") || !isoish(hop.at) || !nonEmpty(hop.by) || !/^[0-9a-f]{64}$/.test(hop.cardSha256 ?? "")) e.push(`invalid custody hop ${JSON.stringify(hop)}`);
  if (card.role === "reporter" && !card.press) e.push("a reporter needs a press block (lens and rights)");
  if (card.press && (typeof card.press.rights?.mayChallenge !== "boolean" || !nonEmpty(card.press.lens))) e.push("press needs lens and rights.mayChallenge");
  for (const a of [...(card.assets?.voices ?? []), ...(card.assets?.images ?? [])]) if (!nonEmpty(a.uri) || !/^[0-9a-f]{64}$/.test(a.sha256 ?? "")) e.push(`asset ${a.id} needs a uri and sha256`);
  return e;
}

export function validateStoryTemplate(t: StoryTemplate): string[] {
  const e: string[] = [];
  if (t?.schema !== "story-template@1") e.push("schema must be story-template@1");
  if (t?.source !== "press-record@1") e.push("only press-record@1 sources are supported");
  if (!nonEmpty(t?.id) || !Number.isInteger(t?.version)) e.push("id and integer version are required");
  if (!t?.scenes?.length) e.push("at least one scene is required");
  for (const s of t?.scenes ?? []) if (s.from === "beat" && !s.beatId) e.push(`scene ${s.id} reads a beat but names no beatId`);
  return e;
}
