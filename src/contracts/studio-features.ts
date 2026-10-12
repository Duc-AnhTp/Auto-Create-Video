import type { UnifiedTimeline, TimelineVideoShot, TimelineDialogueCue, TimelineSfxCue, TimelineAmbienceCue, TimelineSubtitleCue } from "./timeline.js";
import type { StudioJob } from "./studio.js";

export type { UnifiedTimeline, TimelineVideoShot, TimelineDialogueCue, TimelineSfxCue, TimelineAmbienceCue, TimelineSubtitleCue, StudioJob };

export interface TakeItem {
  id: string;
  series_id: string;
  episode_number: number;
  shot_id: string;
  take_number: number;
  provider: string;
  local_path?: string;
  remote_url?: string;
  is_approved: boolean;
  qa_status?: "PASS" | "WARN" | "FAIL" | "NOT_RUN" | "UNAVAILABLE";
  qa_score?: number;
  qa_notes?: string;
  qa_report_json?: string;
  prompt?: string;
  created_at?: string;
}

export interface QaMetrics {
  arcfaceSimilarity: number;
  status: "PASS" | "WARN" | "FAIL";
  durationDeltaSec: number;
  motionScore?: number;
  notes?: string;
}

export interface NarrativeNode {
  id: string;
  label: string;
  type: "character" | "location" | "prop";
  status?: string;
  details?: string;
  image?: string;
  x?: number;
  y?: number;
}

export interface NarrativeEdge {
  source: string;
  target: string;
  relation: string;
  sentiment?: "positive" | "negative" | "neutral";
}

export interface PropLedgerEntry {
  propId: string;
  propName: string;
  fromHolder?: string | null;
  toHolder?: string | null;
  episodeNumber: number;
  createdAt?: string;
}

export interface ChekhovGunItem {
  id: string;
  name: string;
  description?: string;
  status: "planted" | "active" | "dormant" | "fired" | "resolved" | string;
  plantedEpisode: number;
  payoffEpisode?: number | null;
  lastActiveEpisode?: number | null;
  isDormant: boolean;
}

export interface NarrativeGraphData {
  nodes: NarrativeNode[];
  edges: NarrativeEdge[];
  propLedger: PropLedgerEntry[];
  chekhovGuns: ChekhovGunItem[];
  worldState?: Record<string, string>;
}

export interface StemChannelState {
  name: string;
  path: string;
  volume: number; // 0.0 to 1.5, default 1.0
  muted: boolean;
  solo: boolean;
  level: number; // 0.0 to 1.0 (RMS)
  peak: number; // 0.0 to 1.0 (Peak)
}

export interface AutoDuckingConfig {
  enabled: boolean;
  threshold: number; // -30dB to -10dB, default -24dB
  duckingAmountDb: number; // -24dB to -6dB, default -14dB
  attackMs: number; // default 50ms
  releaseMs: number; // default 300ms
}

export interface TimelineBranchItem {
  id: string;
  series_id: string;
  name: string;
  description?: string | null;
  parent_branch_id?: string | null;
  forked_from_snapshot_id?: string | null;
  forked_at_episode: number;
  is_canonical: number;
  created_at: string;
}

export interface MultiverseBranchDiff {
  seriesId: string;
  branchA: { id: string; name: string; isCanonical: boolean };
  branchB: { id: string; name: string; isCanonical: boolean };
  forkedAtEpisode: number;
  divergentEpisodes: number[];
  characterStatusDiffs: Array<{
    characterId: string;
    characterName: string;
    statusInBranchA: string;
    statusInBranchB: string;
  }>;
  propHolderDiffs: Array<{
    propId: string;
    propName: string;
    holderInBranchA: string | null;
    holderInBranchB: string | null;
  }>;
  stateHashDiffs: Array<{
    episodeNumber: number;
    snapshotHashA?: string;
    snapshotHashB?: string;
    isIdentical: boolean;
  }>;
}

export type InvariantViolationType =
  | "anti_resurrection"
  | "prop_custody_violation"
  | "epistemic_knowledge_violation"
  | "spatio_temporal_violation";

export type InvariantSeverity = "fatal" | "repairable_by_bridge";

