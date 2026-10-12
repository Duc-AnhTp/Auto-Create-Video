
export class FatalSqliteError extends Error {
  readonly code="SQLITE_FATAL";

  constructor(message: string) {
    super(message);
    this.name = "FatalSqliteError";
  }
}

export class DeltaValidationError extends Error {
  readonly code="CANON_DELTA_INVALID";

  public readonly errors: string[];
  constructor(message: string, errors: string[] = []) {
    super(message);
    this.name = "DeltaValidationError";
    this.errors = errors;
  }
}

export class UnauthorizedCanonCommitError extends Error {
  readonly code="CANON_APPROVAL_REQUIRED";

  constructor(message: string) {
    super(message);
    this.name = "UnauthorizedCanonCommitError";
  }
}

export class InvalidLifecycleTransitionError extends Error {
  readonly code="LIFECYCLE_TRANSITION";

  constructor(message: string) {
    super(message);
    this.name = "InvalidLifecycleTransitionError";
  }
}

export interface BibleManagerOptions {
  maintenanceToken?: string;
  seriesCoordinator?: {enter(seriesId:string,token?:string):()=>void};
  strictSqlite?: boolean;
  allowMemoryFallback?: boolean;
}

export interface SeriesMetadataRecord {
  id: string;
  title: string;
  logline?: string;
  genre?: string;
  visual_style?: string;
  visualStyle?: string;
  negative_prompt?: string;
  negativePrompt?: string;
  aspect_ratio?: "9:16" | "16:9";
  aspectRatio?: "9:16" | "16:9";
  fps?: number;
  created_at?: string;
  createdAt?: string;
}

export interface CharacterRecord {
  id: string;
  name: string;
  role?: "protagonist" | "antagonist" | "supporting" | "ally" | "mentor" | string;
  series_id?: string;
  archetype?: string;
  visual_summary?: string;
  personality_traits?: string[];
  voice_profile_id?: string;
  voice_embedding_path?: string;
  status?: "alive" | "injured" | "deceased" | "missing";
  face_reference_image?: string;
  character_sheet_path?: string;
  current_wardrobe_id?: string;
  distinguishing_marks?: string;
  aliases_json?: string;
  relationship_graph_json?: string;
  face_embedding_json?: string;
  created_at?: string;
}

export interface CharacterStateRecord {
  id?: number;
  character_id: string;
  episode_number: number;
  scene_id?: string | null;
  status: CharacterRecord["status"];
  current_wardrobe_id?: string | null;
  distinguishing_marks?: string | null;
  updated_at?: string;
}

export interface CharacterWardrobeRecord {
  id: string;
  character_id: string;
  outfit_name: string;
  visual_description: string;
  reference_image_path?: string;
  is_default?: boolean | number;
}

export interface LocationRecord {
  id: string;
  name: string;
  series_id?: string;
  visual_summary?: string;
  atmospheric_rules?: string;
  reference_image_path?: string;
  lighting_mood?: string;
}

export interface LocationStateRecord {
  id?: number;
  location_id: string;
  episode_number: number;
  scene_id?: string | null;
  atmospheric_rules?: string | null;
  lighting_mood?: string | null;
  status: "accessible" | "damaged" | "destroyed" | "restricted";
  updated_at?: string;
}

export interface KeyPropRecord {
  id: string;
  name: string;
  series_id?: string;
  visual_summary?: string;
  description?: string;
  current_holder_id?: string;
  reference_image_path?: string;
  status?: "intact" | "damaged" | "lost" | "destroyed";
  created_at?: string;
}

export interface PropStateRecord {
  id?: number;
  prop_id: string;
  episode_number: number;
  scene_id?: string | null;
  current_holder_id?: string | null;
  status: KeyPropRecord["status"];
  updated_at?: string;
}

export interface CharacterKnowledgeRecord {
  character_id: string;
  fact_key: string;
  revealed_in_episode: number;
  notes?: string;
}

export interface EpisodeSummaryRecord {
  series_id?: string;
  episode_number: number;
  title: string;
  logline: string;
  major_events: string[];
  delta_changes?: Record<string, unknown>;
  created_at?: string;
}

