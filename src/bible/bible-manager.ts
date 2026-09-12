import { existsSync, readFileSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import {
  ContinuityAuditor,
  type ContinuityAuditResult,
  type StoryBiblePayload,
  type LlmInvoker,
} from "./continuity-auditor.js";

const nodeRequire = createRequire(import.meta.url);

// ── Versioned Canon State Errors ──────────────────────────────────────────

export class FatalSqliteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FatalSqliteError";
  }
}

export class DeltaValidationError extends Error {
  public readonly errors: string[];
  constructor(message: string, errors: string[] = []) {
    super(message);
    this.name = "DeltaValidationError";
    this.errors = errors;
  }
}

export class UnauthorizedCanonCommitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnauthorizedCanonCommitError";
  }
}

export class InvalidLifecycleTransitionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidLifecycleTransitionError";
  }
}

// ── Configuration Options ─────────────────────────────────────────────────

export interface BibleManagerOptions {
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

// Fixed character archetype (permanent biological / core identity traits)
export interface CharacterRecord {
  id: string;
  name: string;
  role: "protagonist" | "antagonist" | "supporting" | "ally" | "mentor" | string;
  series_id?: string;
  archetype?: string;
  visual_summary?: string;
  personality_traits?: string[];
  voice_profile_id?: string;
  voice_embedding_path?: string;
  status: "alive" | "injured" | "deceased" | "missing";
  face_reference_image?: string;
  character_sheet_path?: string;
  current_wardrobe_id?: string;
  distinguishing_marks?: string;
  created_at?: string;
}

// Mutable episodic / scene character state
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

// Fixed location archetype
export interface LocationRecord {
  id: string;
  name: string;
  visual_summary?: string;
  atmospheric_rules?: string;
  reference_image_path?: string;
  lighting_mood?: string;
}

// Mutable episodic / scene location state
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

// Fixed key prop archetype
export interface KeyPropRecord {
  id: string;
  name: string;
  series_id?: string;
  visual_summary?: string;
  current_holder_id?: string;
  reference_image_path?: string;
  status: "intact" | "damaged" | "lost" | "destroyed";
  created_at?: string;
}

// Mutable episodic / scene prop state
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

export interface BudgetLedgerSummary {
  seriesId: string;
  maxBudgetUsd: number;
  confirmedCostUsd: number;
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

/**
 * Story Bible Manager for Episodic AI Series.
 * Implements Versioned Canon State Manager with transactional commits and strict SQLite persistence.
 */
export class BibleManager {
  private static openInstances: Set<BibleManager> = new Set();
  private db: any = null;
  private dbPath: string;
  private options: BibleManagerOptions;
  public isFallback = false;
  private memoryStore: {
    series: SeriesMetadataRecord | null;
    characters: Map<string, CharacterRecord>;
    character_states: CharacterStateRecord[];
    wardrobes: Map<string, CharacterWardrobeRecord>;
    locations: Map<string, LocationRecord>;
    location_states: LocationStateRecord[];
    props: Map<string, KeyPropRecord>;
    prop_states: PropStateRecord[];
    knowledge: CharacterKnowledgeRecord[];
    world_state: Map<string, { value: unknown; episode: number }>;
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
  };

  constructor(dbPath: string = "story_bible.db", options: BibleManagerOptions = {}) {
    this.dbPath = dbPath;
    this.options = options;
    this.memoryStore = {
      series: null,
      characters: new Map(),
      character_states: [],
      wardrobes: new Map(),
      locations: new Map(),
      location_states: [],
      props: new Map(),
      prop_states: [],
      knowledge: [],
      world_state: new Map(),
      episodes: new Map(),
      api_logs: [],
      shot_takes: new Map(),
      state_events: [],
      canon_snapshots: new Map(),
      episode_lifecycle: new Map(),
      applied_commits: new Map(),
      migrations: [],
      reference_assets: new Map(),
      storyboard_keyframes: new Map(),
      provider_jobs: new Map(),
      series_budgets: new Map(),
      provider_rate_cards: new Map(),
    };
    this.initDb();
  }

  private initDb() {
    const isProduction = process.env.NODE_ENV === "production";
    const enforceStrict = this.options.strictSqlite ?? isProduction;

    const dir = dirname(this.dbPath);
    if (dir && dir !== "." && !existsSync(dir)) {
      try {
        mkdirSync(dir, { recursive: true });
      } catch (err: any) {
        if (enforceStrict) {
          throw new FatalSqliteError(
            `Fatal: Cannot create SQLite database directory at '${dir}': ${err.message}`
          );
        }
      }
    }

    try {
      let DatabaseSync: any;
      const builtin = (process as any).getBuiltinModule?.("node:sqlite");
      if (builtin?.DatabaseSync) {
        DatabaseSync = builtin.DatabaseSync;
      } else {
        const sqlite = nodeRequire("node:sqlite");
        DatabaseSync = sqlite?.DatabaseSync;
      }

      if (DatabaseSync) {
        this.db = new DatabaseSync(this.dbPath);
        BibleManager.openInstances.add(this);
        try {
          this.db.exec("PRAGMA journal_mode = WAL;");
          this.db.exec("PRAGMA busy_timeout = 5000;");
        } catch {
          // Ignore pragma failures on memory or special DBs
        }
        this.applySchemaSql();
        this.runMigrations();
        return;
      }
      if (enforceStrict) {
        throw new FatalSqliteError(
          `Fatal: node:sqlite DatabaseSync is unavailable in environment. Ephemeral memory fallback is prohibited in production.`
        );
      }
      this.isFallback = true;
    } catch (err: any) {
      if (enforceStrict) {
        throw new FatalSqliteError(
          `Fatal: Failed to initialize SQLite database at '${this.dbPath}': ${err.message}`
        );
      }
      this.isFallback = true;
    }
  }

  public close(): void {
    if (this.db && typeof this.db.close === "function") {
      try {
        this.db.close();
      } catch {
        // Safe ignore
      }
      this.db = null;
    }
    BibleManager.openInstances.delete(this);
  }

  public static closeForPath(dbPath: string): void {
    const target = resolve(dbPath);
    for (const inst of Array.from(BibleManager.openInstances)) {
      if (inst.dbPath !== ":memory:" && resolve(inst.dbPath) === target) {
        try {
          inst.close();
        } catch {}
      }
    }
  }

  public static closeAll(): void {
    for (const inst of Array.from(BibleManager.openInstances)) {
      try {
        inst.close();
      } catch {}
    }
    BibleManager.openInstances.clear();
  }

  public getDbPath(): string {
    return this.dbPath;
  }

  public getAppliedMigrations(): CanonMigrationRecord[] {
    if (this.db && !this.isFallback) {
      return this.db.prepare("SELECT * FROM canon_migrations ORDER BY version ASC").all() as CanonMigrationRecord[];
    }
    return [...this.memoryStore.migrations].sort((a, b) => a.version - b.version);
  }

  public isMigrationApplied(version: number): boolean {
    if (this.db && !this.isFallback) {
      const row = this.db.prepare("SELECT version FROM canon_migrations WHERE version = ?").get(version);
      return Boolean(row);
    }
    return this.memoryStore.migrations.some((m) => m.version === version);
  }

