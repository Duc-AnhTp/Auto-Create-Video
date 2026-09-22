import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { ProductionRequestSchema, type ProductionRequest, type StudioJob, type JobStatus } from "./studio-contract.js";

/** Durable single-machine queue. SQLite transactions also serialize multiple workers. */
export class JobStore {
  private db: DatabaseSync;
  constructor(path: string) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS studio_jobs (
        id TEXT PRIMARY KEY, series_id TEXT NOT NULL, episode INTEGER NOT NULL,
        status TEXT NOT NULL, control TEXT NOT NULL, payload TEXT NOT NULL,
        owner TEXT, lease_until INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS studio_events (id INTEGER PRIMARY KEY AUTOINCREMENT, job_id TEXT NOT NULL, payload TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS studio_drafts (series_id TEXT NOT NULL, episode INTEGER NOT NULL, version INTEGER NOT NULL, text TEXT NOT NULL,
        PRIMARY KEY(series_id,episode,version));
      PRAGMA user_version=1;`);
  }
  close() { this.db.close(); }
  private transaction<T>(fn: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try { const result = fn(); this.db.exec("COMMIT"); return result; }
    catch (error) { this.db.exec("ROLLBACK"); throw error; }
  }
  list(): StudioJob[] {
    return this.db.prepare("SELECT payload FROM studio_jobs ORDER BY rowid DESC LIMIT 200").all().map(r => JSON.parse(String(r.payload)));
  }
  get(id: string): StudioJob {
    const row = this.db.prepare("SELECT payload FROM studio_jobs WHERE id=?").get(id);
    if (!row) throw new Error("JOB_NOT_FOUND");
    return JSON.parse(String(row.payload));
  }
  private save(job: StudioJob) {
    job.updatedAt = new Date().toISOString();
    this.db.prepare("UPDATE studio_jobs SET status=?,control=?,payload=? WHERE id=?")
      .run(job.status, job.control, JSON.stringify(job), job.id);
    this.db.prepare("INSERT INTO studio_events(job_id,payload) VALUES(?,?)").run(job.id, JSON.stringify(job));
    return job;
  }
  enqueue(input: ProductionRequest): StudioJob {
    const request = ProductionRequestSchema.parse(input);
    if (request.mode === "mock") request.provider = "mock";
    return this.transaction(() => {
      const active = this.db.prepare("SELECT id FROM studio_jobs WHERE series_id=? AND episode=? AND status IN ('queued','running','paused','needs_review')").get(request.seriesId, request.episodeNumber);
      if (active) throw new Error("EPISODE_BUSY");
      const now = new Date().toISOString();
      const job: StudioJob = { id: randomUUID(), request, status: "queued", control: "run", progress: null, result: null, error: null, createdAt: now, updatedAt: now };
      this.db.prepare("INSERT INTO studio_jobs(id,series_id,episode,status,control,payload) VALUES(?,?,?,?,?,?)")
        .run(job.id, request.seriesId, request.episodeNumber, job.status, job.control, JSON.stringify(job));
      return this.save(job);
    });
  }
  claim(owner: string, now = Date.now()): StudioJob | null {
    return this.transaction(() => {
      // Reclaim abandoned workers only after their lease has expired. Resume preserves provider IDs.
      const stale = this.db.prepare("SELECT id FROM studio_jobs WHERE owner IS NOT NULL AND lease_until < ?").all(now);
      for (const row of stale) {
        const job = this.get(String(row.id));
        if (["running", "paused"].includes(job.status)) {
          job.status = job.control === "cancel" ? "cancelled" : job.control === "pause" ? "paused" : "queued";
          job.request.resume = true;
          this.save(job);
        }
        this.db.prepare("UPDATE studio_jobs SET owner=NULL,lease_until=0 WHERE id=?").run(job.id);
      }
      const row = this.db.prepare("SELECT id FROM studio_jobs WHERE status='queued' AND owner IS NULL ORDER BY rowid LIMIT 1").get();
      if (!row) return null;
      const job = this.get(String(row.id));
      job.status = "running";
      this.db.prepare("UPDATE studio_jobs SET owner=?,lease_until=? WHERE id=?").run(owner, now + 30_000, job.id);
      return this.save(job);
    });
  }
  heartbeat(id: string, owner: string): boolean {
    return this.db.prepare("UPDATE studio_jobs SET lease_until=? WHERE id=? AND owner=?").run(Date.now() + 30_000, id, owner).changes === 1;
  }
  update(id: string, owner: string, patch: Partial<Pick<StudioJob, "progress" | "result" | "error">>, terminal?: JobStatus) {
    return this.transaction(() => {
      const row = this.db.prepare("SELECT owner FROM studio_jobs WHERE id=?").get(id);
      if (row?.owner !== owner) throw new Error("WORKER_LEASE_LOST");
      const job = Object.assign(this.get(id), patch);
      if (terminal) {
        job.status = terminal;
        this.db.prepare("UPDATE studio_jobs SET owner=NULL,lease_until=0 WHERE id=?").run(id);
      }
      return this.save(job);
    });
  }
  control(id: string, action: "pause" | "resume" | "cancel" | "retry") {
    return this.transaction(() => {
      const job = this.get(id);
      const owned = Boolean(this.db.prepare("SELECT owner FROM studio_jobs WHERE id=?").get(id)?.owner);
      if (action === "pause" && ["queued", "running"].includes(job.status)) { job.control = "pause"; job.status = "paused"; }
      else if (action === "resume" && job.status === "paused") { job.control = "run"; job.status = owned ? "running" : "queued"; }
      else if (action === "cancel" && ["queued", "running", "paused", "needs_review"].includes(job.status)) { job.control = "cancel"; if (!owned) job.status = "cancelled"; }
      else if (action === "retry" && ["failed", "needs_review", "cancelled"].includes(job.status) && !owned) {
        const active = this.db.prepare("SELECT id FROM studio_jobs WHERE series_id=? AND episode=? AND id!=? AND status IN ('queued','running','paused','needs_review')").get(job.request.seriesId, job.request.episodeNumber, id);
        if (active) throw new Error("EPISODE_BUSY");
        job.control = "run"; job.status = "queued"; job.error = null; job.request.resume = true;
      } else throw new Error("INVALID_JOB_TRANSITION");
      return this.save(job);
    });
  }
  events(after: number) {
    return this.db.prepare("SELECT id,payload FROM studio_events WHERE id>? ORDER BY id LIMIT 500").all(after)
      .map(r => ({ id: Number(r.id), job: JSON.parse(String(r.payload)) as StudioJob }));
  }
  draft(seriesId: string, episode: number): { version: number; text: string } {
    const row = this.db.prepare("SELECT version,text FROM studio_drafts WHERE series_id=? AND episode=? ORDER BY version DESC LIMIT 1").get(seriesId, episode);
    return row ? { version: Number(row.version), text: String(row.text) } : { version: 0, text: "" };
  }
  saveDraft(seriesId: string, episode: number, baseVersion: number, text: string) {
    return this.transaction(() => {
      const previous = this.draft(seriesId, episode);
      if (previous.version !== baseVersion) throw new Error("DRAFT_CONFLICT");
      this.db.prepare("INSERT INTO studio_drafts VALUES(?,?,?,?)").run(seriesId, episode, baseVersion + 1, text);
      return this.draft(seriesId, episode);
    });
  }
}