export interface ApiUsageRecord {
  episode_number?: number;
  shot_id?: string;
  provider: string;
  type: "llm" | "video" | "tts";
  units: number;
  cost_usd: number;
  timestamp: string;
}

export interface ReferenceAssetRecord {
  id: string; // e.g. "ref_char_minh_face_front_v1"
  series_id: string;
  entity_type: "character" | "wardrobe" | "location" | "prop";
  entity_id: string;
  asset_kind:
    | "face_front"
    | "face_three_quarter"
    | "face_profile"
    | "full_body"
    | "turnaround"
    | "environment"
    | "prop_detail";
  image_path: string;
  version: number;
  is_active: boolean | number;
  description?: string;
  created_at?: string;
}

export interface StoryboardKeyframeRecord {
  id: string; // e.g. "sb_cyber-saigon_ep01_sc01_sh01_v1"
  series_id: string;
  episode_number: number;
  shot_id: string;
  version: number;
  composition_layout: string;
  camera_framing: "establishing" | "wide" | "medium" | "close_up" | "extreme_close_up" | "action";
  image_path: string;
  is_approved: boolean | number;
  used_references_json: string; // Serialized list of reference asset IDs used for this shot
  created_at?: string;
}

export type CostCategory = "estimated" | "reserved" | "confirmed" | "uncertain";

export type OrchestrationJobStatus =
  | "queued"
  | "reserved"
  | "submitting"
  | "submitted"
  | "running"
  | "completed"
  | "failed"
  | "uncertain_timeout"
  | "cancelled";

export interface ProviderJobRecord {
  id: string; // Unique local job ID
  series_id: string;
  episode_number: number;
  shot_id: string;
  provider: string; // "api_kling", "api_runway", "api_veo", "mock", etc.
  model_name?: string;
  provider_job_id?: string;
  idempotency_key?: string;
  spec_hash: string;
  status: OrchestrationJobStatus;
  attempt_count: number;
  max_attempts: number;
  cost_category?: CostCategory;
  estimated_cost_usd: number;
  reserved_cost_usd: number;
  confirmed_cost_usd: number;
  uncertain_cost_usd: number;
  output_url?: string;
  output_local_path?: string;
  error_code?: string;
  error_message?: string;
  is_retryable: boolean | number;
  worker_id?: string;
  lock_expires_at?: string;
  metadata_json?: string;
  created_at?: string;
  updated_at?: string;
  completed_at?: string;
}

export interface SeriesBudgetRecord {
  series_id: string;
  max_budget_usd: number;
  warning_threshold_ratio: number;
  is_hard_capped: boolean | number;
  notes?: string;
  updated_at: string;
}

export interface ProviderRateCardRecord {
  id: string; // e.g. "rate_kling_v2_20260901"
  provider: string;
  model_name: string;
  rate_per_sec_usd: number;
  rate_per_unit_usd?: number;
  unit_type: "second" | "token" | "request" | "megapixel";
  currency: string;
  effective_date: string; // Date pricing was verified against official documentation
  source_doc_url?: string;
  notes?: string;
  created_at: string;
}

export interface LlmTokenUsageRecord {
  series_id: string;
  provider: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
  cached_tokens: number;
  cache_creation_tokens: number;
  estimated_savings_usd: number | null;
  created_at: string;
}

export interface LlmTokenUsageSummary {
  usageStatus:"available"|"unavailable";
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCachedTokens: number;
  totalCacheCreationTokens: number;
  totalEstimatedSavingsUsd: number | null;
  cacheHitRatio: number;
}

export interface BudgetLedgerSummary {
  seriesId: string;
  maxBudgetUsd: number;
  estimatedCostUsd: number;
  confirmedCostUsd: number;
  confirmedInvoicedCostUsd: number;
  confirmedEstimatedCostUsd: number;
  confirmedManualCostUsd: number;
  uncertainAttemptCount: number;
  reservedCostUsd: number;
  uncertainCostUsd: number;
  totalCommittedUsd: number;
  remainingAvailableUsd: number;
  isExceeded: boolean;
}

