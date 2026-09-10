-- Story Bible SQLite Schema for Episodic AI Cinema
-- Ensures narrative, visual, and audio consistency across long-form series.

CREATE TABLE IF NOT EXISTS series_metadata (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  genre TEXT,
  visual_style TEXT NOT NULL, -- persistent art style, lighting, camera aesthetics
  negative_prompt TEXT,
  aspect_ratio TEXT NOT NULL DEFAULT '9:16', -- '9:16' or '16:9'
  fps INTEGER NOT NULL DEFAULT 30,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS characters (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  role TEXT NOT NULL, -- protagonist, antagonist, supporting
  visual_summary TEXT NOT NULL, -- persistent physical appearance description
  personality_traits TEXT NOT NULL, -- JSON array of personality traits & speech quirks
  voice_profile_id TEXT, -- identifier for voice cloning profile
  voice_embedding_path TEXT, -- path to local voice embedding file (.pt or .json)
  status TEXT NOT NULL DEFAULT 'alive', -- alive, injured, deceased, missing
  face_reference_image TEXT, -- path to canonical reference portrait
  character_sheet_path TEXT, -- multi-angle turnaround sheet
  current_wardrobe_id TEXT, -- active costume identifier
  distinguishing_marks TEXT -- scars, tattoos, physical marks that must persist
);

CREATE TABLE IF NOT EXISTS character_wardrobes (
  id TEXT PRIMARY KEY,
  character_id TEXT NOT NULL,
  outfit_name TEXT NOT NULL, -- e.g. "combat_gear", "formal_tuxedo", "casual_hoodie"
  visual_description TEXT NOT NULL, -- detailed garment, colors, textures
  reference_image_path TEXT,
  is_default INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (character_id) REFERENCES characters (id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS locations (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  visual_summary TEXT NOT NULL, -- architectural style, key colors, permanent fixtures
  atmospheric_rules TEXT, -- e.g. "perpetual neon rain, damp reflection on asphalt"
  reference_image_path TEXT,
  lighting_mood TEXT
);

CREATE TABLE IF NOT EXISTS key_props (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  visual_summary TEXT NOT NULL, -- materials, engravings, unique identifying features
  current_holder_id TEXT, -- character_id or location_id currently in possession
  reference_image_path TEXT,
  status TEXT NOT NULL DEFAULT 'intact' -- intact, damaged, lost, destroyed
);

CREATE TABLE IF NOT EXISTS character_knowledge (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  character_id TEXT NOT NULL,
  fact_key TEXT NOT NULL, -- e.g. "knows_secret_key", "knows_killer_identity"
  revealed_in_episode INTEGER NOT NULL,
  notes TEXT,
  FOREIGN KEY (character_id) REFERENCES characters (id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS world_state (
  key TEXT PRIMARY KEY, -- e.g. "quantum_drive_location", "lab_station_status"
  value_json TEXT NOT NULL,
  updated_at_episode INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS episode_summaries (
  episode_number INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  logline TEXT NOT NULL,
  major_events_json TEXT NOT NULL, -- JSON array of major events
  delta_changes_json TEXT NOT NULL, -- JSON object of changes committed to bible
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS api_usage_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  episode_number INTEGER,
  shot_id TEXT,
  provider TEXT NOT NULL, -- e.g. "local_comfyui", "api_wan", "anthropic", "xtts"
  type TEXT NOT NULL, -- "llm", "video", "tts"
  units REAL NOT NULL, -- tokens, seconds, or chars
  cost_usd REAL NOT NULL,
  timestamp TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS shot_takes (
  id TEXT PRIMARY KEY, -- e.g. "cyber-saigon_ep01_sc01_sh01_take01"
  series_id TEXT NOT NULL,
  episode_number INTEGER NOT NULL,
  shot_id TEXT NOT NULL,
  take_number INTEGER NOT NULL DEFAULT 1,
  provider TEXT NOT NULL, -- "mock", "api_kling", "api_runway", "local_comfyui"
  prompt TEXT NOT NULL,
  seed INTEGER,
  local_path TEXT NOT NULL,
  duration_sec REAL NOT NULL,
  qa_status TEXT NOT NULL DEFAULT 'PASS', -- 'PASS', 'WARN', 'FAIL'
  qa_score REAL,
  qa_notes TEXT,
  is_approved INTEGER NOT NULL DEFAULT 0,
  cost_usd REAL NOT NULL DEFAULT 0.0,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_shot_takes_lookup ON shot_takes (series_id, episode_number, shot_id);

-- ============================================================================
-- VERSIONED CANON STATE MANAGER TABLES (MIGRATION V2)
-- ============================================================================

-- Schema migrations tracker
CREATE TABLE IF NOT EXISTS canon_migrations (
  version INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  applied_at TEXT NOT NULL
);

-- Mutable episodic character state (separated from permanent archetype in `characters`)
CREATE TABLE IF NOT EXISTS character_states (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  character_id TEXT NOT NULL,
  episode_number INTEGER NOT NULL,
  scene_id TEXT,
  status TEXT NOT NULL DEFAULT 'alive', -- 'alive', 'injured', 'deceased', 'missing'
  current_wardrobe_id TEXT,
  distinguishing_marks TEXT,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (character_id) REFERENCES characters (id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_character_states_lookup ON character_states (character_id, episode_number);

-- Mutable episodic key prop state (separated from permanent archetype in `key_props`)
CREATE TABLE IF NOT EXISTS prop_states (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  prop_id TEXT NOT NULL,
  episode_number INTEGER NOT NULL,
  scene_id TEXT,
  current_holder_id TEXT, -- character_id or location_id
  status TEXT NOT NULL DEFAULT 'intact', -- 'intact', 'damaged', 'lost', 'destroyed'
  updated_at TEXT NOT NULL,
  FOREIGN KEY (prop_id) REFERENCES key_props (id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_prop_states_lookup ON prop_states (prop_id, episode_number);

-- Mutable episodic location state (separated from permanent archetype in `locations`)
CREATE TABLE IF NOT EXISTS location_states (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  location_id TEXT NOT NULL,
  episode_number INTEGER NOT NULL,
  scene_id TEXT,
  atmospheric_rules TEXT,
  lighting_mood TEXT,
  status TEXT NOT NULL DEFAULT 'accessible', -- 'accessible', 'damaged', 'destroyed', 'restricted'
  updated_at TEXT NOT NULL,
  FOREIGN KEY (location_id) REFERENCES locations (id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_location_states_lookup ON location_states (location_id, episode_number);

-- Granular state transition event log
CREATE TABLE IF NOT EXISTS state_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  series_id TEXT NOT NULL,
  episode_number INTEGER NOT NULL,
  scene_id TEXT,
  entity_type TEXT NOT NULL, -- 'character', 'prop', 'location', 'world'
  entity_id TEXT NOT NULL,
  event_type TEXT NOT NULL, -- 'status_change', 'prop_transfer', 'wardrobe_change', 'knowledge_revealed', 'world_state'
  from_state_json TEXT,
  to_state_json TEXT NOT NULL,
  story_time TEXT, -- In-story temporal anchor (e.g. "Đêm mưa bão 2088", "Hồi 1 Phân đoạn 2")
  confirmation_source TEXT NOT NULL, -- 'director_approval', 'script_delta', 'manual_override', 'pipeline_commit'
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_state_events_lookup ON state_events (series_id, episode_number, entity_type, entity_id);

-- Immutable frozen canon snapshots
CREATE TABLE IF NOT EXISTS canon_snapshots (
  id TEXT PRIMARY KEY, -- e.g. "snap_cyber-saigon_ep01_v1"
  series_id TEXT NOT NULL,
  episode_number INTEGER NOT NULL,
  snapshot_version INTEGER NOT NULL DEFAULT 1,
  state_hash TEXT NOT NULL, -- SHA-256 state hash
  snapshot_json TEXT NOT NULL, -- Complete serialized snapshot payload
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_canon_snapshots_lookup ON canon_snapshots (series_id, episode_number);

-- Episode production lifecycle state machine
CREATE TABLE IF NOT EXISTS episode_lifecycle (
  episode_number INTEGER PRIMARY KEY,
  series_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft', -- 'draft', 'rendered', 'approved', 'committed', 'rejected', 'failed'
  snapshot_id TEXT, -- Bound canon snapshot
  needs_review INTEGER NOT NULL DEFAULT 0, -- Set to 1 when earlier canon changes invalidate this episode
  review_notes TEXT,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (snapshot_id) REFERENCES canon_snapshots (id)
);

CREATE INDEX IF NOT EXISTS idx_lifecycle_status ON episode_lifecycle (series_id, status);

-- Applied commit tracking for transactional idempotency
CREATE TABLE IF NOT EXISTS applied_commits (
  commit_id TEXT PRIMARY KEY, -- SHA-256 or unique commit token
  episode_number INTEGER NOT NULL,
  summary_title TEXT NOT NULL,
  applied_at TEXT NOT NULL
);

-- ============================================================================
-- VERSIONED REFERENCE ASSETS & STORYBOARD KEYFRAMES (MIGRATION V3)
-- ============================================================================

-- Versioned Reference Assets (multi-angle face, full-body, wardrobe, location, prop)
CREATE TABLE IF NOT EXISTS reference_assets (
  id TEXT PRIMARY KEY, -- e.g. "ref_char_minh_face_front_v1"
  series_id TEXT NOT NULL,
  entity_type TEXT NOT NULL, -- 'character', 'wardrobe', 'location', 'prop'
  entity_id TEXT NOT NULL,
  asset_kind TEXT NOT NULL, -- 'face_front', 'face_three_quarter', 'face_profile', 'full_body', 'turnaround', 'environment', 'prop_detail'
  image_path TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  is_active INTEGER NOT NULL DEFAULT 1,
  description TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_reference_assets_lookup ON reference_assets (series_id, entity_type, entity_id, is_active);

-- Storyboard Keyframes (composition, camera layout, staging - separated from character identity)
CREATE TABLE IF NOT EXISTS storyboard_keyframes (
  id TEXT PRIMARY KEY, -- e.g. "sb_cyber-saigon_ep01_sc01_sh01_v1"
  series_id TEXT NOT NULL,
  episode_number INTEGER NOT NULL,
  shot_id TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  composition_layout TEXT NOT NULL, -- Framing/rule-of-thirds/depth staging
  camera_framing TEXT NOT NULL, -- 'establishing', 'wide', 'medium', 'close_up', 'extreme_close_up', 'action'
  image_path TEXT NOT NULL, -- Storyboard sketch / preview image
  is_approved INTEGER NOT NULL DEFAULT 0,
  used_references_json TEXT NOT NULL DEFAULT '[]', -- References bound at storyboard time
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_storyboard_lookup ON storyboard_keyframes (series_id, episode_number, shot_id);

-- ============================================================================
-- RESILIENT JOB ORCHESTRATION & LEDGER (MIGRATION V4)
-- ============================================================================

-- Provider background jobs with durable remote IDs, spec hashes, and retry classification
CREATE TABLE IF NOT EXISTS provider_jobs (
  id TEXT PRIMARY KEY, -- Unique local job ID (e.g. "pjob_cyber_ep01_sc01_sh01_att1")
  series_id TEXT NOT NULL,
  episode_number INTEGER NOT NULL,
  shot_id TEXT NOT NULL,
  provider TEXT NOT NULL, -- "api_kling", "api_runway", "api_veo", "api_seedance", "mock", "local_comfyui"
  model_name TEXT, -- Specific model identifier/version, e.g. "kling-v2", "veo-3.1"
  provider_job_id TEXT, -- Task ID assigned by remote provider
  idempotency_key TEXT, -- Provided only when adapter/provider supports it
  spec_hash TEXT NOT NULL, -- SHA-256 hash of all deterministic inputs
  status TEXT NOT NULL DEFAULT 'queued', -- 'queued', 'reserved', 'submitted', 'running', 'completed', 'failed', 'uncertain_timeout', 'cancelled'
  attempt_count INTEGER NOT NULL DEFAULT 1,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  cost_category TEXT NOT NULL DEFAULT 'estimated', -- 'estimated', 'reserved', 'confirmed', 'uncertain'
  estimated_cost_usd REAL NOT NULL DEFAULT 0.0,
  reserved_cost_usd REAL NOT NULL DEFAULT 0.0,
  confirmed_cost_usd REAL NOT NULL DEFAULT 0.0,
  uncertain_cost_usd REAL NOT NULL DEFAULT 0.0,
  output_url TEXT,
  output_local_path TEXT,
  error_code TEXT,
  error_message TEXT,
  is_retryable INTEGER NOT NULL DEFAULT 1,
  worker_id TEXT, -- Worker identifier currently holding the execution lease
  lock_expires_at TEXT, -- ISO timestamp for worker lease expiration
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_provider_jobs_lookup ON provider_jobs (series_id, episode_number, shot_id, status);
CREATE INDEX IF NOT EXISTS idx_provider_jobs_spec ON provider_jobs (spec_hash, status);
CREATE INDEX IF NOT EXISTS idx_provider_remote_id ON provider_jobs (provider, provider_job_id);

-- Durable budget configuration per series
CREATE TABLE IF NOT EXISTS series_budgets (
  series_id TEXT PRIMARY KEY,
  max_budget_usd REAL NOT NULL DEFAULT 25.0,
  warning_threshold_ratio REAL NOT NULL DEFAULT 0.85,
  is_hard_capped INTEGER NOT NULL DEFAULT 1,
  notes TEXT,
  updated_at TEXT NOT NULL
);

-- Configurable Rate Cards with effective date & official doc source (replaces hard-coded rates)
CREATE TABLE IF NOT EXISTS provider_rate_cards (
  id TEXT PRIMARY KEY, -- e.g. "rate_kling_v2_20260901"
  provider TEXT NOT NULL,
  model_name TEXT NOT NULL,
  rate_per_sec_usd REAL NOT NULL,
  rate_per_unit_usd REAL,
  unit_type TEXT NOT NULL DEFAULT 'second', -- 'second', 'token', 'request', 'megapixel'
  currency TEXT NOT NULL DEFAULT 'USD',
  effective_date TEXT NOT NULL, -- Date pricing was verified against official docs
  source_doc_url TEXT, -- Link to official documentation
  notes TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_rate_cards_lookup ON provider_rate_cards (provider, model_name, effective_date);