  private runMigrations(): void {
    if (this.isFallback) {
      const now = new Date().toISOString();
      if (!this.memoryStore.migrations.some((m) => m.version === 1)) {
        this.memoryStore.migrations.push({ version: 1, name: "initial_schema", applied_at: now });
      }
      if (!this.memoryStore.migrations.some((m) => m.version === 2)) {
        this.memoryStore.migrations.push({
          version: 2,
          name: "versioned_canon_state_manager",
          applied_at: now,
        });
      }
      if (!this.memoryStore.migrations.some((m) => m.version === 3)) {
        this.memoryStore.migrations.push({
          version: 3,
          name: "versioned_reference_assets_and_storyboards",
          applied_at: now,
        });
      }
      if (!this.memoryStore.migrations.some((m) => m.version === 4)) {
        this.memoryStore.migrations.push({
          version: 4,
          name: "resilient_job_orchestration_and_ledger",
          applied_at: now,
        });
      }
      return;
    }
    if (!this.db) return;

    try {
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS canon_migrations (
          version INTEGER PRIMARY KEY,
          name TEXT NOT NULL,
          applied_at TEXT NOT NULL
        );
      `);

      const appliedRows = this.db.prepare("SELECT version FROM canon_migrations").all() as { version: number }[];
      const appliedVersions = new Set(appliedRows.map((r) => r.version));

      if (!appliedVersions.has(1)) {
        this.db.prepare("INSERT INTO canon_migrations (version, name, applied_at) VALUES (?, ?, ?)").run(
          1,
          "initial_schema",
          new Date().toISOString()
        );
      }

      if (!appliedVersions.has(2)) {
        this.db.prepare("INSERT INTO canon_migrations (version, name, applied_at) VALUES (?, ?, ?)").run(
          2,
          "versioned_canon_state_manager",
          new Date().toISOString()
        );
      }

      if (!appliedVersions.has(3)) {
        this.db.prepare("INSERT INTO canon_migrations (version, name, applied_at) VALUES (?, ?, ?)").run(
          3,
          "versioned_reference_assets_and_storyboards",
          new Date().toISOString()
        );
      }

      if (!appliedVersions.has(4)) {
        this.db.prepare("INSERT INTO canon_migrations (version, name, applied_at) VALUES (?, ?, ?)").run(
          4,
          "resilient_job_orchestration_and_ledger",
          new Date().toISOString()
        );
      }
    } catch {
      // Safe migration ignore
    }
  }

  private applySchemaSql() {
    const schemaSql = `
      CREATE TABLE IF NOT EXISTS series_metadata (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        genre TEXT,
        visual_style TEXT NOT NULL,
        negative_prompt TEXT,
        aspect_ratio TEXT NOT NULL DEFAULT '9:16',
        fps INTEGER NOT NULL DEFAULT 30,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS characters (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        role TEXT NOT NULL,
        visual_summary TEXT NOT NULL,
        personality_traits TEXT NOT NULL,
        voice_profile_id TEXT,
        voice_embedding_path TEXT,
        status TEXT NOT NULL DEFAULT 'alive',
        face_reference_image TEXT,
        character_sheet_path TEXT,
        current_wardrobe_id TEXT,
        distinguishing_marks TEXT
      );
      CREATE TABLE IF NOT EXISTS character_wardrobes (
        id TEXT PRIMARY KEY,
        character_id TEXT NOT NULL,
        outfit_name TEXT NOT NULL,
        visual_description TEXT NOT NULL,
        reference_image_path TEXT,
        is_default INTEGER NOT NULL DEFAULT 0,
        FOREIGN KEY (character_id) REFERENCES characters (id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS locations (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        visual_summary TEXT NOT NULL,
        atmospheric_rules TEXT,
        reference_image_path TEXT,
        lighting_mood TEXT
      );
      CREATE TABLE IF NOT EXISTS key_props (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        visual_summary TEXT NOT NULL,
        current_holder_id TEXT,
        reference_image_path TEXT,
        status TEXT NOT NULL DEFAULT 'intact'
      );
      CREATE TABLE IF NOT EXISTS character_knowledge (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        character_id TEXT NOT NULL,
        fact_key TEXT NOT NULL,
        revealed_in_episode INTEGER NOT NULL,
        notes TEXT
      );
      CREATE TABLE IF NOT EXISTS world_state (
        key TEXT PRIMARY KEY,
        value_json TEXT NOT NULL,
        updated_at_episode INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS episode_summaries (
        episode_number INTEGER PRIMARY KEY,
        title TEXT NOT NULL,
        logline TEXT NOT NULL,
        major_events_json TEXT NOT NULL,
        delta_changes_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS api_usage_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        episode_number INTEGER,
        shot_id TEXT,
        provider TEXT NOT NULL,
        type TEXT NOT NULL,
        units REAL NOT NULL,
        cost_usd REAL NOT NULL,
        timestamp TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS shot_takes (
        id TEXT PRIMARY KEY,
        series_id TEXT NOT NULL,
        episode_number INTEGER NOT NULL,
        shot_id TEXT NOT NULL,
        take_number INTEGER NOT NULL DEFAULT 1,
        provider TEXT NOT NULL,
        prompt TEXT NOT NULL,
        seed INTEGER,
        local_path TEXT NOT NULL,
        duration_sec REAL NOT NULL,
        qa_status TEXT NOT NULL DEFAULT 'PASS',
        qa_score REAL,
        qa_notes TEXT,
        is_approved INTEGER NOT NULL DEFAULT 0,
        cost_usd REAL NOT NULL DEFAULT 0.0,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_shot_takes_lookup ON shot_takes (series_id, episode_number, shot_id);
      CREATE UNIQUE INDEX IF NOT EXISTS uq_shot_takes_identity ON shot_takes (series_id, episode_number, shot_id, take_number);

      -- V2: Versioned Canon State Manager Tables
      CREATE TABLE IF NOT EXISTS canon_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS character_states (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        character_id TEXT NOT NULL,
        episode_number INTEGER NOT NULL,
        scene_id TEXT,
        status TEXT NOT NULL DEFAULT 'alive',
        current_wardrobe_id TEXT,
        distinguishing_marks TEXT,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (character_id) REFERENCES characters (id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_character_states_lookup ON character_states (character_id, episode_number);

      CREATE TABLE IF NOT EXISTS prop_states (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        prop_id TEXT NOT NULL,
        episode_number INTEGER NOT NULL,
        scene_id TEXT,
        current_holder_id TEXT,
        status TEXT NOT NULL DEFAULT 'intact',
        updated_at TEXT NOT NULL,
        FOREIGN KEY (prop_id) REFERENCES key_props (id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_prop_states_lookup ON prop_states (prop_id, episode_number);

      CREATE TABLE IF NOT EXISTS location_states (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        location_id TEXT NOT NULL,
        episode_number INTEGER NOT NULL,
        scene_id TEXT,
        atmospheric_rules TEXT,
        lighting_mood TEXT,
        status TEXT NOT NULL DEFAULT 'accessible',
        updated_at TEXT NOT NULL,
        FOREIGN KEY (location_id) REFERENCES locations (id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_location_states_lookup ON location_states (location_id, episode_number);

      CREATE TABLE IF NOT EXISTS state_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        series_id TEXT NOT NULL,
        episode_number INTEGER NOT NULL,
        scene_id TEXT,
        entity_type TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        event_type TEXT NOT NULL,
        from_state_json TEXT,
        to_state_json TEXT NOT NULL,
        story_time TEXT,
        confirmation_source TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_state_events_lookup ON state_events (series_id, episode_number, entity_type, entity_id);

      CREATE TABLE IF NOT EXISTS canon_snapshots (
        id TEXT PRIMARY KEY,
        series_id TEXT NOT NULL,
        episode_number INTEGER NOT NULL,
        snapshot_version INTEGER NOT NULL DEFAULT 1,
        state_hash TEXT NOT NULL,
        snapshot_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_canon_snapshots_lookup ON canon_snapshots (series_id, episode_number);

      CREATE TABLE IF NOT EXISTS episode_lifecycle (
        episode_number INTEGER PRIMARY KEY,
        series_id TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'draft',
        snapshot_id TEXT,
        needs_review INTEGER NOT NULL DEFAULT 0,
        review_notes TEXT,
        storyboard_approved_at TEXT,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (snapshot_id) REFERENCES canon_snapshots (id)
      );
      CREATE INDEX IF NOT EXISTS idx_lifecycle_status ON episode_lifecycle (series_id, status);

      CREATE TABLE IF NOT EXISTS applied_commits (
        commit_id TEXT PRIMARY KEY,
        episode_number INTEGER NOT NULL,
        summary_title TEXT NOT NULL,
        applied_at TEXT NOT NULL
      );

      -- V3: Versioned Reference Assets & Storyboard Keyframes
      CREATE TABLE IF NOT EXISTS reference_assets (
        id TEXT PRIMARY KEY,
        series_id TEXT NOT NULL,
        entity_type TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        asset_kind TEXT NOT NULL,
        image_path TEXT NOT NULL,
        version INTEGER NOT NULL DEFAULT 1,
        is_active INTEGER NOT NULL DEFAULT 1,
        description TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_reference_assets_lookup ON reference_assets (series_id, entity_type, entity_id, is_active);

      CREATE TABLE IF NOT EXISTS storyboard_keyframes (
        id TEXT PRIMARY KEY,
        series_id TEXT NOT NULL,
        episode_number INTEGER NOT NULL,
        shot_id TEXT NOT NULL,
        version INTEGER NOT NULL DEFAULT 1,
        composition_layout TEXT NOT NULL,
        camera_framing TEXT NOT NULL,
        image_path TEXT NOT NULL,
        is_approved INTEGER NOT NULL DEFAULT 0,
        used_references_json TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_storyboard_lookup ON storyboard_keyframes (series_id, episode_number, shot_id);

      -- V4: Resilient Provider Jobs & Ledger
      CREATE TABLE IF NOT EXISTS provider_jobs (
        id TEXT PRIMARY KEY,
        series_id TEXT NOT NULL,
        episode_number INTEGER NOT NULL,
        shot_id TEXT NOT NULL,
        provider TEXT NOT NULL,
        model_name TEXT,
        provider_job_id TEXT,
        idempotency_key TEXT,
        spec_hash TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'queued',
        attempt_count INTEGER NOT NULL DEFAULT 1,
        max_attempts INTEGER NOT NULL DEFAULT 3,
        cost_category TEXT NOT NULL DEFAULT 'estimated',
        estimated_cost_usd REAL NOT NULL DEFAULT 0.0,
        reserved_cost_usd REAL NOT NULL DEFAULT 0.0,
        confirmed_cost_usd REAL NOT NULL DEFAULT 0.0,
        uncertain_cost_usd REAL NOT NULL DEFAULT 0.0,
        output_url TEXT,
        output_local_path TEXT,
        error_code TEXT,
        error_message TEXT,
        is_retryable INTEGER NOT NULL DEFAULT 1,
        worker_id TEXT,
        lock_expires_at TEXT,
        metadata_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        completed_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_provider_jobs_lookup ON provider_jobs (series_id, episode_number, shot_id, status);
      CREATE INDEX IF NOT EXISTS idx_provider_jobs_spec ON provider_jobs (spec_hash, status);
      CREATE INDEX IF NOT EXISTS idx_provider_remote_id ON provider_jobs (provider, provider_job_id);

      CREATE TABLE IF NOT EXISTS series_budgets (
        series_id TEXT PRIMARY KEY,
        max_budget_usd REAL NOT NULL DEFAULT 25.0,
        warning_threshold_ratio REAL NOT NULL DEFAULT 0.85,
        is_hard_capped INTEGER NOT NULL DEFAULT 1,
        notes TEXT,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS provider_rate_cards (
        id TEXT PRIMARY KEY,
        provider TEXT NOT NULL,
        model_name TEXT NOT NULL,
        rate_per_sec_usd REAL NOT NULL,
        rate_per_unit_usd REAL,
        unit_type TEXT NOT NULL DEFAULT 'second',
        currency TEXT NOT NULL DEFAULT 'USD',
        effective_date TEXT NOT NULL,
        source_doc_url TEXT,
        notes TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_rate_cards_lookup ON provider_rate_cards (provider, model_name, effective_date);
    `;
    this.db.exec(schemaSql);

    // Run safe column migrations on characters table if it was created previously
    const columnsToEnsure = [
      { name: "face_reference_image", type: "TEXT" },
      { name: "character_sheet_path", type: "TEXT" },
      { name: "current_wardrobe_id", type: "TEXT" },
      { name: "distinguishing_marks", type: "TEXT" },
    ];
    for (const col of columnsToEnsure) {
      try {
        this.db.exec(`ALTER TABLE characters ADD COLUMN ${col.name} ${col.type};`);
      } catch {
        // Column already exists or table freshly created
      }
    }

    const shotTakeColumns = [
      { name: "qa_report_json", type: "TEXT" },
      { name: "storyboard_keyframe_id", type: "TEXT" },
      { name: "used_references_json", type: "TEXT" },
    ];
    for (const col of shotTakeColumns) {
      try {
        this.db.exec(`ALTER TABLE shot_takes ADD COLUMN ${col.name} ${col.type};`);
      } catch {
        // Column already exists
      }
    }

    try {
      this.db.exec("ALTER TABLE episode_lifecycle ADD COLUMN storyboard_approved_at TEXT;");
    } catch {
      // Column already exists
    }
  }

  // ── Series Metadata Operations ────────────────────────────────────────────

  public upsertSeriesMetadata(meta: SeriesMetadataRecord): void {
    if (this.db && !this.isFallback) {
      const stmt = this.db.prepare(`
        INSERT INTO series_metadata (id, title, genre, visual_style, negative_prompt, aspect_ratio, fps, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          title = excluded.title,
          genre = excluded.genre,
          visual_style = excluded.visual_style,
          negative_prompt = excluded.negative_prompt,
          aspect_ratio = excluded.aspect_ratio,
          fps = excluded.fps
      `);
      stmt.run(
        meta.id,
        meta.title,
        meta.genre ?? null,
        meta.visual_style ?? (meta as any).visualStyle ?? "Cinematic 35mm",
        meta.negative_prompt ?? (meta as any).negativePrompt ?? null,
        meta.aspect_ratio ?? (meta as any).aspectRatio ?? "9:16",
        meta.fps ?? 30,
        meta.created_at ?? (meta as any).createdAt ?? new Date().toISOString()
      );
    } else {
      this.memoryStore.series = meta;
    }
  }

  public getSeriesMetadata(id?: string): SeriesMetadataRecord | null {
    if (this.db && !this.isFallback) {
      let query = "SELECT * FROM series_metadata";
      const params: any[] = [];
      if (id) {
        query += " WHERE id = ?";
        params.push(id);
      } else {
        query += " LIMIT 1";
      }
      const row = this.db.prepare(query).get(...params);
      return row ? (row as SeriesMetadataRecord) : null;
    }
    return this.memoryStore.series;
  }

  // ── Character Operations ──────────────────────────────────────────────────

  public upsertCharacter(char: CharacterRecord): void {
    if (this.db && !this.isFallback) {
      const stmt = this.db.prepare(`
        INSERT INTO characters (
          id, name, role, visual_summary, personality_traits,
          voice_profile_id, voice_embedding_path, status,
          face_reference_image, character_sheet_path, current_wardrobe_id, distinguishing_marks
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          name = excluded.name,
          role = excluded.role,
          visual_summary = excluded.visual_summary,
          personality_traits = excluded.personality_traits,
          voice_profile_id = excluded.voice_profile_id,
          voice_embedding_path = excluded.voice_embedding_path,
          status = excluded.status,
          face_reference_image = excluded.face_reference_image,
          character_sheet_path = excluded.character_sheet_path,
          current_wardrobe_id = excluded.current_wardrobe_id,
          distinguishing_marks = excluded.distinguishing_marks
      `);
      stmt.run(
        char.id,
        char.name,
        char.role ?? "supporting",
        char.visual_summary || (char as any).visualSummary || (char as any).archetype || char.name,
        JSON.stringify(char.personality_traits ?? []),
        char.voice_profile_id ?? null,
        char.voice_embedding_path ?? null,
        char.status ?? "alive",
        char.face_reference_image ?? null,
        char.character_sheet_path ?? null,
        char.current_wardrobe_id ?? null,
        char.distinguishing_marks ?? null
      );
    } else {
      this.memoryStore.characters.set(char.id, char);
    }
  }

  public getCharacter(id: string): CharacterRecord | null {
    if (this.db && !this.isFallback) {
      const stmt = this.db.prepare("SELECT * FROM characters WHERE id = ?");
      const row = stmt.get(id);
      if (!row) return null;
      return {
        ...row,
        personality_traits: JSON.parse(row.personality_traits),
      } as CharacterRecord;
    }
    return this.memoryStore.characters.get(id) ?? null;
  }

  public listCharacters(): CharacterRecord[] {
    if (this.db && !this.isFallback) {
      const stmt = this.db.prepare("SELECT * FROM characters ORDER BY role ASC, name ASC");
      const rows = stmt.all();
      return rows.map((r: any) => ({
        ...r,
        personality_traits: JSON.parse(r.personality_traits),
      }));
    }
    return Array.from(this.memoryStore.characters.values());
  }

  public updateCharacterStatus(
    id: string,
    status: CharacterRecord["status"],
    distinguishingMarks?: string
  ): void {
    if (this.db && !this.isFallback) {
      if (distinguishingMarks !== undefined) {
        const stmt = this.db.prepare("UPDATE characters SET status = ?, distinguishing_marks = ? WHERE id = ?");
        stmt.run(status, distinguishingMarks, id);
      } else {
        const stmt = this.db.prepare("UPDATE characters SET status = ? WHERE id = ?");
        stmt.run(status, id);
      }
    } else {
      const char = this.memoryStore.characters.get(id);
      if (char) {
        char.status = status;
        if (distinguishingMarks !== undefined) {
          char.distinguishing_marks = distinguishingMarks;
        }
      }
    }
  }

  // ── Wardrobe Operations ───────────────────────────────────────────────────

  public upsertWardrobe(wardrobe: CharacterWardrobeRecord): void {
    if (this.db && !this.isFallback) {
      const stmt = this.db.prepare(`
        INSERT INTO character_wardrobes (id, character_id, outfit_name, visual_description, reference_image_path, is_default)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          outfit_name = excluded.outfit_name,
          visual_description = excluded.visual_description,
          reference_image_path = excluded.reference_image_path,
          is_default = excluded.is_default
      `);
      stmt.run(
        wardrobe.id,
        wardrobe.character_id,
        wardrobe.outfit_name,
        wardrobe.visual_description,
        wardrobe.reference_image_path ?? null,
        wardrobe.is_default ? 1 : 0
      );
    } else {
      this.memoryStore.wardrobes.set(wardrobe.id, wardrobe);
    }
  }

  public getWardrobe(id: string): CharacterWardrobeRecord | null {
    if (this.db && !this.isFallback) {
      const row = this.db.prepare("SELECT * FROM character_wardrobes WHERE id = ?").get(id);
      if (!row) return null;
      return {
        ...row,
        is_default: Boolean(row.is_default),
      };
    }
    return this.memoryStore.wardrobes.get(id) ?? null;
  }

  public listWardrobesForCharacter(characterId: string): CharacterWardrobeRecord[] {
    if (this.db && !this.isFallback) {
      const rows = this.db.prepare("SELECT * FROM character_wardrobes WHERE character_id = ?").all(characterId);
      return rows.map((r: any) => ({
        ...r,
        is_default: Boolean(r.is_default),
      }));
    }
    return Array.from(this.memoryStore.wardrobes.values()).filter((w) => w.character_id === characterId);
  }

  public getCharacterWardrobe(characterId: string): CharacterWardrobeRecord | null {
    const list = this.listWardrobesForCharacter(characterId);
    return list.find((w) => w.is_default) || list[0] || null;
  }

  public setCharacterActiveWardrobe(characterId: string, wardrobeId: string): void {
    if (this.db && !this.isFallback) {
      this.db.prepare("UPDATE characters SET current_wardrobe_id = ? WHERE id = ?").run(wardrobeId, characterId);
    } else {
      const char = this.memoryStore.characters.get(characterId);
      if (char) char.current_wardrobe_id = wardrobeId;
    }
  }

  // ── Location Operations ───────────────────────────────────────────────────

  public upsertLocation(loc: LocationRecord): void {
    if (this.db && !this.isFallback) {
      const stmt = this.db.prepare(`
        INSERT INTO locations (id, name, visual_summary, atmospheric_rules, reference_image_path, lighting_mood)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          name = excluded.name,
          visual_summary = excluded.visual_summary,
          atmospheric_rules = excluded.atmospheric_rules,
          reference_image_path = excluded.reference_image_path,
          lighting_mood = excluded.lighting_mood
      `);
      stmt.run(
        loc.id,
        loc.name,
        loc.visual_summary || (loc as any).visualSummary || loc.name,
        loc.atmospheric_rules ?? null,
        loc.reference_image_path ?? null,
        loc.lighting_mood ?? null
      );
    } else {
      this.memoryStore.locations.set(loc.id, loc);
    }
  }

  public getLocation(id: string): LocationRecord | null {
    if (this.db && !this.isFallback) {
      const row = this.db.prepare("SELECT * FROM locations WHERE id = ?").get(id);
      return row ? (row as LocationRecord) : null;
    }
    return this.memoryStore.locations.get(id) ?? null;
  }

  public listLocations(): LocationRecord[] {
    if (this.db && !this.isFallback) {
      return this.db.prepare("SELECT * FROM locations ORDER BY name ASC").all() as LocationRecord[];
    }
    return Array.from(this.memoryStore.locations.values());
  }

  // ── Key Prop Operations ───────────────────────────────────────────────────

  public upsertKeyProp(prop: KeyPropRecord): void {
    if (this.db && !this.isFallback) {
      const stmt = this.db.prepare(`
        INSERT INTO key_props (id, name, visual_summary, current_holder_id, reference_image_path, status)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          name = excluded.name,
          visual_summary = excluded.visual_summary,
          current_holder_id = excluded.current_holder_id,
          reference_image_path = excluded.reference_image_path,
          status = excluded.status
      `);
      stmt.run(
        prop.id,
        prop.name,
        prop.visual_summary || (prop as any).visualSummary || prop.name,
        prop.current_holder_id ?? null,
        prop.reference_image_path ?? null,
        prop.status ?? "intact"
      );
    } else {
      this.memoryStore.props.set(prop.id, prop);
    }
  }

  public upsertProp(prop: KeyPropRecord): void {
    this.upsertKeyProp(prop);
  }

  public getProp(id: string): KeyPropRecord | null {
    return this.getKeyProp(id);
  }

  public getPropTransfers(propId: string): Array<{
    prop_id: string;
    from_holder_id?: string | null;
    to_holder_id?: string | null;
    episode_number: number;
    created_at: string;
  }> {
    if (this.db && !this.isFallback) {
      const rows = this.db
        .prepare(
          `SELECT * FROM state_events WHERE entity_type = 'prop' AND entity_id = ? AND event_type = 'prop_transfer' ORDER BY id ASC`
        )
        .all(propId) as any[];
      return rows.map((r) => {
        let fromHolder = null;
        let toHolder = null;
        try {
          if (r.from_state_json) fromHolder = JSON.parse(r.from_state_json).current_holder_id;
          if (r.to_state_json) toHolder = JSON.parse(r.to_state_json).current_holder_id;
        } catch {}
        return {
          prop_id: propId,
          from_holder_id: fromHolder,
          to_holder_id: toHolder,
          episode_number: r.episode_number,
          created_at: r.created_at,
        };
      });
    }
    const events = this.memoryStore.state_events.filter(
      (e) => e.entity_type === "prop" && e.entity_id === propId && e.event_type === "prop_transfer"
    );
    return events.map((e) => {
      let fromHolder = null;
      let toHolder = null;
      try {
        if (e.from_state_json) fromHolder = JSON.parse(e.from_state_json).current_holder_id;
        if (e.to_state_json) toHolder = JSON.parse(e.to_state_json).current_holder_id;
      } catch {}
      return {
        prop_id: propId,
        from_holder_id: fromHolder,
        to_holder_id: toHolder,
        episode_number: e.episode_number,
        created_at: e.created_at || new Date().toISOString(),
      };
    });
  }

  public getKeyProp(id: string): KeyPropRecord | null {
    if (this.db && !this.isFallback) {
      const row = this.db.prepare("SELECT * FROM key_props WHERE id = ?").get(id);
      return row ? (row as KeyPropRecord) : null;
    }
    return this.memoryStore.props.get(id) ?? null;
  }

  public listKeyProps(): KeyPropRecord[] {
    if (this.db && !this.isFallback) {
      return this.db.prepare("SELECT * FROM key_props ORDER BY name ASC").all() as KeyPropRecord[];
    }
    return Array.from(this.memoryStore.props.values());
  }

  public transferKeyProp(propId: string, newHolderId?: string, status?: KeyPropRecord["status"]): void {
    if (this.db && !this.isFallback) {
      if (status && newHolderId !== undefined) {
        this.db.prepare("UPDATE key_props SET current_holder_id = ?, status = ? WHERE id = ?").run(newHolderId ?? null, status, propId);
      } else if (status && newHolderId === undefined) {
        this.db.prepare("UPDATE key_props SET status = ? WHERE id = ?").run(status, propId);
      } else {
        this.db.prepare("UPDATE key_props SET current_holder_id = ? WHERE id = ?").run(newHolderId ?? null, propId);
      }
    } else {
      const p = this.memoryStore.props.get(propId);
      if (p) {
        if (newHolderId !== undefined) p.current_holder_id = newHolderId;
        if (status) p.status = status;
      }
    }
  }

  // ── Character Knowledge Operations ────────────────────────────────────────

  public addKnowledge(characterId: string, factKey: string, revealedInEpisode: number, notes?: string): void {
    if (this.db && !this.isFallback) {
      const stmt = this.db.prepare(`
        INSERT INTO character_knowledge (character_id, fact_key, revealed_in_episode, notes)
        VALUES (?, ?, ?, ?)
      `);
      stmt.run(characterId, factKey, revealedInEpisode, notes ?? null);
    } else {
      this.memoryStore.knowledge.push({
        character_id: characterId,
        fact_key: factKey,
        revealed_in_episode: revealedInEpisode,
        notes,
      });
    }
  }

  public getCharacterKnowledge(characterId: string, upToEpisode?: number): CharacterKnowledgeRecord[] {
    if (this.db && !this.isFallback) {
      let query = "SELECT * FROM character_knowledge WHERE character_id = ?";
      const params: any[] = [characterId];
      if (upToEpisode !== undefined) {
        query += " AND revealed_in_episode <= ?";
        params.push(upToEpisode);
      }
      query += " ORDER BY revealed_in_episode ASC";
      return this.db.prepare(query).all(...params) as CharacterKnowledgeRecord[];
    }
    return this.memoryStore.knowledge.filter(
      (k) => k.character_id === characterId && (upToEpisode === undefined || k.revealed_in_episode <= upToEpisode)
    );
  }

  // ── World State Operations ────────────────────────────────────────────────

  public setWorldState(key: string, value: unknown, episodeNumber: number): void {
    if (this.db && !this.isFallback) {
      const stmt = this.db.prepare(`
        INSERT INTO world_state (key, value_json, updated_at_episode)
        VALUES (?, ?, ?)
        ON CONFLICT(key) DO UPDATE SET
          value_json = excluded.value_json,
          updated_at_episode = excluded.updated_at_episode
      `);
      stmt.run(key, JSON.stringify(value), episodeNumber);
    } else {
      this.memoryStore.world_state.set(key, { value, episode: episodeNumber });
    }
  }

  public getWorldState(key: string): unknown | null {
    if (this.db && !this.isFallback) {
      const row = this.db.prepare("SELECT value_json FROM world_state WHERE key = ?").get(key);
      return row ? JSON.parse(row.value_json) : null;
    }
    return this.memoryStore.world_state.get(key)?.value ?? null;
  }

  public getAllWorldState(): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    if (this.db && !this.isFallback) {
      const rows = this.db.prepare("SELECT key, value_json FROM world_state").all();
      for (const r of rows) {
        result[r.key] = JSON.parse(r.value_json);
      }
      return result;
    }
    for (const [k, v] of this.memoryStore.world_state.entries()) {
      result[k] = v.value;
    }
    return result;
  }

  // ── Episode Summaries & Delta Ingestion ───────────────────────────────────

  public recordEpisodeSummary(record: EpisodeSummaryRecord): void {
    if (this.db && !this.isFallback) {
      const stmt = this.db.prepare(`
        INSERT INTO episode_summaries (episode_number, title, logline, major_events_json, delta_changes_json, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(episode_number) DO UPDATE SET
          title = excluded.title,
          logline = excluded.logline,
          major_events_json = excluded.major_events_json,
          delta_changes_json = excluded.delta_changes_json,
          created_at = excluded.created_at
      `);
      stmt.run(
        record.episode_number,
        record.title,
        record.logline ?? null,
        JSON.stringify(record.major_events ?? []),
        JSON.stringify(record.delta_changes ?? {}),
        record.created_at ?? new Date().toISOString()
      );
    } else {
      this.memoryStore.episodes.set(record.episode_number, record);
    }
  }

  public getEpisodeSummary(episodeNumber: number): EpisodeSummaryRecord | null {
    if (this.db && !this.isFallback) {
      const row = this.db.prepare("SELECT * FROM episode_summaries WHERE episode_number = ?").get(episodeNumber);
      if (!row) return null;
      return {
        episode_number: row.episode_number,
        title: row.title,
        logline: row.logline,
        major_events: JSON.parse(row.major_events_json),
        delta_changes: JSON.parse(row.delta_changes_json),
        created_at: row.created_at,
      };
    }
    return this.memoryStore.episodes.get(episodeNumber) ?? null;
  }

  public listEpisodeSummaries(): EpisodeSummaryRecord[] {
    if (this.db && !this.isFallback) {
      const rows = this.db.prepare("SELECT * FROM episode_summaries ORDER BY episode_number ASC").all();
      return rows.map((r: any) => ({
        episode_number: r.episode_number,
        title: r.title,
        logline: r.logline,
        major_events: JSON.parse(r.major_events_json),
        delta_changes: JSON.parse(r.delta_changes_json),
        created_at: r.created_at,
      }));
    }
    return Array.from(this.memoryStore.episodes.values()).sort((a, b) => a.episode_number - b.episode_number);
  }

  public getCanonHistory(): EpisodeSummaryRecord[] {
    return this.listEpisodeSummaries();
  }

  /**
   * Applies approved delta changes to the Story Bible after episode completion.
   * Tracks character/prop state transitions and emits state_events.
   */
  public applyNarrativeDelta(
    episodeNumber: number,
    delta: NarrativeDelta,
    options?: {
      seriesId?: string;
      confirmationSource?: StateEventRecord["confirmation_source"];
      storyTime?: string;
      sceneId?: string | null;
    }
  ): void {
    const seriesId = options?.seriesId || this.getSeriesMetadata()?.id || "default-series";
    const confirmationSource = options?.confirmationSource ?? "pipeline_commit";
    const storyTime = options?.storyTime ?? `Episode ${episodeNumber}`;
    const sceneId = options?.sceneId ?? null;
    const now = new Date().toISOString();

    const d = delta as any;
    // 1. Update character statuses & distinguishing marks
    const charUpdates = d.characterStatusUpdates || d.character_status_updates;
    if (charUpdates && Array.isArray(charUpdates)) {
      for (const update of charUpdates) {
        const id = update.id || update.characterId || update.character_id;
        const status = update.status;
        const marks = update.distinguishingMarks ?? update.distinguishing_marks;

        const prevChar = this.getCharacter(id);
        const fromState = prevChar
          ? JSON.stringify({ status: prevChar.status, distinguishing_marks: prevChar.distinguishing_marks })
          : null;
        const toState = JSON.stringify({ status, distinguishing_marks: marks ?? prevChar?.distinguishing_marks });

        this.updateCharacterStatus(id, status, marks);

        this.setCharacterState({
          character_id: id,
          episode_number: episodeNumber,
          scene_id: sceneId,
          status,
          distinguishing_marks: marks,
          updated_at: now,
        });

        this.recordStateEvent({
          series_id: seriesId,
          episode_number: episodeNumber,
          scene_id: sceneId,
          entity_type: "character",
          entity_id: id,
          event_type: "status_change",
          from_state_json: fromState,
          to_state_json: toState,
          story_time: storyTime,
          confirmation_source: confirmationSource,
          created_at: now,
        });
      }
    }

    // 2. Update character wardrobes
    const wardrobeUpdates = d.wardrobeUpdates || d.character_wardrobe_updates;
    if (wardrobeUpdates && Array.isArray(wardrobeUpdates)) {
      for (const w of wardrobeUpdates) {
        const charId = w.characterId || w.character_id;
        const wardrobeId = w.wardrobeId || w.wardrobe_id;

        const prevChar = this.getCharacter(charId);
        const fromState = prevChar ? JSON.stringify({ current_wardrobe_id: prevChar.current_wardrobe_id }) : null;
        const toState = JSON.stringify({ current_wardrobe_id: wardrobeId });

        this.setCharacterActiveWardrobe(charId, wardrobeId);

        this.recordStateEvent({
          series_id: seriesId,
          episode_number: episodeNumber,
          scene_id: sceneId,
          entity_type: "character",
          entity_id: charId,
          event_type: "wardrobe_change",
          from_state_json: fromState,
          to_state_json: toState,
          story_time: storyTime,
          confirmation_source: confirmationSource,
          created_at: now,
        });
      }
    }

    // 3. Update key prop holders / status
    const propUpdates = d.propUpdates || d.prop_transfers || d.prop_holder_updates;
    if (propUpdates && Array.isArray(propUpdates)) {
      for (const p of propUpdates) {
        const propId = p.propId || p.prop_id;
        const newHolderId = p.newHolderId || p.new_holder_id || p.to_holder_id || p.toHolderId;
        const newStatus = p.status as KeyPropRecord["status"] | undefined;

        const prevProp = this.getKeyProp(propId);
        const fromState = prevProp
          ? JSON.stringify({ current_holder_id: prevProp.current_holder_id, status: prevProp.status })
          : null;
        const toState = JSON.stringify({
          current_holder_id: newHolderId ?? prevProp?.current_holder_id,
          status: newStatus ?? prevProp?.status ?? "intact",
        });

        this.transferKeyProp(propId, newHolderId, newStatus);

        this.setPropState({
          prop_id: propId,
          episode_number: episodeNumber,
          scene_id: sceneId,
          current_holder_id: newHolderId,
          status: newStatus ?? prevProp?.status ?? "intact",
          updated_at: now,
        });

        this.recordStateEvent({
          series_id: seriesId,
          episode_number: episodeNumber,
          scene_id: sceneId,
          entity_type: "prop",
          entity_id: propId,
          event_type: "prop_transfer",
          from_state_json: fromState,
          to_state_json: toState,
          story_time: storyTime,
          confirmation_source: confirmationSource,
          created_at: now,
        });
      }
    }

    // 4. Add new character knowledge
    const knowledgeUpdates = d.newKnowledge || d.new_knowledge;
    if (knowledgeUpdates && Array.isArray(knowledgeUpdates)) {
      for (const k of knowledgeUpdates) {
        const charId = k.characterId || k.character_id;
        const factKey = k.factKey || k.fact_key;
        this.addKnowledge(charId, factKey, episodeNumber, k.notes);

        this.recordStateEvent({
          series_id: seriesId,
          episode_number: episodeNumber,
          scene_id: sceneId,
          entity_type: "character",
          entity_id: charId,
          event_type: "knowledge_revealed",
          from_state_json: null,
          to_state_json: JSON.stringify({ fact_key: factKey, notes: k.notes }),
          story_time: storyTime,
          confirmation_source: confirmationSource,
          created_at: now,
        });
      }
    }

    // 5. Update world state
    const worldUpdates = d.worldStateUpdates || d.world_state_updates;
    if (worldUpdates) {
      for (const [key, val] of Object.entries(worldUpdates)) {
        const prevVal = this.getWorldState(key);
        this.setWorldState(key, val, episodeNumber);

        this.recordStateEvent({
          series_id: seriesId,
          episode_number: episodeNumber,
          scene_id: sceneId,
          entity_type: "world",
          entity_id: key,
          event_type: "world_state",
          from_state_json: prevVal !== null ? JSON.stringify({ value: prevVal }) : null,
          to_state_json: JSON.stringify({ value: val }),
          story_time: storyTime,
          confirmation_source: confirmationSource,
          created_at: now,
        });
      }
    }
  }

  // ── Context Prompt Generation & Negative Constraints ─────────────────────

  /**
   * Generates a concise context injection prompt for LLM script generators
   * to ensure narrative and visual coherence before writing or normalizing a new episode.
   */
  public generateContextPrompt(episodeNumber: number, activeCharacterIds: string[] = []): string {
    const series = this.getSeriesMetadata();
    const allChars = this.listCharacters();
    const relevantChars = activeCharacterIds.length > 0
      ? allChars.filter((c) => activeCharacterIds.includes(c.id))
      : allChars;

    const charLines = relevantChars.map((c) => {
      const knowledge = this.getCharacterKnowledge(c.id, episodeNumber - 1).map((k) => k.fact_key).join(", ");
      const activeWardrobe = c.current_wardrobe_id ? this.getWardrobe(c.current_wardrobe_id) : null;
      const wardrobeDesc = activeWardrobe ? `Trang phục hiện tại: [${activeWardrobe.outfit_name}] ${activeWardrobe.visual_description}` : "Trang phục mặc định";
      const marksDesc = c.distinguishing_marks ? ` | Dấu hiệu nhận dạng: ${c.distinguishing_marks}` : "";
      return `- [${c.name} (${c.role}, status: ${c.status})]: ${c.visual_summary}${marksDesc} | ${wardrobeDesc} | Tính cách: ${(c.personality_traits || []).join(", ")} | Đã biết: ${knowledge || "chưa có bí mật đáng chú ý"}`;
    });

    const locations = this.listLocations().map(
      (l) => `- [${l.name} (${l.id})]: ${l.visual_summary}${l.atmospheric_rules ? ` (Khí quyển: ${l.atmospheric_rules})` : ""}`
    );

    const keyProps = this.listKeyProps().map((p) => {
      const holder = p.current_holder_id ? (this.getCharacter(p.current_holder_id)?.name ?? p.current_holder_id) : "chưa rõ";
      return `- [${p.name} (${p.id})]: ${p.visual_summary} (Hiện do ${holder} nắm giữ, trạng thái: ${p.status})`;
    });

    const worldState = this.getAllWorldState();
    const worldLines = Object.entries(worldState).map(
      ([k, v]) => `- ${k}: ${typeof v === "object" ? JSON.stringify(v) : v}`
    );

    const negativeConstraints = this.getNegativeConstraints(episodeNumber);

    return `
### STORY BIBLE CONTEXT (Tập ${episodeNumber})
${series ? `PHONG CÁCH THỊ GIÁC TOÀN SERIES:\n- Phong cách: ${series.visual_style}\n- Tỉ lệ khung hình: ${series.aspect_ratio}\n` : ""}
CÁC NHÂN VẬT THAM GIA:
${charLines.join("\n") || "(Chưa có nhân vật nào trong bible)"}

BỐI CẢNH & ĐỊA ĐIỂM ĐÃ XÁC LẬP:
${locations.join("\n") || "(Chưa có địa điểm định sẵn)"}

ĐẠO CỤ ĐẶC BIỆT & VẬT PHẨM CANON:
${keyProps.join("\n") || "(Không có đạo cụ đặc biệt)"}

TRẠNG THÁI THẾ GIỚI HIỆN TẠI:
${worldLines.join("\n") || "(Thế giới ở trạng thái mặc định)"}

RÀNG BUỘC CỐT TRUYỆN PHỦ ĐỊNH (NGHIÊM CẤM VI PHẠM):
${negativeConstraints.map((c) => `❌ ${c}`).join("\n")}
`.trim();
  }

  /**
   * Returns a list of strict negative constraints that MUST NOT be violated.
   */
  public getNegativeConstraints(episodeNumber: number): string[] {
    const constraints: string[] = [];
    const allChars = this.listCharacters();

    // 1. Deceased or missing characters
    for (const c of allChars) {
      if (c.status === "deceased") {
        constraints.push(`Nhân vật ${c.name} (${c.id}) đã chết, NGHIÊM CẤM xuất hiện ở dòng thời gian hiện tại (chỉ được xuất hiện trong hồi tưởng/flashback nếu có ghi chú rõ).`);
      } else if (c.status === "missing") {
        constraints.push(`Nhân vật ${c.name} (${c.id}) đang mất tích, không thể xuất hiện trong các cuộc họp chung.`);
      }
    }

    // 2. Secret knowledge checks (only if secret facts are tracked in this story)
    let declaredSecretKeys: string[] = [];
    if (this.db && !this.isFallback) {
      try {
        const rows = this.db.prepare("SELECT DISTINCT fact_key FROM character_knowledge").all() as { fact_key: string }[];
        declaredSecretKeys = rows.map((r) => r.fact_key).filter((k) => k === "knows_killer_identity" || k.startsWith("secret:"));
      } catch {
        declaredSecretKeys = [];
      }
    } else {
      declaredSecretKeys = Array.from(
        new Set(
          this.memoryStore.knowledge
            .map((k) => k.fact_key)
            .filter((k) => k === "knows_killer_identity" || k.startsWith("secret:"))
        )
      );
    }

    if (declaredSecretKeys.length > 0) {
      for (const c of allChars) {
        const known = this.getCharacterKnowledge(c.id, episodeNumber - 1).map((k) => k.fact_key);
        for (const secretKey of declaredSecretKeys) {
          if (!known.includes(secretKey)) {
            const desc = secretKey === "knows_killer_identity"
              ? "danh tính kẻ sát nhân"
              : secretKey.replace(/^secret:/, "");
            constraints.push(`${c.name} CHƯA BIẾT ${desc} ở thời điểm này. Không được để nhân vật hành động như thể đã biết.`);
          }
        }
      }
    }

    // 3. Destroyed or lost key props
    const props = this.listKeyProps();
    for (const p of props) {
      if (p.status === "destroyed") {
        constraints.push(`Đạo cụ ${p.name} (${p.id}) đã bị phá hủy hoàn toàn, không thể sử dụng lại.`);
      } else if (p.status === "lost") {
        constraints.push(`Đạo cụ ${p.name} (${p.id}) đang thất lạc, nhân vật không thể tùy ý rút ra dùng.`);
      }
    }

    return constraints;
  }

  // ── Cost Tracking & Budget Guard ─────────────────────────────────────────

  public logApiUsage(record: ApiUsageRecord): void {
    if (this.db && !this.isFallback) {
      const stmt = this.db.prepare(`
        INSERT INTO api_usage_logs (episode_number, shot_id, provider, type, units, cost_usd, timestamp)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);
      stmt.run(
        record.episode_number ?? null,
        record.shot_id ?? null,
        record.provider,
        record.type,
        record.units,
        record.cost_usd,
        record.timestamp
      );
    } else {
      this.memoryStore.api_logs.push(record);
    }
  }

  public getEpisodeCost(episodeNumber: number): number {
    if (this.db && !this.isFallback) {
      const row = this.db.prepare(
        "SELECT SUM(cost_usd) as total_cost FROM api_usage_logs WHERE episode_number = ?"
      ).get(episodeNumber);
      return row?.total_cost ?? 0;
    }
    return this.memoryStore.api_logs
      .filter((l) => l.episode_number === episodeNumber)
      .reduce((sum, l) => sum + l.cost_usd, 0);
  }

  // ── Continuity Auditor Integration ──────────────────────────────────────

  /**
   * Exports the consolidated Story Bible state prior to the target episode.
   */
  public exportBiblePayload(episodeNumber: number): StoryBiblePayload {
    const characters = this.listCharacters();
    const knowledge: CharacterKnowledgeRecord[] = [];
    for (const c of characters) {
      knowledge.push(...this.getCharacterKnowledge(c.id, episodeNumber - 1));
    }
    const world_state = this.getAllWorldState();
    const episode_summaries: EpisodeSummaryRecord[] = [];

    if (this.db && !this.isFallback) {
      const rows = this.db
        .prepare("SELECT * FROM episode_summaries WHERE episode_number < ? ORDER BY episode_number ASC")
        .all(episodeNumber);
      for (const r of rows) {
        episode_summaries.push({
          episode_number: r.episode_number,
          title: r.title,
          logline: r.logline,
          major_events: JSON.parse(r.major_events_json),
          delta_changes: JSON.parse(r.delta_changes_json),
          created_at: r.created_at,
        });
      }
    } else {
      for (const [ep, record] of this.memoryStore.episodes.entries()) {
        if (ep < episodeNumber) {
          episode_summaries.push(record);
        }
      }
      episode_summaries.sort((a, b) => a.episode_number - b.episode_number);
    }

    return {
      characters,
      character_knowledge: knowledge,
      world_state,
      episode_summaries,
    };
  }

  /**
   * Evaluates a draft script against the Story Bible using the ContinuityAuditor.
   */
  public async auditDraftScript(
    episodeNumber: number,
    draftScript: string,
    invoker?: LlmInvoker | { llmInvoker?: LlmInvoker; promptTemplate?: string }
  ): Promise<ContinuityAuditResult> {
    const auditor = new ContinuityAuditor(
      typeof invoker === "function" ? { llmInvoker: invoker } : invoker
    );
    const biblePayload = this.exportBiblePayload(episodeNumber);
    return auditor.auditScript(episodeNumber, biblePayload, draftScript);
  }

  // ── Narrative Delta Validation & Commit Idempotency ──────────────────────

  public validateNarrativeDelta(delta: NarrativeDelta): { valid: boolean; errors: string[] } {
    const errors: string[] = [];
    const d = delta as any;

    // 1. Validate character status updates
    const charUpdates = d.characterStatusUpdates || d.character_status_updates;
    if (charUpdates && Array.isArray(charUpdates)) {
      for (const update of charUpdates) {
        const id = update.id || update.characterId || update.character_id;
        if (!id) {
          errors.push("Character status update missing character id.");
          continue;
        }
        const char = this.getCharacter(id);
        if (!char) {
          errors.push(`Character status update refers to non-existent character '${id}'.`);
        }
      }
    }

    // 2. Validate wardrobe updates
    const wardrobeUpdates = d.wardrobeUpdates || d.character_wardrobe_updates;
    if (wardrobeUpdates && Array.isArray(wardrobeUpdates)) {
      for (const w of wardrobeUpdates) {
        const charId = w.characterId || w.character_id;
        const wardrobeId = w.wardrobeId || w.wardrobe_id;
        const char = this.getCharacter(charId);
        if (!char) {
          errors.push(`Wardrobe update refers to non-existent character '${charId}'.`);
        }
        const wardrobe = this.getWardrobe(wardrobeId);
        if (!wardrobe) {
          errors.push(`Wardrobe update refers to non-existent wardrobe '${wardrobeId}'.`);
        } else if (wardrobe.character_id !== charId) {
          errors.push(`Wardrobe '${wardrobeId}' does not belong to character '${charId}'.`);
        }
      }
    }

    // 3. Validate prop updates / transfers
    const propUpdates = d.propUpdates || d.prop_transfers || d.prop_holder_updates;
    if (propUpdates && Array.isArray(propUpdates)) {
      for (const p of propUpdates) {
        const propId = p.propId || p.prop_id;
        const newHolderId = p.newHolderId || p.new_holder_id || p.to_holder_id || p.toHolderId;
        if (!propId) {
          errors.push("Prop update missing prop id.");
          continue;
        }
        const prop = this.getKeyProp(propId);
        if (!prop) {
          errors.push(`Prop transfer refers to non-existent prop '${propId}'.`);
        }
        if (newHolderId) {
          const charHolder = this.getCharacter(newHolderId);
          const locHolder = this.getLocation(newHolderId);
          if (!charHolder && !locHolder) {
            errors.push(`New prop holder '${newHolderId}' does not exist as character or location.`);
          } else if (charHolder && charHolder.status === "deceased") {
            errors.push(`Cannot transfer prop '${propId}' to deceased character '${charHolder.name}' (${newHolderId}).`);
          }
        }
      }
    }

    // 4. Validate knowledge additions
    const knowledgeUpdates = d.newKnowledge || d.new_knowledge;
    if (knowledgeUpdates && Array.isArray(knowledgeUpdates)) {
      for (const k of knowledgeUpdates) {
        const charId = k.characterId || k.character_id;
        const char = this.getCharacter(charId);
        if (!char) {
          errors.push(`Knowledge update refers to non-existent character '${charId}'.`);
        } else if (char.status === "deceased") {
          errors.push(`Cannot add new knowledge to deceased character '${char.name}' (${charId}).`);
        }
      }
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  public isCommitApplied(commitId: string): boolean {
    if (this.db && !this.isFallback) {
      const row = this.db.prepare("SELECT commit_id FROM applied_commits WHERE commit_id = ?").get(commitId);
      return Boolean(row);
    }
    return this.memoryStore.applied_commits.has(commitId);
  }

  /**
   * Commits an approved episode to the Story Bible with transactional atomicity:
   * 1. Validates delta references against existing canon entities.
   * 2. Checks commit idempotency (never applied twice).
   * 3. Enforces episode lifecycle (dry-runs, unapproved drafts cannot mutate canon).
   * 4. Atomically records summary, applies delta, logs state_events, marks lifecycle committed,
   *    and invalidates downstream episodes in a single SQLite transaction.
   */
  public commitEpisode(
    summaryOrOptions:
      | EpisodeSummaryRecord
      | {
          episodeNumber?: number;
          episode_number?: number;
          title?: string;
          logline?: string;
          majorEvents?: string[];
          major_events?: string[];
          delta?: NarrativeDelta;
          delta_changes?: Record<string, unknown>;
          commitId?: string;
          seriesId?: string;
          force?: boolean;
          created_at?: string;
        },
    deltaArg?: NarrativeDelta,
    optionsArg?: {
      commitId?: string;
      seriesId?: string;
      confirmationSource?: StateEventRecord["confirmation_source"];
      storyTime?: string;
      force?: boolean;
    }
  ): { applied: boolean; commitId: string; reason?: string; episode_number: number; title: string } {
    const raw: any = summaryOrOptions;
    const epNum = Number(raw.episode_number ?? raw.episodeNumber ?? 1);
    const title = String(raw.title || `Tập ${epNum}`);
    const logline = String(raw.logline || "");
    const majorEvents = raw.major_events || raw.majorEvents || [];

    const seriesId =
      optionsArg?.seriesId ||
      raw.seriesId ||
      raw.series_id ||
      this.getSeriesMetadata()?.id ||
      "default-series";

    const summary: EpisodeSummaryRecord = {
      series_id: seriesId,
      episode_number: epNum,
      title,
      logline,
      major_events: majorEvents,
      created_at: raw.created_at || new Date().toISOString(),
    };

    const delta: NarrativeDelta = deltaArg || raw.delta || raw.delta_changes || {};
    const options = {
      commitId: optionsArg?.commitId || raw.commitId,
      seriesId,
      confirmationSource: optionsArg?.confirmationSource,
      storyTime: optionsArg?.storyTime,
      force: optionsArg?.force ?? raw.force,
    };

    // 1. Delta reference validation
    const validation = this.validateNarrativeDelta(delta);
    if (!validation.valid) {
      throw new DeltaValidationError(
        `Narrative delta validation failed: ${validation.errors.join("; ")}`,
        validation.errors
      );
    }

    // 2. Commit idempotency check
    const commitId =
      options?.commitId ||
      createHash("sha256")
        .update(
          JSON.stringify({
            series_id: seriesId,
            episode_number: summary.episode_number,
            title: summary.title,
            logline: summary.logline,
            major_events: summary.major_events,
            delta,
          })
        )
        .digest("hex");

    if (this.isCommitApplied(commitId)) {
      return { applied: false, commitId, reason: "already_applied", episode_number: summary.episode_number, title: summary.title };
    }

    // 3. Lifecycle gate: draft/rendered/rejected/failed cannot mutate official canon
    const lifecycle = this.getEpisodeLifecycle(seriesId, summary.episode_number);
    if (!options?.force) {
      if (!lifecycle || lifecycle.status !== "approved") {
        throw new UnauthorizedCanonCommitError(
          `Cannot commit episode ${summary.episode_number} to canon because episode lifecycle status is not 'approved' (current: '${lifecycle?.status || "none"}').`
        );
      }
    }

    // 4. Atomic Transaction execution
    if (this.db && !this.isFallback) {
      this.db.exec("BEGIN IMMEDIATE TRANSACTION;");
      try {
        // Record applied commit for idempotency
        this.db
          .prepare(
            "INSERT INTO applied_commits (commit_id, episode_number, summary_title, applied_at) VALUES (?, ?, ?, ?)"
          )
          .run(commitId, summary.episode_number, summary.title, new Date().toISOString());

        // Record episode summary
        this.recordEpisodeSummary(summary);

        // Apply delta and record state events
        this.applyNarrativeDelta(summary.episode_number, delta, {
          seriesId,
          confirmationSource: options?.confirmationSource ?? "pipeline_commit",
          storyTime: options?.storyTime,
        });

        // Advance lifecycle to committed
        this.setEpisodeLifecycle({
          seriesId,
          episodeNumber: summary.episode_number,
          status: "committed",
          needsReview: false,
        });

        // Flag downstream episodes if modifying historical canon
        this.invalidateDownstreamEpisodes(
          seriesId,
          summary.episode_number,
          `Canon updated in earlier episode ${summary.episode_number}`
        );

        this.db.exec("COMMIT;");
        return { applied: true, commitId, episode_number: summary.episode_number, title: summary.title };
      } catch (err) {
        this.db.exec("ROLLBACK;");
        throw err;
      }
    } else {
      // Memory store transactional snapshot
      const backupChars = new Map(Array.from(this.memoryStore.characters.entries()).map(([k, v]) => [k, { ...v }]));
      const backupProps = new Map(Array.from(this.memoryStore.props.entries()).map(([k, v]) => [k, { ...v }]));
      const backupEpisodes = new Map(this.memoryStore.episodes);
      const backupEvents = [...this.memoryStore.state_events];
      const backupApplied = new Map(this.memoryStore.applied_commits);

      try {
        this.memoryStore.applied_commits.set(commitId, {
          commit_id: commitId,
          episode_number: summary.episode_number,
          summary_title: summary.title,
          applied_at: new Date().toISOString(),
        });
        this.recordEpisodeSummary(summary);
        this.applyNarrativeDelta(summary.episode_number, delta, {
          seriesId,
          confirmationSource: options?.confirmationSource ?? "pipeline_commit",
          storyTime: options?.storyTime,
        });
        this.setEpisodeLifecycle({
          seriesId,
          episodeNumber: summary.episode_number,
          status: "committed",
          needsReview: false,
        });
        this.invalidateDownstreamEpisodes(
          seriesId,
          summary.episode_number,
          `Canon updated in earlier episode ${summary.episode_number}`
        );
        return { applied: true, commitId, episode_number: summary.episode_number, title: summary.title };
      } catch (err) {
        this.memoryStore.characters = backupChars;
        this.memoryStore.props = backupProps;
        this.memoryStore.episodes = backupEpisodes;
        this.memoryStore.state_events = backupEvents;
        this.memoryStore.applied_commits = backupApplied;
        throw err;
      }
    }
  }

  // ── State Events Operations ──────────────────────────────────────────────

  public recordStateEvent(event: StateEventRecord): void {
    const now = event.created_at || new Date().toISOString();
    if (this.db && !this.isFallback) {
      this.db
        .prepare(`
          INSERT INTO state_events (
            series_id, episode_number, scene_id, entity_type, entity_id,
            event_type, from_state_json, to_state_json, story_time,
            confirmation_source, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `)
        .run(
          event.series_id,
          event.episode_number,
          event.scene_id ?? null,
          event.entity_type,
          event.entity_id,
          event.event_type,
          event.from_state_json ?? null,
          event.to_state_json,
          event.story_time ?? null,
          event.confirmation_source,
          now
        );
    } else {
      this.memoryStore.state_events.push({
        ...event,
        created_at: now,
      });
    }
  }

  public listStateEvents(options?: {
    seriesId?: string;
    episodeNumber?: number;
    entityType?: string;
    entityId?: string;
  }): StateEventRecord[] {
    if (this.db && !this.isFallback) {
      let query = "SELECT * FROM state_events WHERE 1=1";
      const params: any[] = [];
      if (options?.seriesId) {
        query += " AND series_id = ?";
        params.push(options.seriesId);
      }
      if (options?.episodeNumber !== undefined) {
        query += " AND episode_number = ?";
        params.push(options.episodeNumber);
      }
      if (options?.entityType) {
        query += " AND entity_type = ?";
        params.push(options.entityType);
      }
      if (options?.entityId) {
        query += " AND entity_id = ?";
        params.push(options.entityId);
      }
      query += " ORDER BY id ASC";
      return this.db.prepare(query).all(...params) as StateEventRecord[];
    }
    return this.memoryStore.state_events.filter((e) => {
      if (options?.seriesId && e.series_id !== options.seriesId) return false;
      if (options?.episodeNumber !== undefined && e.episode_number !== options.episodeNumber) return false;
      if (options?.entityType && e.entity_type !== options.entityType) return false;
      if (options?.entityId && e.entity_id !== options.entityId) return false;
      return true;
    });
  }

  // ── Character, Prop & Location State Operations (Archetype vs Episodic) ──

  public getCharacterArchetype(
    characterId: string
  ): Omit<CharacterRecord, "status" | "current_wardrobe_id" | "distinguishing_marks"> | null {
    const char = this.getCharacter(characterId);
    if (!char) return null;
    const { status, current_wardrobe_id, distinguishing_marks, ...archetype } = char;
    return archetype;
  }

  public getCharacterState(characterId: string, episodeNumber?: number): CharacterStateRecord | null {
    if (this.db && !this.isFallback) {
      let query = "SELECT * FROM character_states WHERE character_id = ?";
      const params: any[] = [characterId];
      if (episodeNumber !== undefined) {
        query += " AND episode_number <= ?";
        params.push(episodeNumber);
      }
      query += " ORDER BY episode_number DESC, id DESC LIMIT 1";
      const row = this.db.prepare(query).get(...params);
      return row ? (row as CharacterStateRecord) : null;
    }
    const matches = this.memoryStore.character_states
      .filter((s) => s.character_id === characterId && (episodeNumber === undefined || s.episode_number <= episodeNumber))
      .sort((a, b) => b.episode_number - a.episode_number);
    return matches[0] ?? null;
  }

  public setCharacterState(state: CharacterStateRecord): void {
    const now = state.updated_at || new Date().toISOString();
    if (this.db && !this.isFallback) {
      this.db
        .prepare(`
          INSERT INTO character_states (character_id, episode_number, scene_id, status, current_wardrobe_id, distinguishing_marks, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `)
        .run(
          state.character_id,
          state.episode_number,
          state.scene_id ?? null,
          state.status,
          state.current_wardrobe_id ?? null,
          state.distinguishing_marks ?? null,
          now
        );
    } else {
      this.memoryStore.character_states.push({ ...state, updated_at: now });
    }
  }

  public getPropArchetype(propId: string): Omit<KeyPropRecord, "current_holder_id" | "status"> | null {
    const prop = this.getKeyProp(propId);
    if (!prop) return null;
    const { current_holder_id, status, ...archetype } = prop;
    return archetype;
  }

  public getPropState(propId: string, episodeNumber?: number): PropStateRecord | null {
    if (this.db && !this.isFallback) {
      let query = "SELECT * FROM prop_states WHERE prop_id = ?";
      const params: any[] = [propId];
      if (episodeNumber !== undefined) {
        query += " AND episode_number <= ?";
        params.push(episodeNumber);
      }
      query += " ORDER BY episode_number DESC, id DESC LIMIT 1";
      const row = this.db.prepare(query).get(...params);
      return row ? (row as PropStateRecord) : null;
    }
    const matches = this.memoryStore.prop_states
      .filter((s) => s.prop_id === propId && (episodeNumber === undefined || s.episode_number <= episodeNumber))
      .sort((a, b) => b.episode_number - a.episode_number);
    return matches[0] ?? null;
  }

  public setPropState(state: PropStateRecord): void {
    const now = state.updated_at || new Date().toISOString();
    if (this.db && !this.isFallback) {
      this.db
        .prepare(`
          INSERT INTO prop_states (prop_id, episode_number, scene_id, current_holder_id, status, updated_at)
          VALUES (?, ?, ?, ?, ?, ?)
        `)
        .run(
          state.prop_id,
          state.episode_number,
          state.scene_id ?? null,
          state.current_holder_id ?? null,
          state.status,
          now
        );
    } else {
      this.memoryStore.prop_states.push({ ...state, updated_at: now });
    }
  }

  public getLocationArchetype(locationId: string): Omit<LocationRecord, "atmospheric_rules" | "lighting_mood"> | null {
    const loc = this.getLocation(locationId);
    if (!loc) return null;
    const { atmospheric_rules, lighting_mood, ...archetype } = loc;
    return archetype;
  }

  public getLocationState(locationId: string, episodeNumber?: number): LocationStateRecord | null {
    if (this.db && !this.isFallback) {
      let query = "SELECT * FROM location_states WHERE location_id = ?";
      const params: any[] = [locationId];
      if (episodeNumber !== undefined) {
        query += " AND episode_number <= ?";
        params.push(episodeNumber);
      }
      query += " ORDER BY episode_number DESC, id DESC LIMIT 1";
      const row = this.db.prepare(query).get(...params);
      return row ? (row as LocationStateRecord) : null;
    }
    const matches = this.memoryStore.location_states
      .filter((s) => s.location_id === locationId && (episodeNumber === undefined || s.episode_number <= episodeNumber))
      .sort((a, b) => b.episode_number - a.episode_number);
    return matches[0] ?? null;
  }

  public setLocationState(state: LocationStateRecord): void {
    const now = state.updated_at || new Date().toISOString();
    if (this.db && !this.isFallback) {
      this.db
        .prepare(`
          INSERT INTO location_states (location_id, episode_number, scene_id, atmospheric_rules, lighting_mood, status, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `)
        .run(
          state.location_id,
          state.episode_number,
          state.scene_id ?? null,
          state.atmospheric_rules ?? null,
          state.lighting_mood ?? null,
          state.status,
          now
        );
    } else {
      this.memoryStore.location_states.push({ ...state, updated_at: now });
    }
  }

  // ── Episode Lifecycle State Machine ──────────────────────────────────────

  public getEpisodeLifecycle(seriesId: string, episodeNumber: number): EpisodeLifecycleRecord | null {
    if (this.db && !this.isFallback) {
      let row = this.db
        .prepare("SELECT * FROM episode_lifecycle WHERE series_id = ? AND episode_number = ?")
        .get(seriesId, episodeNumber);
      if (!row) {
        row = this.db
          .prepare("SELECT * FROM episode_lifecycle WHERE episode_number = ?")
          .get(episodeNumber);
      }
      if (!row) return null;
      return {
        ...row,
        needs_review: Boolean(row.needs_review),
      } as EpisodeLifecycleRecord;
    }
    const key = `${seriesId}:${episodeNumber}`;
    const direct = this.memoryStore.episode_lifecycle.get(key);
    if (direct) return direct;
    for (const v of this.memoryStore.episode_lifecycle.values()) {
      if (v.episode_number === episodeNumber) return v;
    }
    return null;
  }

  public setEpisodeLifecycle(
    recordOrEpisodeNumber:
      | {
          seriesId: string;
          episodeNumber: number;
          status: EpisodeLifecycleStatus;
          snapshotId?: string | null;
          reviewNotes?: string | null;
          needsReview?: boolean;
          storyboardApprovedAt?: string | null;
          storyboard_approved_at?: string | null;
        }
      | number,
    statusPositional?: EpisodeLifecycleStatus,
    reviewNotesPositional?: string | null,
    seriesIdPositional?: string
  ): void {
    let record: {
      seriesId: string;
      episodeNumber: number;
      status: EpisodeLifecycleStatus;
      snapshotId?: string | null;
      reviewNotes?: string | null;
      needsReview?: boolean;
      storyboardApprovedAt?: string | null;
    };

    if (typeof recordOrEpisodeNumber === "number") {
      const sId = seriesIdPositional || this.getSeriesMetadata()?.id || "default-series";
      record = {
        seriesId: sId,
        episodeNumber: recordOrEpisodeNumber,
        status: statusPositional!,
        reviewNotes: reviewNotesPositional,
      };
    } else {
      record = {
        ...recordOrEpisodeNumber,
        storyboardApprovedAt:
          recordOrEpisodeNumber.storyboardApprovedAt ??
          recordOrEpisodeNumber.storyboard_approved_at,
      };
    }

    const current = this.getEpisodeLifecycle(record.seriesId, record.episodeNumber);
    const now = new Date().toISOString();

    if (current && current.status !== record.status) {
      const from = current.status;
      const to = record.status;

      const validTransitions: Record<EpisodeLifecycleStatus, EpisodeLifecycleStatus[]> = {
        draft: ["rendered", "rejected", "failed"],
        rendered: ["approved", "rejected", "failed", "draft"],
        approved: ["committed", "rejected", "rendered", "draft"],
        committed: ["rendered", "draft"],
        rejected: ["draft", "rendered"],
        failed: ["draft", "rendered"],
      };

      if (!validTransitions[from].includes(to)) {
        throw new InvalidLifecycleTransitionError(
          `Invalid episode lifecycle transition from '${from}' to '${to}' for episode ${record.episodeNumber}.`
        );
      }
    }

    const needsReviewVal =
      record.needsReview !== undefined
        ? record.needsReview
          ? 1
          : 0
        : current?.needs_review
        ? 1
        : 0;

    const snapshotIdVal =
      record.snapshotId !== undefined ? record.snapshotId : current?.snapshot_id ?? null;

    const reviewNotesVal =
      record.reviewNotes !== undefined ? record.reviewNotes : current?.review_notes ?? null;

    const storyboardApprovedAtVal =
      record.storyboardApprovedAt !== undefined
        ? record.storyboardApprovedAt
        : current?.storyboard_approved_at ?? null;

    if (this.db && !this.isFallback) {
      const stmt = this.db.prepare(`
        INSERT INTO episode_lifecycle (episode_number, series_id, status, snapshot_id, needs_review, review_notes, storyboard_approved_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(episode_number) DO UPDATE SET
          series_id = excluded.series_id,
          status = excluded.status,
          snapshot_id = excluded.snapshot_id,
          needs_review = excluded.needs_review,
          review_notes = excluded.review_notes,
          storyboard_approved_at = excluded.storyboard_approved_at,
          updated_at = excluded.updated_at
      `);
      stmt.run(
        record.episodeNumber,
        record.seriesId,
        record.status,
        snapshotIdVal,
        needsReviewVal,
        reviewNotesVal,
        storyboardApprovedAtVal,
        now
      );
    } else {
      const key = `${record.seriesId}:${record.episodeNumber}`;
      this.memoryStore.episode_lifecycle.set(key, {
        episode_number: record.episodeNumber,
        series_id: record.seriesId,
        status: record.status,
        snapshot_id: snapshotIdVal,
        needs_review: Boolean(needsReviewVal),
        review_notes: reviewNotesVal,
        storyboard_approved_at: storyboardApprovedAtVal,
        updated_at: now,
      });
    }
  }

  public invalidateDownstreamEpisodes(
    seriesId: string,
    fromEpisodeNumber: number,
    reason: string
  ): number {
    if (this.db && !this.isFallback) {
      const result = this.db
        .prepare(`
          UPDATE episode_lifecycle
          SET needs_review = 1, review_notes = COALESCE(review_notes || ' | ', '') || ?
          WHERE series_id = ? AND episode_number > ?
        `)
        .run(reason, seriesId, fromEpisodeNumber);
      return result.changes ?? 0;
    } else {
      let count = 0;
      for (const lc of this.memoryStore.episode_lifecycle.values()) {
        if (lc.series_id === seriesId && lc.episode_number > fromEpisodeNumber) {
          lc.needs_review = true;
          lc.review_notes = lc.review_notes ? `${lc.review_notes} | ${reason}` : reason;
          count++;
        }
      }
      return count;
    }
  }

  // ── Immutable Canon Snapshots ────────────────────────────────────────────

  public createCanonSnapshot(
    seriesId: string,
    episodeNumber: number,
    snapshotVersion: number = 1
  ): CanonSnapshotRecord {
    const characters = this.listCharacters();
    const wardrobes: CharacterWardrobeRecord[] = [];
    for (const c of characters) {
      wardrobes.push(...this.listWardrobesForCharacter(c.id));
    }
    const locations = this.listLocations();
    const props = this.listKeyProps();
    const knowledge: CharacterKnowledgeRecord[] = [];
    for (const c of characters) {
      knowledge.push(...this.getCharacterKnowledge(c.id, episodeNumber));
    }
    const world_state = this.getAllWorldState();
    const summaries = this.listEpisodeSummaries().filter((s) => s.episode_number <= episodeNumber);

    const snapshotData = {
      series_id: seriesId,
      episode_number: episodeNumber,
      snapshot_version: snapshotVersion,
      characters,
      wardrobes,
      locations,
      props,
      character_knowledge: knowledge,
      world_state,
      episode_summaries: summaries,
    };

    const snapshot_json = JSON.stringify(snapshotData);
    const state_hash = createHash("sha256").update(snapshot_json).digest("hex");
    const snapshotId = `snap_${seriesId}_ep${episodeNumber}_v${snapshotVersion}`;
    const now = new Date().toISOString();

    const record: CanonSnapshotRecord = {
      id: snapshotId,
      series_id: seriesId,
      episode_number: episodeNumber,
      snapshot_version: snapshotVersion,
      state_hash,
      snapshot_json,
      created_at: now,
    };

    if (this.db && !this.isFallback) {
      this.db
        .prepare(`
          INSERT INTO canon_snapshots (id, series_id, episode_number, snapshot_version, state_hash, snapshot_json, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            state_hash = excluded.state_hash,
            snapshot_json = excluded.snapshot_json,
            created_at = excluded.created_at
        `)
        .run(snapshotId, seriesId, episodeNumber, snapshotVersion, state_hash, snapshot_json, now);
    } else {
      this.memoryStore.canon_snapshots.set(snapshotId, record);
    }

    const currentLifecycle = this.getEpisodeLifecycle(seriesId, episodeNumber);
    if (currentLifecycle) {
      this.setEpisodeLifecycle({
        seriesId,
        episodeNumber,
        status: currentLifecycle.status,
        snapshotId,
      });
    }

    return record;
  }

  public getCanonSnapshot(snapshotId: string): CanonSnapshotRecord | null {
    if (this.db && !this.isFallback) {
      const row = this.db.prepare("SELECT * FROM canon_snapshots WHERE id = ?").get(snapshotId);
      return row ? (row as CanonSnapshotRecord) : null;
    }
    return this.memoryStore.canon_snapshots.get(snapshotId) ?? null;
  }

  public getSnapshotForEpisode(seriesId: string, episodeNumber: number): CanonSnapshotRecord | null {
    const lifecycle = this.getEpisodeLifecycle(seriesId, episodeNumber);
    if (lifecycle?.snapshot_id) {
      const snap = this.getCanonSnapshot(lifecycle.snapshot_id);
      if (snap) return snap;
    }
    if (this.db && !this.isFallback) {
      const row = this.db
        .prepare(
          "SELECT * FROM canon_snapshots WHERE series_id = ? AND episode_number = ? ORDER BY snapshot_version DESC LIMIT 1"
        )
        .get(seriesId, episodeNumber);
      return row ? (row as CanonSnapshotRecord) : null;
    }
    const matches = Array.from(this.memoryStore.canon_snapshots.values())
      .filter((s) => s.series_id === seriesId && s.episode_number === episodeNumber)
      .sort((a, b) => b.snapshot_version - a.snapshot_version);
    return matches[0] ?? null;
  }

  public listCanonSnapshots(seriesId: string, episodeNumber?: number): CanonSnapshotRecord[] {
    if (this.db && !this.isFallback) {
      let query = "SELECT * FROM canon_snapshots WHERE series_id = ?";
      const params: any[] = [seriesId];
      if (episodeNumber !== undefined) {
        query += " AND episode_number = ?";
        params.push(episodeNumber);
      }
      query += " ORDER BY episode_number ASC, snapshot_version ASC";
      return this.db.prepare(query).all(...params) as CanonSnapshotRecord[];
    }
    return Array.from(this.memoryStore.canon_snapshots.values()).filter(
      (s) => s.series_id === seriesId && (episodeNumber === undefined || s.episode_number === episodeNumber)
    );
  }

  // ── Shot Takes Operations ────────────────────────────────────────────────

  public recordShotTake(take: ShotTakeRecord): void {
    if (this.db && !this.isFallback) {
      const stmt = this.db.prepare(`
        INSERT INTO shot_takes (
          id, series_id, episode_number, shot_id, take_number, provider,
          prompt, seed, local_path, duration_sec, qa_status, qa_score,
          qa_notes, qa_report_json, storyboard_keyframe_id, used_references_json,
          is_approved, cost_usd, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          provider = excluded.provider,
          prompt = excluded.prompt,
          duration_sec = excluded.duration_sec,
          qa_status = excluded.qa_status,
          qa_score = excluded.qa_score,
          qa_notes = excluded.qa_notes,
          qa_report_json = excluded.qa_report_json,
          storyboard_keyframe_id = excluded.storyboard_keyframe_id,
          used_references_json = excluded.used_references_json,
          is_approved = excluded.is_approved,
          local_path = excluded.local_path,
          cost_usd = excluded.cost_usd
      `);
      stmt.run(
        take.id,
        take.series_id,
        take.episode_number,
        take.shot_id,
        take.take_number ?? 1,
        take.provider,
        take.prompt,
        take.seed ?? null,
        take.local_path,
        take.duration_sec,
        take.qa_status ?? "PASS",
        take.qa_score ?? null,
        take.qa_notes ?? null,
        take.qa_report_json ?? null,
        take.storyboard_keyframe_id ?? null,
        take.used_references_json ?? "[]",
        take.is_approved ? 1 : 0,
        take.cost_usd ?? 0.0,
        take.created_at || new Date().toISOString()
      );
    } else {
      this.memoryStore.shot_takes.set(take.id, {
        ...take,
        is_approved: Boolean(take.is_approved),
      });
    }
  }

  /**
   * Atomically reserves the next available take number, take ID, and reservation path
   * under concurrency across multiple workers or processes.
   * Acquires an immediate SQLite write lock with BEGIN IMMEDIATE TRANSACTION; to eliminate race conditions.
   * Enforces composite uniqueness on (series_id, episode_number, shot_id, take_number).
   */
  public atomicReserveShotTake(
    params: AtomicReserveShotTakeParams
  ): AtomicReserveShotTakeResult {
    const seriesPrefix = params.seriesId.replace(/[^a-zA-Z0-9_-]/g, "_");
    const epNumStr = String(params.episodeNumber).padStart(2, "0");
    const shotIds = this.getEquivalentShotIds(params.shotId);

    if (this.db && !this.isFallback) {
      let attempts = 0;
      const maxAttempts = 10;
      while (attempts < maxAttempts) {
        attempts++;
        try {
          this.db.exec("BEGIN IMMEDIATE TRANSACTION;");
        } catch (busyErr: any) {
          if (attempts >= maxAttempts) throw busyErr;
          continue;
        }

        let inTransaction = true;
        try {
          const placeholders = shotIds.map(() => "?").join(", ");
          const row = this.db
            .prepare(
              `SELECT COALESCE(MAX(take_number), 0) AS max_take FROM shot_takes WHERE series_id = ? AND episode_number = ? AND shot_id IN (${placeholders})`
            )
            .get(params.seriesId, params.episodeNumber, ...shotIds) as { max_take: number } | undefined;

          let takeNumber = Math.max(params.minTakeNumber ?? 1, (row?.max_take ?? 0) + 1);
          let takeNumStr = String(takeNumber).padStart(2, "0");
          let takeId = `${seriesPrefix}_ep${epNumStr}_${params.shotId}_take${takeNumStr}`;
          let localPath = params.localPathBuilder
            ? params.localPathBuilder(takeNumber, takeNumStr)
            : "";

          while (
            (localPath && existsSync(localPath)) ||
            this.db.prepare("SELECT id FROM shot_takes WHERE id = ?").get(takeId) ||
            this.db
              .prepare(
                `SELECT id FROM shot_takes WHERE series_id = ? AND episode_number = ? AND shot_id IN (${placeholders}) AND take_number = ?`
              )
              .get(params.seriesId, params.episodeNumber, ...shotIds, takeNumber)
          ) {
            takeNumber++;
            takeNumStr = String(takeNumber).padStart(2, "0");
            takeId = `${seriesPrefix}_ep${epNumStr}_${params.shotId}_take${takeNumStr}`;
            localPath = params.localPathBuilder
              ? params.localPathBuilder(takeNumber, takeNumStr)
              : "";
          }

          const stmt = this.db.prepare(`
            INSERT INTO shot_takes (
              id, series_id, episode_number, shot_id, take_number, provider,
              prompt, seed, local_path, duration_sec, qa_status, qa_score,
              qa_notes, qa_report_json, storyboard_keyframe_id, used_references_json,
              is_approved, cost_usd, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `);

          const record: ShotTakeRecord = {
            id: takeId,
            series_id: params.seriesId,
            episode_number: params.episodeNumber,
            shot_id: params.shotId,
            take_number: takeNumber,
            provider: params.provider,
            prompt: params.prompt,
            seed: params.seed,
            local_path: localPath,
            duration_sec: params.durationSec ?? 0,
            qa_status: params.qaStatus ?? "NOT_RUN",
            qa_score: undefined,
            qa_notes: undefined,
            qa_report_json: undefined,
            storyboard_keyframe_id: params.storyboardKeyframeId,
            used_references_json: params.usedReferencesJson ?? "[]",
            is_approved: params.isApproved ? 1 : 0,
            cost_usd: params.costUsd ?? 0,
            created_at: new Date().toISOString(),
          };

          stmt.run(
            record.id,
            record.series_id,
            record.episode_number,
            record.shot_id,
            record.take_number,
            record.provider,
            record.prompt,
            record.seed ?? null,
            record.local_path,
            record.duration_sec,
            record.qa_status,
            record.qa_score ?? null,
            record.qa_notes ?? null,
            record.qa_report_json ?? null,
            record.storyboard_keyframe_id ?? null,
            record.used_references_json ?? "[]",
            record.is_approved ? 1 : 0,
            record.cost_usd ?? 0,
            record.created_at
          );

          this.db.exec("COMMIT;");
          inTransaction = false;

          return {
            takeNumber,
            takeNumStr,
            takeId,
            localPath,
            record: {
              ...record,
              is_approved: Boolean(record.is_approved),
            },
          };
        } catch (err: any) {
          if (inTransaction) {
            try {
              this.db.exec("ROLLBACK;");
            } catch {}
          }
          if (
            err.message?.includes("UNIQUE") ||
            err.message?.includes("busy") ||
            err.code === "SQLITE_BUSY"
          ) {
            continue;
          }
          throw err;
        }
      }
      throw new Error(`Failed to atomically reserve shot take after ${maxAttempts} attempts due to concurrency contention.`);
    }

    // In-memory fallback
    const existingTakes = Array.from(this.memoryStore.shot_takes.values()).filter(
      (t) =>
        t.series_id === params.seriesId &&
        t.episode_number === params.episodeNumber &&
        shotIds.includes(t.shot_id)
    );
    const maxTake = existingTakes.reduce((acc, t) => Math.max(acc, t.take_number ?? 0), 0);
    let takeNumber = Math.max(params.minTakeNumber ?? 1, maxTake + 1);
    let takeNumStr = String(takeNumber).padStart(2, "0");
    let takeId = `${seriesPrefix}_ep${epNumStr}_${params.shotId}_take${takeNumStr}`;
    let localPath = params.localPathBuilder
      ? params.localPathBuilder(takeNumber, takeNumStr)
      : "";

    while (this.memoryStore.shot_takes.has(takeId) || (localPath && existsSync(localPath))) {
      takeNumber++;
      takeNumStr = String(takeNumber).padStart(2, "0");
      takeId = `${seriesPrefix}_ep${epNumStr}_${params.shotId}_take${takeNumStr}`;
      localPath = params.localPathBuilder
        ? params.localPathBuilder(takeNumber, takeNumStr)
        : "";
    }

    const record: ShotTakeRecord = {
      id: takeId,
      series_id: params.seriesId,
      episode_number: params.episodeNumber,
      shot_id: params.shotId,
      take_number: takeNumber,
      provider: params.provider,
      prompt: params.prompt,
      seed: params.seed,
      local_path: localPath,
      duration_sec: params.durationSec ?? 0,
      qa_status: params.qaStatus ?? "NOT_RUN",
      qa_score: undefined,
      qa_notes: undefined,
      qa_report_json: undefined,
      storyboard_keyframe_id: params.storyboardKeyframeId,
      used_references_json: params.usedReferencesJson ?? "[]",
      is_approved: Boolean(params.isApproved),
      cost_usd: params.costUsd ?? 0,
      created_at: new Date().toISOString(),
    };

    this.memoryStore.shot_takes.set(takeId, record);

    return {
      takeNumber,
      takeNumStr,
      takeId,
      localPath,
      record,
    };
  }

  public getShotTake(takeId: string): ShotTakeRecord | null {
    if (this.db && !this.isFallback) {
      const row = this.db.prepare("SELECT * FROM shot_takes WHERE id = ?").get(takeId);
      if (!row) return null;
      return {
        ...row,
        is_approved: Boolean(row.is_approved),
      } as ShotTakeRecord;
    }
    return this.memoryStore.shot_takes.get(takeId) ?? null;
  }

  private getEquivalentShotIds(shotId: string): string[] {
    const set = new Set<string>([shotId]);
    const m = shotId.match(/^sc(\d+)_sh(\d+)$/i);
    if (m) {
      const sc = parseInt(m[1], 10);
      const sh = parseInt(m[2], 10);
      const scPad = String(sc).padStart(2, "0");
      const shPad = String(sh).padStart(2, "0");
      set.add(`sc${sc}_sh${sh}`);
      set.add(`sc${scPad}_sh${shPad}`);
      set.add(`sc${scPad}_sh${sh}`);
      set.add(`sc${sc}_sh${shPad}`);
    }
    return Array.from(set);
  }

  public listShotTakes(seriesId: string, episodeNumber: number, shotId?: string): ShotTakeRecord[] {
    if (this.db && !this.isFallback) {
      let rows: any[];
      if (shotId) {
        const shotIds = this.getEquivalentShotIds(shotId);
        const placeholders = shotIds.map(() => "?").join(", ");
        const stmt = this.db.prepare(
          `SELECT * FROM shot_takes WHERE series_id = ? AND episode_number = ? AND shot_id IN (${placeholders}) ORDER BY take_number ASC`
        );
        rows = stmt.all(seriesId, episodeNumber, ...shotIds);
      } else {
        const stmt = this.db.prepare(
          "SELECT * FROM shot_takes WHERE series_id = ? AND episode_number = ? ORDER BY shot_id ASC, take_number ASC"
        );
        rows = stmt.all(seriesId, episodeNumber);
      }
      return rows.map((r: any) => ({
        ...r,
        is_approved: Boolean(r.is_approved),
      }));
    }
    const shotIds = shotId ? this.getEquivalentShotIds(shotId) : [];
    return Array.from(this.memoryStore.shot_takes.values()).filter(
      (t) =>
        t.series_id === seriesId &&
        t.episode_number === episodeNumber &&
        (!shotId || shotIds.includes(t.shot_id))
    );
  }

  public updateShotTakeQa(
    takeId: string,
    qa: {
      qa_status: "PASS" | "WARN" | "FAIL" | "NOT_RUN" | "UNAVAILABLE";
      qa_score?: number;
      qa_notes?: string;
      qa_report_json?: string;
    }
  ): void {
    if (this.db && !this.isFallback) {
      this.db
        .prepare(
          "UPDATE shot_takes SET qa_status = ?, qa_score = ?, qa_notes = ?, qa_report_json = COALESCE(?, qa_report_json) WHERE id = ?"
        )
        .run(qa.qa_status, qa.qa_score ?? null, qa.qa_notes ?? null, qa.qa_report_json ?? null, takeId);
    } else {
      const take = this.memoryStore.shot_takes.get(takeId);
      if (take) {
        take.qa_status = qa.qa_status;
        take.qa_score = qa.qa_score;
        take.qa_notes = qa.qa_notes;
        if (qa.qa_report_json !== undefined) {
          take.qa_report_json = qa.qa_report_json;
        }
      }
    }
  }

  public approveShotTake(takeId: string): void {
    const take = this.getShotTake(takeId);
    if (!take) return;

    const shotIds = this.getEquivalentShotIds(take.shot_id);
    if (this.db && !this.isFallback) {
      const placeholders = shotIds.map(() => "?").join(", ");
      this.db.prepare(
        `UPDATE shot_takes SET is_approved = 0 WHERE series_id = ? AND episode_number = ? AND shot_id IN (${placeholders})`
      ).run(take.series_id, take.episode_number, ...shotIds);

      this.db.prepare("UPDATE shot_takes SET is_approved = 1 WHERE id = ?").run(takeId);
    } else {
      for (const t of this.memoryStore.shot_takes.values()) {
        if (
          t.series_id === take.series_id &&
          t.episode_number === take.episode_number &&
          shotIds.includes(t.shot_id)
        ) {
          t.is_approved = false;
        }
      }
      const target = this.memoryStore.shot_takes.get(takeId);
      if (target) target.is_approved = true;
    }
  }

  public selectShotTake(takeId: string): void {
    this.approveShotTake(takeId);
  }

  public rejectShotTake(takeId: string, rejectionReason?: string): void {
    const take = this.getShotTake(takeId);
    if (!take) return;

    const updatedNotes = rejectionReason
      ? `${take.qa_notes || ""}\n[REJECTED] ${rejectionReason}`.trim()
      : take.qa_notes;

    if (this.db && !this.isFallback) {
      this.db.prepare(
        "UPDATE shot_takes SET is_approved = 0, qa_notes = ? WHERE id = ?"
      ).run(updatedNotes ?? null, takeId);
    } else {
      const target = this.memoryStore.shot_takes.get(takeId);
      if (target) {
        target.is_approved = false;
        target.qa_notes = updatedNotes;
      }
    }
  }

  public getApprovedTakeForShot(
    seriesId: string,
    episodeNumber: number,
    shotId: string
  ): ShotTakeRecord | null {
    const shotIds = this.getEquivalentShotIds(shotId);
    if (this.db && !this.isFallback) {
      const placeholders = shotIds.map(() => "?").join(", ");
      const row = this.db.prepare(
        `SELECT * FROM shot_takes WHERE series_id = ? AND episode_number = ? AND shot_id IN (${placeholders}) AND is_approved = 1 LIMIT 1`
      ).get(seriesId, episodeNumber, ...shotIds);
      if (!row) return null;
      return {
        ...row,
        is_approved: true,
      } as ShotTakeRecord;
    }
    const match = Array.from(this.memoryStore.shot_takes.values()).find(
      (t) =>
        t.series_id === seriesId &&
        t.episode_number === episodeNumber &&
        shotIds.includes(t.shot_id) &&
        Boolean(t.is_approved)
    );
    return match ?? null;
  }

  public getNextTakeNumber(
    seriesId: string,
    episodeNumber: number,
    shotId: string
  ): number {
    const shotIds = this.getEquivalentShotIds(shotId);
    if (this.db && !this.isFallback) {
      const placeholders = shotIds.map(() => "?").join(", ");
      const row = this.db
        .prepare(
          `SELECT COALESCE(MAX(take_number), 0) AS max_take FROM shot_takes WHERE series_id = ? AND episode_number = ? AND shot_id IN (${placeholders})`
        )
        .get(seriesId, episodeNumber, ...shotIds) as { max_take: number } | undefined;
      return (row?.max_take ?? 0) + 1;
    }
    const takes = Array.from(this.memoryStore.shot_takes.values()).filter(
      (t) =>
        t.series_id === seriesId &&
        t.episode_number === episodeNumber &&
        shotIds.includes(t.shot_id)
    );
    const maxTake = takes.reduce((acc, t) => Math.max(acc, t.take_number ?? 0), 0);
    return maxTake + 1;
  }

  public getSeriesCostAndTakesSummary(seriesId: string): {
    totalTakes: number;
    approvedTakes: number;
    totalCostUsd: number;
    episodes: Array<{
      episodeNumber: number;
      takeCount: number;
      approvedCount: number;
      costUsd: number;
    }>;
  } {
    let allTakes: any[] = [];
    if (this.db && !this.isFallback) {
      allTakes = this.db.prepare("SELECT * FROM shot_takes WHERE series_id = ?").all(seriesId) as any[];
    } else {
      allTakes = Array.from(this.memoryStore.shot_takes.values()).filter((t) => t.series_id === seriesId);
    }

    const episodesMap = new Map<number, { takeCount: number; approvedCount: number; costUsd: number }>();
    let totalCostUsd = 0;
    let approvedTakes = 0;

    for (const t of allTakes) {
      const ep = t.episode_number;
      if (!episodesMap.has(ep)) {
        episodesMap.set(ep, { takeCount: 0, approvedCount: 0, costUsd: 0 });
      }
      const epStat = episodesMap.get(ep)!;
      epStat.takeCount++;
      if (t.is_approved) {
        epStat.approvedCount++;
        approvedTakes++;
      }
      const cost = Number(t.cost_usd || 0);
      epStat.costUsd += cost;
      totalCostUsd += cost;
    }

    const episodes = Array.from(episodesMap.entries())
      .map(([episodeNumber, stat]) => ({
        episodeNumber,
        takeCount: stat.takeCount,
        approvedCount: stat.approvedCount,
        costUsd: Number(stat.costUsd.toFixed(4)),
      }))
      .sort((a, b) => a.episodeNumber - b.episodeNumber);

    return {
      totalTakes: allTakes.length,
      approvedTakes,
      totalCostUsd: Number(totalCostUsd.toFixed(4)),
      episodes,
    };
  }

  // ── Versioned Reference Asset Operations (V3) ─────────────────────────────

  public addReferenceAsset(asset: ReferenceAssetRecord): void {
    if (this.db && !this.isFallback) {
      const stmt = this.db.prepare(`
        INSERT INTO reference_assets (
          id, series_id, entity_type, entity_id, asset_kind,
          image_path, version, is_active, description, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          image_path = excluded.image_path,
          version = excluded.version,
          is_active = excluded.is_active,
          description = excluded.description
      `);
      stmt.run(
        asset.id,
        asset.series_id,
        asset.entity_type,
        asset.entity_id,
        asset.asset_kind,
        asset.image_path,
        asset.version ?? 1,
        asset.is_active ? 1 : 0,
        asset.description ?? null,
        asset.created_at || new Date().toISOString()
      );
    } else {
      this.memoryStore.reference_assets.set(asset.id, {
        ...asset,
        is_active: Boolean(asset.is_active),
      });
    }
  }

  public getReferenceAsset(assetId: string): ReferenceAssetRecord | null {
    if (this.db && !this.isFallback) {
      const row = this.db.prepare("SELECT * FROM reference_assets WHERE id = ?").get(assetId);
      if (!row) return null;
      return {
        ...row,
        is_active: Boolean(row.is_active),
      } as ReferenceAssetRecord;
    }
    return this.memoryStore.reference_assets.get(assetId) ?? null;
  }

  public listReferenceAssets(
    seriesId: string,
    entityType?: string,
    entityId?: string,
    activeOnly: boolean = true
  ): ReferenceAssetRecord[] {
    if (this.db && !this.isFallback) {
      let query = "SELECT * FROM reference_assets WHERE series_id = ?";
      const params: any[] = [seriesId];
      if (entityType) {
        query += " AND entity_type = ?";
        params.push(entityType);
      }
      if (entityId) {
        query += " AND entity_id = ?";
        params.push(entityId);
      }
      if (activeOnly) {
        query += " AND is_active = 1";
      }
      query += " ORDER BY entity_type ASC, entity_id ASC, version DESC";
      const rows = this.db.prepare(query).all(...params) as any[];
      return rows.map((r) => ({
        ...r,
        is_active: Boolean(r.is_active),
      }));
    }
    return Array.from(this.memoryStore.reference_assets.values()).filter(
      (a) =>
        a.series_id === seriesId &&
        (!entityType || a.entity_type === entityType) &&
        (!entityId || a.entity_id === entityId) &&
        (!activeOnly || Boolean(a.is_active))
    );
  }

  public deprecateReferenceAsset(assetId: string): void {
    if (this.db && !this.isFallback) {
      this.db.prepare("UPDATE reference_assets SET is_active = 0 WHERE id = ?").run(assetId);
    } else {
      const a = this.memoryStore.reference_assets.get(assetId);
      if (a) a.is_active = false;
    }
  }

  // ── Storyboard Keyframe Operations (V3) ───────────────────────────────────

  public recordStoryboardKeyframe(keyframe: StoryboardKeyframeRecord): void {
    if (this.db && !this.isFallback) {
      const stmt = this.db.prepare(`
        INSERT INTO storyboard_keyframes (
          id, series_id, episode_number, shot_id, version,
          composition_layout, camera_framing, image_path,
          is_approved, used_references_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          composition_layout = excluded.composition_layout,
          camera_framing = excluded.camera_framing,
          image_path = excluded.image_path,
          is_approved = excluded.is_approved,
          used_references_json = excluded.used_references_json
      `);
      stmt.run(
        keyframe.id,
        keyframe.series_id,
        keyframe.episode_number,
        keyframe.shot_id,
        keyframe.version ?? 1,
        keyframe.composition_layout,
        keyframe.camera_framing,
        keyframe.image_path,
        keyframe.is_approved ? 1 : 0,
        keyframe.used_references_json ?? "[]",
        keyframe.created_at || new Date().toISOString()
      );
    } else {
      this.memoryStore.storyboard_keyframes.set(keyframe.id, {
        ...keyframe,
        is_approved: Boolean(keyframe.is_approved),
      });
    }
  }

  public getStoryboardKeyframe(keyframeId: string): StoryboardKeyframeRecord | null {
    if (this.db && !this.isFallback) {
      const row = this.db.prepare("SELECT * FROM storyboard_keyframes WHERE id = ?").get(keyframeId);
      if (!row) return null;
      return {
        ...row,
        is_approved: Boolean(row.is_approved),
      } as StoryboardKeyframeRecord;
    }
    return this.memoryStore.storyboard_keyframes.get(keyframeId) ?? null;
  }

  public listStoryboardKeyframes(
    seriesId: string,
    episodeNumber: number,
    shotId?: string
  ): StoryboardKeyframeRecord[] {
    if (this.db && !this.isFallback) {
      let query = "SELECT * FROM storyboard_keyframes WHERE series_id = ? AND episode_number = ?";
      const params: any[] = [seriesId, episodeNumber];
      if (shotId) {
        query += " AND shot_id = ?";
        params.push(shotId);
      }
      query += " ORDER BY shot_id ASC, version DESC";
      const rows = this.db.prepare(query).all(...params) as any[];
      return rows.map((r) => ({
        ...r,
        is_approved: Boolean(r.is_approved),
      }));
    }
    return Array.from(this.memoryStore.storyboard_keyframes.values()).filter(
      (sb) =>
        sb.series_id === seriesId &&
        sb.episode_number === episodeNumber &&
        (!shotId || sb.shot_id === shotId)
    );
  }

  public getApprovedStoryboardForShot(
    seriesId: string,
    episodeNumber: number,
    shotId: string
  ): StoryboardKeyframeRecord | null {
    if (this.db && !this.isFallback) {
      const row = this.db.prepare(
        "SELECT * FROM storyboard_keyframes WHERE series_id = ? AND episode_number = ? AND shot_id = ? AND is_approved = 1"
      ).get(seriesId, episodeNumber, shotId);
      if (!row) return null;
      return {
        ...row,
        is_approved: true,
      } as StoryboardKeyframeRecord;
    }
    const match = Array.from(this.memoryStore.storyboard_keyframes.values()).find(
      (sb) =>
        sb.series_id === seriesId &&
        sb.episode_number === episodeNumber &&
        sb.shot_id === shotId &&
        Boolean(sb.is_approved)
    );
    return match ?? null;
  }

  public approveStoryboardKeyframe(keyframeId: string, isApproved: boolean = true): void {
    const keyframe = this.getStoryboardKeyframe(keyframeId);
    if (!keyframe) return;

    if (this.db && !this.isFallback) {
      if (isApproved) {
        this.db.prepare(
          "UPDATE storyboard_keyframes SET is_approved = 0 WHERE series_id = ? AND episode_number = ? AND shot_id = ?"
        ).run(keyframe.series_id, keyframe.episode_number, keyframe.shot_id);
      }
      this.db.prepare("UPDATE storyboard_keyframes SET is_approved = ? WHERE id = ?").run(
        isApproved ? 1 : 0,
        keyframeId
      );
    } else {
      if (isApproved) {
        for (const sb of this.memoryStore.storyboard_keyframes.values()) {
          if (
            sb.series_id === keyframe.series_id &&
            sb.episode_number === keyframe.episode_number &&
            sb.shot_id === keyframe.shot_id
          ) {
            sb.is_approved = false;
          }
        }
      }
      const target = this.memoryStore.storyboard_keyframes.get(keyframeId);
      if (target) target.is_approved = isApproved;
    }
  }

  // ============================================================================
  // PROVIDER JOBS & RESILIENT ORCHESTRATION (MIGRATION V4)
  // ============================================================================

  public createOrUpdateProviderJob(job: ProviderJobRecord): void {
    const now = new Date().toISOString();
    const cleanJob: ProviderJobRecord = {
      ...job,
      cost_category: job.cost_category || "estimated",
      metadata_json: job.metadata_json || "{}",
      created_at: job.created_at || now,
      updated_at: now,
      is_retryable: Boolean(job.is_retryable),
    };

    if (this.db && !this.isFallback) {
      const stmt = this.db.prepare(`
        INSERT INTO provider_jobs (
          id, series_id, episode_number, shot_id, provider, model_name,
          provider_job_id, idempotency_key, spec_hash, status, attempt_count,
          max_attempts, cost_category, estimated_cost_usd, reserved_cost_usd,
          confirmed_cost_usd, uncertain_cost_usd, output_url, output_local_path,
          error_code, error_message, is_retryable, worker_id, lock_expires_at,
          metadata_json, created_at, updated_at, completed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          status = excluded.status,
          provider_job_id = coalesce(excluded.provider_job_id, provider_jobs.provider_job_id),
          idempotency_key = coalesce(excluded.idempotency_key, provider_jobs.idempotency_key),
          attempt_count = excluded.attempt_count,
          cost_category = excluded.cost_category,
          estimated_cost_usd = excluded.estimated_cost_usd,
          reserved_cost_usd = excluded.reserved_cost_usd,
          confirmed_cost_usd = CASE WHEN excluded.confirmed_cost_usd > provider_jobs.confirmed_cost_usd THEN excluded.confirmed_cost_usd ELSE provider_jobs.confirmed_cost_usd END,
          uncertain_cost_usd = CASE WHEN excluded.uncertain_cost_usd > provider_jobs.uncertain_cost_usd THEN excluded.uncertain_cost_usd ELSE provider_jobs.uncertain_cost_usd END,
          output_url = coalesce(excluded.output_url, provider_jobs.output_url),
          output_local_path = coalesce(excluded.output_local_path, provider_jobs.output_local_path),
          error_code = excluded.error_code,
          error_message = excluded.error_message,
          is_retryable = excluded.is_retryable,
          worker_id = excluded.worker_id,
          lock_expires_at = excluded.lock_expires_at,
          metadata_json = excluded.metadata_json,
          updated_at = excluded.updated_at,
          completed_at = coalesce(excluded.completed_at, provider_jobs.completed_at)
      `);

      stmt.run(
        cleanJob.id,
        cleanJob.series_id,
        cleanJob.episode_number,
        cleanJob.shot_id,
        cleanJob.provider,
        cleanJob.model_name ?? null,
        cleanJob.provider_job_id ?? null,
        cleanJob.idempotency_key ?? null,
        cleanJob.spec_hash,
        cleanJob.status,
        cleanJob.attempt_count ?? 1,
        cleanJob.max_attempts ?? 3,
        cleanJob.cost_category,
        cleanJob.estimated_cost_usd ?? 0.0,
        cleanJob.reserved_cost_usd ?? 0.0,
        cleanJob.confirmed_cost_usd ?? 0.0,
        cleanJob.uncertain_cost_usd ?? 0.0,
        cleanJob.output_url ?? null,
        cleanJob.output_local_path ?? null,
        cleanJob.error_code ?? null,
        cleanJob.error_message ?? null,
        cleanJob.is_retryable ? 1 : 0,
        cleanJob.worker_id ?? null,
        cleanJob.lock_expires_at ?? null,
        cleanJob.metadata_json,
        cleanJob.created_at,
        cleanJob.updated_at,
        cleanJob.completed_at ?? null
      );
    } else {
      const existing = this.memoryStore.provider_jobs.get(cleanJob.id);
      if (existing) {
        cleanJob.confirmed_cost_usd = Math.max(cleanJob.confirmed_cost_usd ?? 0, existing.confirmed_cost_usd ?? 0);
        cleanJob.uncertain_cost_usd = Math.max(cleanJob.uncertain_cost_usd ?? 0, existing.uncertain_cost_usd ?? 0);
      }
      this.memoryStore.provider_jobs.set(cleanJob.id, cleanJob);
    }
  }

  /**
   * Atomically checks available balance, checks worker lease, and reserves budget
   * for a provider job inside an immediate SQLite transaction (BEGIN IMMEDIATE TRANSACTION).
   * Free jobs (estimatedCost = 0) strictly retain 0.0 without default substitutions.
   */
  public atomicReserveProviderJob(
    job: ProviderJobRecord,
    options: {
      budgetCapUsd?: number;
      workerLeaseSec?: number;
    } = {}
  ): {
    allowed: boolean;
    remainingUsd: number;
    totalCommittedUsd: number;
    reason?: string;
    reservedRecord?: ProviderJobRecord;
  } {
    const seriesId = job.series_id;
    const workerLeaseSec = options.workerLeaseSec ?? 120;
    const now = new Date();
    const nowIso = now.toISOString();
    const lockExpiresAt = new Date(now.getTime() + workerLeaseSec * 1000).toISOString();

    const estimatedCost =
      job.estimated_cost_usd !== undefined
        ? job.estimated_cost_usd
        : (job.reserved_cost_usd ?? 0.0);

    const cleanJob: ProviderJobRecord = {
      ...job,
      status: "reserved",
      cost_category: "reserved",
      estimated_cost_usd: estimatedCost,
      reserved_cost_usd: estimatedCost,
      confirmed_cost_usd: job.confirmed_cost_usd ?? 0.0,
      uncertain_cost_usd: job.uncertain_cost_usd ?? 0.0,
      worker_id: job.worker_id || "worker_default",
      lock_expires_at: lockExpiresAt,
      created_at: job.created_at || nowIso,
      updated_at: nowIso,
    };

    if (this.db && !this.isFallback) {
      this.db.exec("BEGIN IMMEDIATE TRANSACTION;");
      try {
        // 1. Worker lock and lease verification
        const existingRow = this.db
          .prepare("SELECT id, worker_id, lock_expires_at, status, spec_hash, provider, confirmed_cost_usd, reserved_cost_usd, uncertain_cost_usd FROM provider_jobs WHERE id = ?")
          .get(cleanJob.id) as any;

        if (existingRow) {
          const isExpired = existingRow.lock_expires_at
            ? new Date(existingRow.lock_expires_at).getTime() <= now.getTime()
            : true;
          if (existingRow.worker_id && existingRow.worker_id !== cleanJob.worker_id && !isExpired) {
            this.db.exec("ROLLBACK;");
            const summary = this.getSeriesBudgetLedger(seriesId);
            return {
              allowed: false,
              remainingUsd: summary.remainingAvailableUsd,
              totalCommittedUsd: summary.totalCommittedUsd,
              reason: `Job '${cleanJob.id}' is locked by worker '${existingRow.worker_id}' until ${existingRow.lock_expires_at}`,
            };
          }
          cleanJob.confirmed_cost_usd = Math.max(cleanJob.confirmed_cost_usd, Number(existingRow.confirmed_cost_usd || 0));
          cleanJob.uncertain_cost_usd = Math.max(cleanJob.uncertain_cost_usd, Number(existingRow.uncertain_cost_usd || 0));
        }

        // 2. Query budget ledger within the transaction
        const budget = this.getSeriesBudget(seriesId);
        const effectiveCap =
          options.budgetCapUsd !== undefined
            ? Math.min(budget.max_budget_usd, options.budgetCapUsd)
            : budget.max_budget_usd;

        const rows = this.db
          .prepare(`
            SELECT cost_category, status,
                   SUM(confirmed_cost_usd) as sum_confirmed,
                   SUM(reserved_cost_usd) as sum_reserved,
                   SUM(uncertain_cost_usd) as sum_uncertain
            FROM provider_jobs
            WHERE series_id = ?
            GROUP BY cost_category, status
          `)
          .all(seriesId) as any[];

        let confirmedCost = 0;
        let reservedCost = 0;
        let uncertainCost = 0;

        for (const r of rows) {
          if (r.cost_category === "confirmed" || r.status === "completed") {
            confirmedCost += Number(r.sum_confirmed || 0);
          } else if (r.status === "uncertain_timeout" || r.cost_category === "uncertain") {
            uncertainCost += Number(r.sum_uncertain || r.sum_reserved || 0);
          } else if (["reserved", "submitted", "running"].includes(r.status)) {
            reservedCost += Number(r.sum_reserved || 0);
          }
        }

        if (existingRow && ["reserved", "submitted", "running"].includes(existingRow.status)) {
          reservedCost = Math.max(0, reservedCost - Number(existingRow.reserved_cost_usd || 0));
        }

        const apiLogSum = this.db
          .prepare("SELECT SUM(cost_usd) as total FROM api_usage_logs WHERE shot_id LIKE ?")
          .get(`${seriesId}%`) as any;
        if (apiLogSum?.total) {
          confirmedCost = Math.max(confirmedCost, Number(apiLogSum.total));
        }

        const currentCommitted = confirmedCost + reservedCost + uncertainCost;
        const requestedCost = cleanJob.estimated_cost_usd ?? 0.0;
        const potentialCommitment = currentCommitted + requestedCost;

        if (potentialCommitment > effectiveCap) {
          this.db.exec("ROLLBACK;");
          return {
            allowed: false,
            remainingUsd: Math.max(0, effectiveCap - currentCommitted),
            totalCommittedUsd: Math.round(currentCommitted * 10000) / 10000,
            reason: `Budget cap exceeded ($${effectiveCap.toFixed(2)})`,
          };
        }

        // 3. Write reservation record inside the transaction
        this.createOrUpdateProviderJob(cleanJob);
        this.db.exec("COMMIT;");

        const newTotalCommitted = Math.round((currentCommitted + requestedCost) * 10000) / 10000;
        return {
          allowed: true,
          remainingUsd: Math.max(0, Math.round((effectiveCap - newTotalCommitted) * 10000) / 10000),
          totalCommittedUsd: newTotalCommitted,
          reservedRecord: cleanJob,
        };
      } catch (err) {
        try {
          this.db.exec("ROLLBACK;");
        } catch {}
        throw err;
      }
    } else {
      // Memory store fallback
      const existing = this.memoryStore.provider_jobs.get(cleanJob.id);
      if (existing) {
        const isExpired = existing.lock_expires_at
          ? new Date(existing.lock_expires_at).getTime() <= now.getTime()
          : true;
        if (existing.worker_id && existing.worker_id !== cleanJob.worker_id && !isExpired) {
          const summary = this.getSeriesBudgetLedger(seriesId);
          return {
            allowed: false,
            remainingUsd: summary.remainingAvailableUsd,
            totalCommittedUsd: summary.totalCommittedUsd,
            reason: `Job '${cleanJob.id}' is locked by worker '${existing.worker_id}' until ${existing.lock_expires_at}`,
          };
        }
        cleanJob.confirmed_cost_usd = Math.max(cleanJob.confirmed_cost_usd ?? 0, existing.confirmed_cost_usd ?? 0);
        cleanJob.uncertain_cost_usd = Math.max(cleanJob.uncertain_cost_usd ?? 0, existing.uncertain_cost_usd ?? 0);
      }

      const budget = this.getSeriesBudget(seriesId);
      const effectiveCap =
        options.budgetCapUsd !== undefined
          ? Math.min(budget.max_budget_usd, options.budgetCapUsd)
          : budget.max_budget_usd;

      const summary = this.getSeriesBudgetLedger(seriesId);
      const currentJobPreviousReserved =
        (existing && ["reserved", "submitted", "running"].includes(existing.status))
          ? (existing.reserved_cost_usd || 0)
          : 0;
      const currentCommitted = summary.totalCommittedUsd - currentJobPreviousReserved;
      const requestedCost = cleanJob.estimated_cost_usd ?? 0.0;
      const potentialCommitment = currentCommitted + requestedCost;

      if (potentialCommitment > effectiveCap) {
        return {
          allowed: false,
          remainingUsd: Math.max(0, effectiveCap - currentCommitted),
          totalCommittedUsd: Math.round(currentCommitted * 10000) / 10000,
          reason: `Budget cap exceeded ($${effectiveCap.toFixed(2)})`,
        };
      }

      this.createOrUpdateProviderJob(cleanJob);
      const newTotalCommitted = Math.round((currentCommitted + requestedCost) * 10000) / 10000;
      return {
        allowed: true,
        remainingUsd: Math.max(0, Math.round((effectiveCap - newTotalCommitted) * 10000) / 10000),
        totalCommittedUsd: newTotalCommitted,
        reservedRecord: cleanJob,
      };
    }
  }

  public getProviderJobsForShot(
    seriesId: string,
    episodeNumber: number,
    shotId: string
  ): ProviderJobRecord[] {
    if (this.db && !this.isFallback) {
      const rows = this.db
        .prepare(
          "SELECT * FROM provider_jobs WHERE series_id = ? AND episode_number = ? AND shot_id = ? ORDER BY created_at DESC"
        )
        .all(seriesId, episodeNumber, shotId) as any[];
      return rows.map((r) => ({
        ...r,
        is_retryable: Boolean(r.is_retryable),
      }));
    }
    return Array.from(this.memoryStore.provider_jobs.values())
      .filter(
        (j) =>
          j.series_id === seriesId &&
          j.episode_number === episodeNumber &&
          j.shot_id === shotId
      )
      .sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""));
  }

  public getProviderJob(id: string): ProviderJobRecord | null {
    if (this.db && !this.isFallback) {
      const row = this.db.prepare("SELECT * FROM provider_jobs WHERE id = ?").get(id);
      if (!row) return null;
      return {
        ...row,
        is_retryable: Boolean(row.is_retryable),
      } as ProviderJobRecord;
    }
    return this.memoryStore.provider_jobs.get(id) ?? null;
  }

  public findJobByRemoteId(provider: string, providerJobId: string): ProviderJobRecord | null {
    if (this.db && !this.isFallback) {
      const row = this.db.prepare(
        "SELECT * FROM provider_jobs WHERE provider = ? AND provider_job_id = ?"
      ).get(provider, providerJobId);
      if (!row) return null;
      return {
        ...row,
        is_retryable: Boolean(row.is_retryable),
      } as ProviderJobRecord;
    }
    const match = Array.from(this.memoryStore.provider_jobs.values()).find(
      (j) => j.provider === provider && j.provider_job_id === providerJobId
    );
    return match ?? null;
  }

  public findCompletedJobBySpecHash(specHash: string): ProviderJobRecord | null {
    if (this.db && !this.isFallback) {
      const row = this.db.prepare(
        "SELECT * FROM provider_jobs WHERE spec_hash = ? AND status = 'completed' ORDER BY updated_at DESC LIMIT 1"
      ).get(specHash);
      if (!row) return null;
      return {
        ...row,
        is_retryable: Boolean(row.is_retryable),
      } as ProviderJobRecord;
    }
    const matches = Array.from(this.memoryStore.provider_jobs.values())
      .filter((j) => j.spec_hash === specHash && j.status === "completed")
      .sort((a, b) => ((b.updated_at || "") > (a.updated_at || "") ? 1 : -1));
    return matches[0] ?? null;
  }

  public listPendingJobsForSeries(seriesId: string, episodeNumber?: number): ProviderJobRecord[] {
    const pendingStatuses = ["queued", "reserved", "submitted", "running", "uncertain_timeout"];
    if (this.db && !this.isFallback) {
      let query = `
        SELECT * FROM provider_jobs
        WHERE series_id = ? AND status IN (${pendingStatuses.map(() => "?").join(", ")})
      `;
      const params: any[] = [seriesId, ...pendingStatuses];
      if (episodeNumber !== undefined) {
        query += " AND episode_number = ?";
        params.push(episodeNumber);
      }
      query += " ORDER BY episode_number ASC, shot_id ASC";
      const rows = this.db.prepare(query).all(...params) as any[];
      return rows.map((r) => ({
        ...r,
        is_retryable: Boolean(r.is_retryable),
      }));
    }
    return Array.from(this.memoryStore.provider_jobs.values()).filter(
      (j) =>
        j.series_id === seriesId &&
        pendingStatuses.includes(j.status) &&
        (episodeNumber === undefined || j.episode_number === episodeNumber)
    );
  }

  public acquireJobLease(jobId: string, workerId: string, leaseDurationMs: number = 60000): boolean {
    const now = new Date();
    const lockExpiresAt = new Date(now.getTime() + leaseDurationMs).toISOString();
    const nowIso = now.toISOString();

    if (this.db && !this.isFallback) {
      // Atomic compare-and-swap lease acquisition
      const stmt = this.db.prepare(`
        UPDATE provider_jobs
        SET worker_id = ?, lock_expires_at = ?, updated_at = ?
        WHERE id = ? AND (worker_id IS NULL OR worker_id = ? OR lock_expires_at < ?)
      `);
      const res = stmt.run(workerId, lockExpiresAt, nowIso, jobId, workerId, nowIso);
      return (res?.changes || 0) > 0;
    }

    const job = this.memoryStore.provider_jobs.get(jobId);
    if (!job) return false;
    const isFree = !job.worker_id || job.worker_id === workerId || (job.lock_expires_at && job.lock_expires_at < nowIso);
    if (isFree) {
      job.worker_id = workerId;
      job.lock_expires_at = lockExpiresAt;
      job.updated_at = nowIso;
      return true;
    }
    return false;
  }

  public releaseJobLease(jobId: string, workerId: string): void {
    const now = new Date().toISOString();
    if (this.db && !this.isFallback) {
      this.db.prepare(`
        UPDATE provider_jobs
        SET worker_id = NULL, lock_expires_at = NULL, updated_at = ?
        WHERE id = ? AND worker_id = ?
      `).run(now, jobId, workerId);
    } else {
      const job = this.memoryStore.provider_jobs.get(jobId);
      if (job && job.worker_id === workerId) {
        job.worker_id = undefined;
        job.lock_expires_at = undefined;
        job.updated_at = now;
      }
    }
  }

  public setSeriesBudget(
    budgetOrSeriesId: SeriesBudgetRecord | string,
    maxBudgetUsd?: number,
    warningThresholdRatio?: number,
    isHardCapped?: boolean,
    notes?: string
  ): void {
    const now = new Date().toISOString();
    let budget: SeriesBudgetRecord;
    if (typeof budgetOrSeriesId === "string") {
      budget = {
        series_id: budgetOrSeriesId,
        max_budget_usd: maxBudgetUsd ?? 10.0,
        warning_threshold_ratio: warningThresholdRatio ?? 0.85,
        is_hard_capped: isHardCapped ?? true,
        notes,
        updated_at: now,
      };
    } else {
      budget = budgetOrSeriesId;
    }
    const clean: SeriesBudgetRecord = {
      ...budget,
      is_hard_capped: Boolean(budget.is_hard_capped),
      updated_at: budget.updated_at || now,
    };

    if (this.db && !this.isFallback) {
      this.db.prepare(`
        INSERT INTO series_budgets (
          series_id, max_budget_usd, warning_threshold_ratio, is_hard_capped, notes, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(series_id) DO UPDATE SET
          max_budget_usd = excluded.max_budget_usd,
          warning_threshold_ratio = excluded.warning_threshold_ratio,
          is_hard_capped = excluded.is_hard_capped,
          notes = excluded.notes,
          updated_at = excluded.updated_at
      `).run(
        clean.series_id,
        clean.max_budget_usd,
        clean.warning_threshold_ratio ?? 0.85,
        clean.is_hard_capped ? 1 : 0,
        clean.notes ?? null,
        clean.updated_at
      );
    } else {
      this.memoryStore.series_budgets.set(clean.series_id, clean);
    }
  }

  public getSeriesBudget(seriesId: string): SeriesBudgetRecord {
    if (this.db && !this.isFallback) {
      const row = this.db.prepare("SELECT * FROM series_budgets WHERE series_id = ?").get(seriesId);
      if (row) {
        return {
          ...row,
          is_hard_capped: Boolean(row.is_hard_capped),
        } as SeriesBudgetRecord;
      }
    } else {
      const b = this.memoryStore.series_budgets.get(seriesId);
      if (b) return b;
    }
    return {
      series_id: seriesId,
      max_budget_usd: 25.0, // Default $25 per series
      warning_threshold_ratio: 0.85,
      is_hard_capped: true,
      updated_at: new Date().toISOString(),
    };
  }

  public getSeriesBudgetLedger(seriesId: string): BudgetLedgerSummary {
    const budget = this.getSeriesBudget(seriesId);
    let confirmedCost = 0;
    let reservedCost = 0;
    let uncertainCost = 0;

    if (this.db && !this.isFallback) {
      const rows = this.db.prepare(`
        SELECT cost_category, status,
               SUM(confirmed_cost_usd) as sum_confirmed,
               SUM(reserved_cost_usd) as sum_reserved,
               SUM(uncertain_cost_usd) as sum_uncertain
        FROM provider_jobs
        WHERE series_id = ?
        GROUP BY cost_category, status
      `).all(seriesId) as any[];

      for (const r of rows) {
        if (r.cost_category === "confirmed" || r.status === "completed") {
          confirmedCost += Number(r.sum_confirmed || 0);
        } else if (r.status === "uncertain_timeout" || r.cost_category === "uncertain") {
          uncertainCost += Number(r.sum_uncertain || r.sum_reserved || 0);
        } else if (["reserved", "submitted", "running"].includes(r.status)) {
          reservedCost += Number(r.sum_reserved || 0);
        }
      }

      // Also sum legacy api_usage_logs if present
      const apiLogSum = this.db.prepare(`
        SELECT SUM(cost_usd) as total FROM api_usage_logs WHERE shot_id LIKE ?
      `).get(`${seriesId}%`) as any;
      if (apiLogSum?.total) {
        confirmedCost = Math.max(confirmedCost, Number(apiLogSum.total));
      }
    } else {
      for (const j of this.memoryStore.provider_jobs.values()) {
        if (j.series_id !== seriesId) continue;
        if (j.cost_category === "confirmed" || j.status === "completed") {
          confirmedCost += j.confirmed_cost_usd || 0;
        } else if (j.status === "uncertain_timeout" || j.cost_category === "uncertain") {
          uncertainCost += j.uncertain_cost_usd || j.reserved_cost_usd || 0;
        } else if (["reserved", "submitted", "running"].includes(j.status)) {
          reservedCost += j.reserved_cost_usd || 0;
        }
      }
    }

    const totalCommitted = confirmedCost + reservedCost + uncertainCost;
    const remainingAvailable = Math.max(0, budget.max_budget_usd - totalCommitted);
    const isExceeded = totalCommitted > budget.max_budget_usd;

    return {
      seriesId,
      maxBudgetUsd: budget.max_budget_usd,
      confirmedCostUsd: Math.round(confirmedCost * 10000) / 10000,
      reservedCostUsd: Math.round(reservedCost * 10000) / 10000,
      uncertainCostUsd: Math.round(uncertainCost * 10000) / 10000,
      totalCommittedUsd: Math.round(totalCommitted * 10000) / 10000,
      remainingAvailableUsd: Math.round(remainingAvailable * 10000) / 10000,
      isExceeded,
    };
  }

  public atomicReserveBudget(
    seriesId: string,
    amountUsd: number
  ): { allowed: boolean; remaining: number; totalCommitted: number } {
    const ledger = this.getSeriesBudgetLedger(seriesId);
    if (ledger.totalCommittedUsd + amountUsd > ledger.maxBudgetUsd) {
      return {
        allowed: false,
        remaining: ledger.remainingAvailableUsd,
        totalCommitted: ledger.totalCommittedUsd,
      };
    }
    return {
      allowed: true,
      remaining: ledger.remainingAvailableUsd - amountUsd,
      totalCommitted: ledger.totalCommittedUsd + amountUsd,
    };
  }

  public setRateCard(rateCard: any): void {
    const now = new Date().toISOString();
    const modelName = rateCard.model_name ?? rateCard.modelName ?? "default";
    const provider = rateCard.provider;
    const effectiveDate = rateCard.effective_date ?? rateCard.effectiveDate ?? now.split("T")[0];
    const id = rateCard.id ?? `rate_${provider}_${modelName}_${effectiveDate.replace(/-/g, "")}`;
    const ratePerSec = rateCard.rate_per_sec_usd ?? rateCard.ratePerSecUsd ?? 0.0;
    const clean: ProviderRateCardRecord = {
      id,
      provider,
      model_name: modelName,
      rate_per_sec_usd: ratePerSec,
      rate_per_unit_usd: rateCard.rate_per_unit_usd ?? rateCard.ratePerUnitUsd ?? ratePerSec,
      unit_type: rateCard.unit_type ?? rateCard.unitType ?? "second",
      currency: rateCard.currency ?? "USD",
      effective_date: effectiveDate,
      source_doc_url: rateCard.source_doc_url ?? rateCard.sourceDocUrl ?? null,
      notes: rateCard.notes ?? null,
      created_at: rateCard.created_at ?? now,
    };

    if (this.db && !this.isFallback) {
      this.db.prepare(`
        INSERT INTO provider_rate_cards (
          id, provider, model_name, rate_per_sec_usd, rate_per_unit_usd,
          unit_type, currency, effective_date, source_doc_url, notes, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          rate_per_sec_usd = excluded.rate_per_sec_usd,
          rate_per_unit_usd = excluded.rate_per_unit_usd,
          unit_type = excluded.unit_type,
          currency = excluded.currency,
          effective_date = excluded.effective_date,
          source_doc_url = excluded.source_doc_url,
          notes = excluded.notes
      `).run(
        clean.id,
        clean.provider,
        clean.model_name,
        clean.rate_per_sec_usd,
        clean.rate_per_unit_usd ?? null,
        clean.unit_type || "second",
        clean.currency || "USD",
        clean.effective_date,
        clean.source_doc_url ?? null,
        clean.notes ?? null,
        clean.created_at
      );
    } else {
      this.memoryStore.provider_rate_cards.set(clean.id, clean);
    }
  }

  public getRateCard(provider: string, modelName?: string): ProviderRateCardRecord | null {
    if (this.db && !this.isFallback) {
      let query = "SELECT * FROM provider_rate_cards WHERE provider = ?";
      const params: any[] = [provider];
      if (modelName) {
        query += " AND model_name = ?";
        params.push(modelName);
      }
      query += " ORDER BY effective_date DESC LIMIT 1";
      const row = this.db.prepare(query).get(...params);
      return (row as ProviderRateCardRecord) ?? null;
    }

    const matches = Array.from(this.memoryStore.provider_rate_cards.values())
      .filter((r) => r.provider === provider && (!modelName || r.model_name === modelName))
      .sort((a, b) => (b.effective_date > a.effective_date ? 1 : -1));
    return matches[0] ?? null;
  }

  public listRateCards(provider?: string): ProviderRateCardRecord[] {
    if (this.db && !this.isFallback) {
      let query = "SELECT * FROM provider_rate_cards";
      const params: any[] = [];
      if (provider) {
        query += " WHERE provider = ?";
        params.push(provider);
      }
      query += " ORDER BY provider ASC, effective_date DESC";
      return (this.db.prepare(query).all(...params) as ProviderRateCardRecord[]) ?? [];
    }
    return Array.from(this.memoryStore.provider_rate_cards.values()).filter(
      (r) => !provider || r.provider === provider
    );
  }
}

export { BibleManager as StoryBibleManager };