export interface ShotTakeRecord {
  id: string; // e.g. "sc01_sh01_take01"
  series_id: string;
  episode_number: number;
  shot_id: string;
  take_number?: number;
  provider: string;
  prompt: string;
  seed?: number;
  local_path: string;
  duration_sec: number;
  qa_status?: "PASS" | "WARN" | "FAIL" | "NOT_RUN" | "UNAVAILABLE";
  qa_score?: number;
  qa_notes?: string;
  qa_report_json?: string; // Multi-frame evaluation metrics, evidence frames, lip-sync status
  storyboard_keyframe_id?: string; // Link to approved storyboard keyframe layout
  used_references_json?: string; // Serialized reference asset IDs bound to this render
  is_approved?: boolean | number;
  cost_usd?: number;
  created_at?: string;
}

export interface AtomicReserveShotTakeParams {
  seriesId: string;
  episodeNumber: number;
  shotId: string;
  provider: string;
  prompt: string;
  minTakeNumber?: number;
  localPathBuilder?: (takeNumber: number, takeNumStr: string) => string;
  durationSec?: number;
  seed?: number;
  storyboardKeyframeId?: string;
  usedReferencesJson?: string;
  isApproved?: boolean;
  costUsd?: number;
  qaStatus?: "PASS" | "WARN" | "FAIL" | "NOT_RUN" | "UNAVAILABLE";
}

export interface AtomicReserveShotTakeResult {
  takeNumber: number;
  takeNumStr: string;
  takeId: string;
  localPath: string;
  record: ShotTakeRecord;
}

export interface StateEventRecord {
  id?: number;
  series_id: string;
  episode_number: number;
  scene_id?: string | null;
  entity_type: "character" | "prop" | "location" | "world";
  entity_id: string;
  event_type: "status_change" | "prop_transfer" | "wardrobe_change" | "knowledge_revealed" | "world_state";
  from_state_json?: string | null;
  to_state_json: string;
  story_time?: string | null;
  confirmation_source: "director_approval" | "script_delta" | "manual_override" | "pipeline_commit";
  created_at?: string;
}

export interface CanonSnapshotRecord {
  id: string;
  series_id: string;
  episode_number: number;
  snapshot_version: number;
  state_hash: string;
  snapshot_json: string;
  created_at: string;
}

export type EpisodeLifecycleStatus =
  | "draft"
  | "rendered"
  | "approved"
  | "committed"
  | "rejected"
  | "failed";

export interface EpisodeLifecycleRecord {
  episode_number: number;
  series_id: string;
  status: EpisodeLifecycleStatus;
  snapshot_id?: string | null;
  needs_review: boolean | number;
  review_notes?: string | null;
  storyboard_approved_at?: string | null;
  updated_at: string;
}

export interface AppliedCommitRecord {
  commit_id: string;
  episode_number: number;
  summary_title: string;
  applied_at: string;
}

export interface CanonMigrationRecord {
  version: number;
  name: string;
  applied_at: string;
}

export interface SourceWorkRecord {
  id: string; // e.g. "src_cyber_saigon_novel"
  series_id: string;
  title: string;
  author?: string | null;
  source_type: "prose" | "screenplay" | "novel" | "markdown" | "txt";
  current_revision: number;
  content_hash: string;
  raw_text: string;
  normalized_text: string;
  normalization_rules_json?: string;
  metadata_json?: string;
  created_at?: string;
  updated_at?: string;
}

export interface SourceRevisionRecord {
  id: string; // e.g. `${sourceId}_rev${revision}`
  source_id: string;
  series_id: string;
  revision: number;
  content_hash: string;
  raw_text: string;
  normalized_text: string;
  normalization_rules_json?: string;
  metadata_json?: string;
  created_at?: string;
}

export interface SourceUnitRecord {
  id: string; // e.g. "unit_src_cyber_ch01"
  source_id: string;
  series_id: string;
  revision: number;
  unit_type: "chapter" | "scene" | "act" | "prologue" | "epilogue" | string;
  unit_number: number;
  title: string;
  order_index: number;
  char_start: number;
  char_end: number;
  raw_text: string;
  summary?: string | null;
  token_count_estimate?: number;
  created_at?: string;
}

