import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { WorkflowError } from "../workflow-error.js";

export function migrateQueue(db: DatabaseSync, path: string): void {
  db.exec("PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000");
  const version = Number(db.prepare("PRAGMA user_version").get()?.user_version ?? 0);
  if (version > 3) throw new WorkflowError("QUEUE_SCHEMA_VERSION_UNSUPPORTED", "QUEUE_SCHEMA_VERSION_UNSUPPORTED", "failed");
  if(version===3 && db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='idx_tts_series_state'").get())return; // Do not scan the entire queue on every TTS attempt.
  if (Object.values(db.prepare("PRAGMA integrity_check").get() ?? {})[0] !== "ok") throw new Error("QUEUE_DATABASE_INVALID");
  if (path !== ":memory:" && db.prepare("SELECT name FROM sqlite_master WHERE type='table' LIMIT 1").get()) {
    db.exec("VACUUM INTO '" + (path + ".pre-v3-" + randomUUID() + ".bak").replace(/'/g,"''") + "'");
  }
  db.exec("BEGIN IMMEDIATE");
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS studio_jobs(id TEXT PRIMARY KEY,series_id TEXT NOT NULL,episode INTEGER NOT NULL,status TEXT NOT NULL,control TEXT NOT NULL,payload TEXT NOT NULL,owner TEXT,lease_until INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS studio_story_imports(id TEXT PRIMARY KEY,series_id TEXT NOT NULL,status TEXT NOT NULL,payload TEXT NOT NULL,owner TEXT,lease_until INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS studio_events(id INTEGER PRIMARY KEY AUTOINCREMENT,job_id TEXT NOT NULL,payload TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS studio_drafts(series_id TEXT NOT NULL,episode INTEGER NOT NULL,version INTEGER NOT NULL,text TEXT NOT NULL,PRIMARY KEY(series_id,episode,version));
      CREATE TABLE IF NOT EXISTS studio_meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS provider_dispatches(id TEXT PRIMARY KEY,series_id TEXT NOT NULL,provider TEXT NOT NULL,account TEXT NOT NULL,state TEXT NOT NULL,remote_id TEXT,slot_held INTEGER NOT NULL DEFAULT 0,payload TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS provider_limit_config(provider TEXT NOT NULL,account TEXT NOT NULL,max_jobs INTEGER NOT NULL,max_rpm INTEGER NOT NULL,PRIMARY KEY(provider,account));
      CREATE TABLE IF NOT EXISTS provider_requests(id INTEGER PRIMARY KEY AUTOINCREMENT,provider TEXT NOT NULL,account TEXT NOT NULL,created_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS provider_request_waiters(id TEXT PRIMARY KEY,provider TEXT NOT NULL,account TEXT NOT NULL,kind TEXT NOT NULL,updated_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS provider_webhook_inbox(provider TEXT NOT NULL,remote_id TEXT NOT NULL,payload TEXT NOT NULL,received_at INTEGER NOT NULL,PRIMARY KEY(provider,remote_id));
      CREATE TABLE IF NOT EXISTS studio_resource_locks(id TEXT PRIMARY KEY,resource TEXT NOT NULL,lease_until INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS series_maintenance(series_id TEXT PRIMARY KEY,token TEXT NOT NULL,pid INTEGER NOT NULL,created_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS series_sessions(id TEXT PRIMARY KEY,series_id TEXT NOT NULL,pid INTEGER NOT NULL,created_at INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS idx_series_sessions ON series_sessions(series_id);
      CREATE INDEX IF NOT EXISTS idx_jobs_series_status ON studio_jobs(series_id,status);
      CREATE INDEX IF NOT EXISTS idx_import_series_status ON studio_story_imports(series_id,status);
      CREATE INDEX IF NOT EXISTS idx_dispatch_remote ON provider_dispatches(provider,remote_id);
      CREATE INDEX IF NOT EXISTS idx_dispatch_series_state ON provider_dispatches(series_id,state);
      CREATE INDEX IF NOT EXISTS idx_dispatch_active ON provider_dispatches(provider,account,slot_held);
      CREATE INDEX IF NOT EXISTS idx_request_window ON provider_requests(provider,account,created_at);
      CREATE TABLE IF NOT EXISTS tts_attempts(id TEXT PRIMARY KEY,state TEXT NOT NULL,payload TEXT NOT NULL,updated_at INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS idx_tts_attempt_state ON tts_attempts(state,updated_at);
      CREATE INDEX IF NOT EXISTS idx_tts_series_state ON tts_attempts(json_extract(payload,'$.seriesId'),state,updated_at);
      CREATE TABLE IF NOT EXISTS provider_invoice_events(id TEXT PRIMARY KEY,provider TEXT NOT NULL,remote_id TEXT NOT NULL,payload TEXT NOT NULL,applied INTEGER NOT NULL DEFAULT 0,received_at INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS idx_invoice_cursor ON provider_invoice_events(applied,id);
      CREATE INDEX IF NOT EXISTS idx_invoice_pending ON provider_invoice_events(applied,received_at);
    `);
    for (const table of ["studio_jobs", "studio_story_imports"]) if (!db.prepare(`PRAGMA table_info(${table})`).all().some(row=>row.name === "lease_version")) db.exec(`ALTER TABLE ${table} ADD COLUMN lease_version INTEGER NOT NULL DEFAULT 0`);
    if (!db.prepare("PRAGMA table_info(studio_jobs)").all().some(row=>row.name === "fingerprint")) db.exec("ALTER TABLE studio_jobs ADD COLUMN fingerprint TEXT NOT NULL DEFAULT ''");
    db.exec("PRAGMA user_version=3; COMMIT");
  } catch (error) { db.exec("ROLLBACK"); throw error; }
}
