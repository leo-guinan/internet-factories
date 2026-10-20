import type { FactoryRun } from "../../runtime/src/index.js";
import type { ControlDecision, FactoryObjective, FactoryObservation, WeeklyPlan } from "../../objectives/src/index.js";

/** Anything a reporter can ask about or a manager can cite. Every ref must resolve inside the factory's dossier. */
export type EvidenceKind = "run" | "node_run" | "artifact" | "objective" | "observation" | "decision" | "plan" | "external" | "exchange" | "commitment";
export interface EvidenceRef { kind: EvidenceKind; id: string; }

/** Evidence that lives outside the runtime (a screenshot, a client email, a public post). It must still be captured into the dossier to be citable. */
export interface ExternalEvidence { id: string; uri: string; description: string; capturedAt: string; content?: unknown; }

/** Everything a factory produced or recorded in the period. This is the only source of truth a press conference can use. */
export interface FactoryDossier {
  factoryId: string;
  factoryName?: string;
  managerId: string;
  period: { start: string; end: string };
  runs?: FactoryRun[];
  objectives?: FactoryObjective[];
  observations?: FactoryObservation[];
  decisions?: ControlDecision[];
  plans?: WeeklyPlan[];
  external?: ExternalEvidence[];
  /** The last press record for this factory. Its open commitments become this week's scoreboard. */
  previousRecord?: PressRecord;
}

// ---------------------------------------------------------------- press corps

/** Lenses are the code behind a reporter: which evidence they look at and what they ask. Personas are configuration on top. */
export type LensId = "scoreboard" | "film" | "business" | "people" | "reproducibility" | "skeptic";

export interface ReporterRights {
  /** Asks a follow-up when their own question gets an answer that is not fully documented. */
  mayChallenge: boolean;
  /** Asks follow-ups on any reporter's undocumented or contradicted answer, not just their own. */
  challengesOthers?: boolean;
  /** Treats a claimed win with no evidence as unknown in their question framing. */
  refusesUnevidencedWins?: boolean;
}

export interface ReporterPersona {
  id: string;
  name: string;
  title?: string;
  lens: LensId;
  theoryOfWinning: string;
  persona: string;
  /** Voice ids per TTS provider, carried through untouched for the show layer. */
  voice?: Record<string, string>;
  color?: string;
  rights: ReporterRights;
  maxFollowups?: number;
  questionsPerBeat?: number;
}

export type BeatKind = "statement" | "questions" | "commitments" | "final";
export interface BeatSpec { id: string; name: string; kind: BeatKind; minutes: number; reporters: string[]; defaultShot?: string; }

export interface PressCorps { id: string; name: string; reporters: ReporterPersona[]; beats: BeatSpec[]; }

// ---------------------------------------------------------------- questions

export interface QuestionDraft { lens: LensId; about: string; text: string; probes: EvidenceRef[]; priority: number; }
export interface PreparedQuestion extends QuestionDraft { id: string; beatId: string; reporterId: string; reporterName: string; }
export interface PreparedBeat { spec: BeatSpec; questions: PreparedQuestion[]; }
export interface PressPlan { factoryId: string; factoryName: string; managerId: string; period: { start: string; end: string }; preparedAt: string; corpsId: string; beats: PreparedBeat[]; scoreboard: ScoredCommitment[]; }

// ---------------------------------------------------------------- answers

export interface Claim { statement: string; evidence: EvidenceRef[]; metric?: { name: string; value: number; unit?: string }; }
export interface DraftAnswer { text: string; claims: Claim[]; declined?: boolean; }
export interface CommitmentDraft { statement: string; metric: string; target: number; unit: string; due: string; direction?: "up" | "down"; objectiveId?: string; }

export interface ManagerContext { dossier: FactoryDossier; plan: PressPlan; resolve(ref: EvidenceRef): EvidenceEntry | undefined; }
/** A factory manager can be a person typing answers, an agent, or the ledger itself. All are graded the same way. */
export interface FactoryManager {
  id: string;
  name: string;
  openingStatement?(ctx: ManagerContext): Promise<DraftAnswer>;
  answer(question: PreparedQuestion, ctx: ManagerContext): Promise<DraftAnswer>;
  commit?(ctx: ManagerContext): Promise<CommitmentDraft[]>;
}

export interface EvidenceEntry { ref: EvidenceRef; summary: string; value: unknown; sha256: string; }
export interface CitedEvidence { ref: EvidenceRef; resolved: boolean; sha256?: string; }
export type ClaimCheck = "supported" | "unresolved" | "contradicted";
export interface GradedClaim { statement: string; evidence: CitedEvidence[]; metric?: Claim["metric"]; check: ClaimCheck; metricVerified?: boolean; note?: string; }
export type AnswerStatus = "documented" | "partial" | "undocumented" | "contradicted" | "declined";
export interface AnswerGrade { status: AnswerStatus; claims: GradedClaim[]; issues: string[]; addressesProbes: boolean; }

// ---------------------------------------------------------------- record

export interface Exchange {
  id: string; beatId: string; reporterId: string; reporterName: string; lens: LensId;
  question: string; probes: EvidenceRef[]; answer: DraftAnswer; grade: AnswerGrade; followupOf?: string;
}
export interface BeatRecord { id: string; name: string; kind: BeatKind; statement?: { answer: DraftAnswer; grade: AnswerGrade }; exchanges: Exchange[]; }

export interface Commitment extends CommitmentDraft { id: string; madeAt: string; recordId: string; accountable: boolean; issues: string[]; }
export type CommitmentStatus = "achieved" | "partial" | "missed" | "unknown" | "pending";
export interface ScoredCommitment { commitment: Commitment; status: CommitmentStatus; actual?: number; evidence: EvidenceRef[]; reason: string; }

export interface PressSummary { questions: number; documented: number; partial: number; undocumented: number; contradicted: number; declined: number; documentedRate: number; commitmentsScored: number; commitmentsAchieved: number; }

export interface PressRecord {
  schema: "press-record@1";
  id: string;
  factoryId: string; factoryName: string; managerId: string; managerName: string;
  heldAt: string; period: { start: string; end: string };
  corps: Array<{ id: string; name: string; lens: LensId }>;
  scoreboard: ScoredCommitment[];
  beats: BeatRecord[];
  commitments: Commitment[];
  /** New accountable commitments plus any still pending from earlier records. Next presser scores these. */
  openCommitments: Commitment[];
  /** Every piece of evidence cited or probed, with its hash at the moment it was cited. */
  evidence: Array<{ ref: EvidenceRef; sha256: string }>;
  summary: PressSummary;
  previousRecordId?: string;
  previousRecordHash?: string;
  hash: string;
}