export interface SourceBlockRecord {
  id: string; // e.g. "blk_src_cyber_ch01_001"
  source_id: string;
  unit_id: string;
  series_id: string;
  revision: number;
  block_index: number;
  char_start: number;
  char_end: number;
  content: string;
  is_dialogue: boolean | number;
  speaker_candidate?: string | null;
  chunk_group_id?: string | null;
  created_at?: string;
}

export interface StoryBeatRecord {
  id: string; // e.g. "beat_src_cyber_b001"
  source_id: string;
  source_unit_id?: string | null;
  series_id: string;
  beat_order: number;
  name: string;
  description: string;
  participating_characters_json: string; // array of char ids/names
  location_id?: string | null;
  story_time?: string | null;
  is_flashback: boolean | number;
  preconditions_json?: string;
  post_state_changes_json?: string;
  source_citations_json?: string; // [{ charStart, charEnd, excerpt }]
  source_span_start?: number | null;
  source_span_end?: number | null;
  is_mandatory: boolean | number;
  created_at?: string;
}

export interface StoryThreadRecord {
  id: string; // e.g. "thread_chip_conspiracy"
  series_id: string;
  name: string;
  thread_type: "main" | "subplot" | "character_arc" | string;
  description: string;
  setup_beat_id?: string | null;
  payoff_beat_id?: string | null;
  status: "open" | "resolved" | "dropped";
  dependencies_json?: string;
  created_at?: string;
}

export interface KnowledgeStateRecord {
  id?: number;
  series_id: string;
  fact_key: string;
  fact_type: "source_fact" | "adaptation_decision" | "character_knowledge" | "audience_knowledge";
  entity_id?: string | null;
  revealed_at_episode?: number | null;
  revealed_at_beat_id?: string | null;
  is_flashback?: boolean | number;
  notes?: string | null;
  created_at?: string;
}

export interface SeriesPlanRecord {
  id: string; // e.g. "plan_cyber_saigon_v1"
  series_id: string;
  source_id: string;
  revision: number;
  target_episodes: number;
  target_duration_per_episode_sec: number;
  pacing_preset: "fast" | "standard" | "contemplative" | string;
  status: "draft" | "approved" | "active" | "stale" | "archived";
  warnings_json?: string;
  summary_json: string;
  created_at?: string;
  updated_at?: string;
}

export interface PlannedEpisodeRecord {
  id: string; // e.g. "plan_ep_01"
  plan_id: string;
  series_id: string;
  episode_number: number;
  title: string;
  logline: string;
  goal?: string | null;
  opening?: string | null;
  development?: string | null;
  climax?: string | null;
  ending?: string | null;
  target_duration_sec: number;
  state_in_json?: string;
  planned_state_out_json?: string;
  dependencies_json?: string;
  estimated_scenes?: number;
  estimated_shots?: number;
  created_at?: string;
}

export interface CoverageLedgerRecord {
  id: string; // e.g. "cov_ch01_ep01"
  plan_id: string;
  series_id: string;
  source_id: string;
  source_unit_id: string;
  source_block_id?: string | null;
  episode_number?: number | null;
  scene_number?: number | null;
  adaptation_decision: "kept" | "compressed" | "moved" | "omitted" | "expanded";
  rationale?: string | null;
  mandatory_beat_id?: string | null;
  beat_id?: string | null;
  scene_id?: string | null;
  shot_id?: string | null;
  stage?: "allocated_to_episode" | "scripted" | "assembled";
  created_at?: string;
}

export interface AnalysisReviewItemRecord {
  id: string;
  type: string; // 'character', 'beat', 'thread'
  series_id: string;
  source_id?: string | null;
  data_json: string;
  confidence_score: number;
  reasons_json?: string;
  status: "pending" | "approved" | "rejected" | "modified";
  reviewed_at?: string | null;
  review_notes?: string | null;
  created_at?: string;
}

