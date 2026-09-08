-- Story Bible SQLite Schema for Episodic AI Cinema
-- Ensures narrative, visual, and audio consistency across long-form series.

CREATE TABLE IF NOT EXISTS characters (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  role TEXT NOT NULL, -- protagonist, antagonist, supporting
  visual_summary TEXT NOT NULL, -- persistent physical appearance description
  personality_traits TEXT NOT NULL, -- JSON array of personality traits & speech quirks
  voice_profile_id TEXT, -- identifier for voice cloning profile
  voice_embedding_path TEXT, -- path to local voice embedding file (.pt or .json)
  status TEXT NOT NULL DEFAULT 'alive' -- alive, injured, deceased, missing
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