export interface InvariantViolation {
  gate: string;
  type: InvariantViolationType;
  severity: InvariantSeverity;
  sceneNumber: number;
  characterId?: string;
  characterName?: string;
  propId?: string;
  propName?: string;
  currentHolderId?: string;
  targetHolderId?: string;
  description: string;
  quote?: string;
  reconciliationSuggestion: string;
}

export interface BridgeSceneSpec {
  bridgeSceneNumber: number | string;
  slugline: string;
  purpose: string;
  narrativeDescription: string;
  dialogue?: Array<{ speaker: string; line: string }>;
  reconciledViolationType: InvariantViolationType;
  propDelta?: { propId: string; fromHolderId: string; toHolderId: string };
}

export interface ValidationReport {
  status: "PASS" | "WARN" | "FAIL";
  violations: InvariantViolation[];
  parsedScenesCount: number;
  fatalCount: number;
  repairableCount: number;
}

export interface AutoRepairResult {
  repairedScript: string;
  validationReport: ValidationReport;
  appliedBridges: BridgeSceneSpec[];
  isFullyReconciled: boolean;
}

export interface SemanticMemoryEntityItem {
  id: string;
  entityType: "character" | "prop" | "location" | "world_rule" | "relationship" | "episode_summary" | "canon_fact" | "story_beat";
  entityId: string;
  text: string;
  similarity: number;
  compositeScore: number;
  importance: number;
}

export interface PrunedSemanticContextData {
  relevantCharacters: Array<{ id: string; name: string; role: string; status: string; visual_summary?: string }>;
  relevantProps: Array<{ id: string; name: string; current_holder_id?: string; description?: string }>;
  relevantLocations: Array<{ id: string; name: string; visual_summary?: string }>;
  relevantRules: string[];
  totalRetrievedItems: number;
  estimatedTokens: number;
  scores: Array<{ id: string; type: string; score: number }>;
}

export interface GatewayMetricsData {
  jobs?:{statuses:Record<string,number>;measuredJobs:number;counters:Record<string,number>};
  runtime?:{recovery?:{ttsAttempts:number;pendingInvoices:number;maintenance:number};activeJobs:Array<{provider:string;count:number}>;requestsLastMinute:Array<{provider:string;count:number}>;waiting:Array<{provider:string;kind:string;count:number}>};
  rates: Record<string, number>;
  rateLimits: Record<string, { maxConcurrent: number; maxRpm: number }>;
  providers: string[];
  circuitBreakers?: Record<string, "CLOSED" | "HALF_OPEN" | "OPEN">;
}

export interface CharacterTurnaroundSummary {
  characterId: string;
  characterName: string;
  hasTurnaround: boolean;
  views?: {
    front?: string;
    threeQuarter?: string;
    profile?: string;
    fullBody?: string;
  } | null;
  faceEmbeddingLength: number;
}

export interface ProviderJobSummary {
  id: string;
  shot_id: string;
  provider: string;
  status: string;
  metadata_json?:string;
  cost_category: string;
  estimated_cost_usd: number;
  confirmed_cost_usd: number;
  output_local_path?: string;
  completed_at?: string;
}

export interface ReconciliationData {
  legacyOwnership?:{count:number;rows:Record<string,unknown>[]};
  tokenSavings?:{usageStatus:"available"|"unavailable";totalInputTokens:number;totalOutputTokens:number;totalCachedTokens:number;totalCacheCreationTokens:number;totalEstimatedSavingsUsd:number|null};
  llmRequests?:Record<string,unknown>[];
  groups?:Array<{id:string;shotId:string;primaryId:string;hedgeId?:string;winnerId?:string;hedgeDueAt:number;status:string;reason?:string}>;
  audit?:Record<string,unknown>[];
  summary: {
    estimatedUsd: number;
    reservedUsd: number;
    confirmedUsd: number;
    uncertainUsd: number;
    totalCommittedUsd: number;
    availableUsd: number;
    budgetCapUsd: number;
  };
  jobs: ProviderJobSummary[];
  turnarounds: CharacterTurnaroundSummary[];
}


export type TimelineAudioCue = TimelineSfxCue | TimelineAmbienceCue;