export interface ChekhovGunRecord {
  id: string;
  series_id: string;
  name: string;
  type: "prop" | "secret" | "promise" | "threat" | "mystery" | string;
  description: string;
  planted_at_episode: number;
  planted_in_beat_id?: string | null;
  payoff_status: "planted" | "active" | "resolved" | "abandoned";
  payoff_episode?: number | null;
  payoff_beat_id?: string | null;
  dormant_episodes_count?: number;
  last_active_episode?: number | null;
  created_at?: string;
}

export interface NarrativeDelta {
  characterStatusUpdates?: Array<{
    id: string;
    status: CharacterRecord["status"] | string;
    notes?: string;
    distinguishingMarks?: string;
  }>;
  character_status_updates?: Array<{
    id: string;
    status: CharacterRecord["status"] | string;
    notes?: string;
    distinguishing_marks?: string;
  }>;
  wardrobeUpdates?: Array<{
    characterId: string;
    wardrobeId: string;
  }>;
  character_wardrobe_updates?: Array<{
    character_id: string;
    wardrobe_id: string;
  }>;
  propUpdates?: Array<{
    propId: string;
    newHolderId: string;
    status?: KeyPropRecord["status"] | string;
  }>;
  prop_transfers?: Array<{
    propId?: string;
    prop_id?: string;
    newHolderId?: string;
    new_holder_id?: string;
    from_holder_id?: string;
    to_holder_id?: string;
    status?: KeyPropRecord["status"] | string;
    reason?: string;
  }>;
  prop_holder_updates?: Array<{
    prop_id: string;
    new_holder_id: string;
    status?: KeyPropRecord["status"] | string;
  }>;
  newKnowledge?: Array<{ characterId: string; factKey: string; notes?: string }>;
  new_knowledge?: Array<{ character_id: string; fact_key: string; notes?: string }>;
  worldStateUpdates?: Record<string, unknown>;
  world_state_updates?: Record<string, unknown>;
  majorEvents?: string[];
  major_events?: string[];
}
export type BibleMemoryStore = {
    series: SeriesMetadataRecord | null;
    characters: Map<string, CharacterRecord>;
    character_states: CharacterStateRecord[];
    wardrobes: Map<string, CharacterWardrobeRecord>;
    locations: Map<string, LocationRecord>;
    location_states: LocationStateRecord[];
    props: Map<string, KeyPropRecord>;
    prop_states: PropStateRecord[];
    knowledge: CharacterKnowledgeRecord[];
    world_state: Map<string, { value: unknown; episode: number; seriesId?: string }>;
    episodes: Map<number, EpisodeSummaryRecord>;
    api_logs: ApiUsageRecord[];
    shot_takes: Map<string, ShotTakeRecord>;
    state_events: StateEventRecord[];
    canon_snapshots: Map<string, CanonSnapshotRecord>;
    episode_lifecycle: Map<string, EpisodeLifecycleRecord>;
    applied_commits: Map<string, AppliedCommitRecord>;
    migrations: CanonMigrationRecord[];
    reference_assets: Map<string, ReferenceAssetRecord>;
    storyboard_keyframes: Map<string, StoryboardKeyframeRecord>;
    provider_jobs: Map<string, ProviderJobRecord>;
    series_budgets: Map<string, SeriesBudgetRecord>;
    provider_rate_cards: Map<string, ProviderRateCardRecord>;
    llm_token_usage: LlmTokenUsageRecord[];
    // V6 Novel Ingestion & Series Planning
    source_works: Map<string, SourceWorkRecord>;
    source_revisions: Map<string, SourceRevisionRecord>;
    source_units: Map<string, SourceUnitRecord>;
    source_blocks: Map<string, SourceBlockRecord>;
    story_beats: Map<string, StoryBeatRecord>;
    story_threads: Map<string, StoryThreadRecord>;
    knowledge_states: KnowledgeStateRecord[];
    series_plans: Map<string, SeriesPlanRecord>;
    planned_episodes: Map<string, PlannedEpisodeRecord>;
    coverage_ledgers: Map<string, CoverageLedgerRecord>;
    analysis_review_queue: Map<string, AnalysisReviewItemRecord>;
    // V7 Chekhov's Gun / Foreshadowing Tracker
    chekhov_guns: Map<string, ChekhovGunRecord>;
  };
