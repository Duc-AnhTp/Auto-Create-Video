import {migrateQueue} from '../../../../platform/sqlite/queue-schema.js';
import { WorkflowError } from "../../../../platform/workflow-error.js";
import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { ProviderDispatchStore } from "./provider-dispatch-store.js";
import { resolveExecutionPolicy } from "../../domain/execution-policy.js";
import { ProductionRequestSchema, StoryImportRequestSchema, type StoryImportJob, type StudioJob, type JobStatus } from "../../../../contracts/requests.js";

/** Durable single-machine queue. SQLite transactions also serialize multiple workers. */
export class JobStore {
  private db: DatabaseSync;
  private isClosed = false;
  private eventRetention: number;
  private claimedVersions=new Map<string,number>();
  constructor(path: string, options: { eventRetention?: number } = {}) {
    this.eventRetention = Math.max(1, Math.floor(options.eventRetention ?? 10_000));
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    try { migrateQueue(this.db, path); } catch (error) { this.db.close(); throw error; }
    const eventScrub = this.db.prepare("SELECT value FROM studio_meta WHERE key='event_payloads_redacted_v1'").get();
    if (!eventScrub) {
      this.db.exec(`UPDATE studio_events SET payload=json_set(payload, '$.request.rawScreenplay', '')
        WHERE CASE WHEN json_valid(payload) THEN
          json_type(payload, '$.request.rawScreenplay')='text' AND json_extract(payload, '$.request.rawScreenplay')<>''
        ELSE 0 END;`);
      this.db.prepare("INSERT INTO studio_meta(key,value) VALUES('event_payloads_redacted_v1','1')").run();
    }
    const maxEventId = Number(this.db.prepare("SELECT COALESCE(MAX(id),0) AS id FROM studio_events").get()?.id ?? 0);
    if (maxEventId > this.eventRetention) {
      this.db.prepare("DELETE FROM studio_events WHERE id <= ?").run(maxEventId - this.eventRetention);
    }
  }
  close() {
    if (this.isClosed) return;
    this.isClosed = true;
    try { this.db.close(); } catch {}
  }
  metrics(){
    const statuses=Object.fromEntries(this.db.prepare("SELECT status,COUNT(*) AS count FROM studio_jobs GROUP BY status").all().map(row=>[String(row.status),Number(row.count)]));
    const counters:Record<string,number>={};let measuredJobs=0;
    for(const row of this.db.prepare("SELECT json_extract(payload,'$.metrics') AS metrics FROM studio_jobs WHERE json_type(payload,'$.metrics')='object'").all()){
      const metrics=JSON.parse(String(row.metrics)) as NonNullable<StudioJob["metrics"]>;measuredJobs++;
      for(const [key,value] of Object.entries(metrics.counters))counters[key]=(counters[key]??0)+value;
    }
    return {statuses,measuredJobs,counters};
  }
  invalidateCompleted(id:string):StudioJob {return this.transaction(()=>{const job=this.get(id);if(job.status!=="succeeded")return job;job.status="needs_review";job.error={code:"DELIVERY_REVIEW_REQUIRED",message:"Artifact đã hoàn tất không còn hợp lệ; cần kiểm tra trước khi sử dụng lại."};return this.save(job);});}
  private transaction<T>(fn: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try { const result = fn(); this.db.exec("COMMIT"); return result; }
    catch (error) { this.db.exec("ROLLBACK"); throw error; }
  }
  assertSeriesAvailable(seriesId:string):void {if(this.db.prepare('SELECT token FROM series_maintenance WHERE series_id=?').get(seriesId))throw new WorkflowError('PROJECT_BUSY','PROJECT_BUSY','failed');}
  list(): StudioJob[] {
    return this.db.prepare("SELECT json_set(payload, '$.request.rawScreenplay', '') AS payload FROM studio_jobs ORDER BY rowid DESC LIMIT 200")
      .all().map(r => JSON.parse(String(r.payload)) as StudioJob);
  }
  summary<T extends StudioJob>(job: T): T {
    return { ...job, request: { ...job.request, rawScreenplay: "" } };
  }
  get(id: string): StudioJob {
    const row = this.db.prepare("SELECT payload FROM studio_jobs WHERE id=?").get(id);
    if (!row) throw new WorkflowError("JOB_NOT_FOUND", "JOB_NOT_FOUND", "failed");
    return JSON.parse(String(row.payload));
  }
  getSummary(id: string): StudioJob {
    const row = this.db.prepare("SELECT json_set(payload, '$.request.rawScreenplay', '') AS payload FROM studio_jobs WHERE id=?").get(id);
    if (!row) throw new WorkflowError("JOB_NOT_FOUND", "JOB_NOT_FOUND", "failed");
    return JSON.parse(String(row.payload));
  }
  private save(job: StudioJob) {
    job.updatedAt = new Date().toISOString();
    this.db.prepare("UPDATE studio_jobs SET status=?,control=?,payload=? WHERE id=?")
      .run(job.status, job.control, JSON.stringify(job), job.id);
    const eventJob = this.summary(job);
    const event = this.db.prepare("INSERT INTO studio_events(job_id,payload) VALUES(?,?)").run(job.id, JSON.stringify(eventJob));
    const eventId = Number(event.lastInsertRowid);
    if (eventId % 128 === 0) {
      this.db.prepare("DELETE FROM studio_events WHERE id <= ?").run(eventId - this.eventRetention);
    }
    return job;
  }
  private assertNoSeriesLockConflict(seriesId: string, episodeNumber: number, kind: "episode" | "season" | "postprocess", excludeJobId?: string): void {
    if (this.db.prepare("SELECT id FROM studio_story_imports WHERE series_id=? AND status IN ('queued','running')").get(seriesId)) {
      throw new WorkflowError("SERIES_BUSY", "SERIES_BUSY", "failed");
    }
    const active = this.db.prepare(
      "SELECT id FROM studio_jobs WHERE series_id=? AND episode=? AND id!=coalesce(?, '') AND status IN ('queued','running','paused','needs_review')"
    ).get(seriesId, episodeNumber, excludeJobId ?? "");
    if (active) throw new WorkflowError("EPISODE_BUSY", "EPISODE_BUSY", "failed");

    const siblings = this.db.prepare(
      "SELECT payload FROM studio_jobs WHERE series_id=? AND id!=coalesce(?, '') AND status IN ('queued','running','paused','needs_review')"
    ).all(seriesId, excludeJobId ?? "");
    if (siblings.some(row => kind === "season" || (JSON.parse(String(row.payload)) as StudioJob).request.kind === "season")) {
      throw new WorkflowError("SERIES_BUSY", "SERIES_BUSY", "failed");
    }
  }
  enqueue(input: unknown): StudioJob {
    const request = ProductionRequestSchema.parse(input);
    if (request.kind !== "postprocess") request.provider = resolveExecutionPolicy(request.mode,request.provider).provider as typeof request.provider;
    const fingerprint=request.kind === "postprocess" ? createHash("sha256").update(JSON.stringify(request)).digest("hex") : "";
    return this.transaction(() => {
      this.assertSeriesAvailable(request.seriesId);
      if(fingerprint){const old=this.db.prepare("SELECT payload FROM studio_jobs WHERE fingerprint=? AND status IN ('queued','running','paused','succeeded') ORDER BY rowid DESC LIMIT 1").get(fingerprint);if(old)return JSON.parse(String(old.payload)) as StudioJob;}
      this.assertNoSeriesLockConflict(request.seriesId, request.episodeNumber, request.kind);
      const now = new Date().toISOString();
      const job: StudioJob = { id: randomUUID(), request, status: "queued", control: "run", progress: null, result: null, error: null, createdAt: now, updatedAt: now };
      this.db.prepare("INSERT INTO studio_jobs(id,series_id,episode,status,control,payload,fingerprint) VALUES(?,?,?,?,?,?,?)")
        .run(job.id, request.seriesId, request.episodeNumber, job.status, job.control, JSON.stringify(job),fingerprint);
      return this.save(job);
    });
  }
  enqueueStoryImport(input: import("zod").z.input<typeof StoryImportRequestSchema>): StoryImportJob {
    const request = StoryImportRequestSchema.parse(input);
    return this.transaction(() => {
      this.assertSeriesAvailable(request.seriesId);
      const activeProduction = this.db.prepare(
        "SELECT id FROM studio_jobs WHERE series_id=? AND status IN ('queued','running','paused','needs_review')"
      ).get(request.seriesId);
      if (activeProduction) throw new WorkflowError("SERIES_BUSY", "SERIES_BUSY", "failed");
      const activeImport = this.db.prepare(
        "SELECT id FROM studio_story_imports WHERE series_id=? AND status IN ('queued','running')"
      ).get(request.seriesId);
      if (activeImport) throw new WorkflowError("SERIES_BUSY", "SERIES_BUSY", "failed");
      const now = new Date().toISOString();
      const job: StoryImportJob = {
        id: randomUUID(), request, status: "queued", result: null, error: null, createdAt: now, updatedAt: now,
      };
      this.db.prepare("INSERT INTO studio_story_imports(id,series_id,status,payload) VALUES(?,?,?,?)")
        .run(job.id, request.seriesId, job.status, JSON.stringify(job));
      return job;
    });
  }
  getStoryImport(id: string): StoryImportJob {
    const row = this.db.prepare("SELECT payload FROM studio_story_imports WHERE id=?").get(id);
    if (!row) throw new WorkflowError("STORY_IMPORT_NOT_FOUND", "STORY_IMPORT_NOT_FOUND", "failed");
    return JSON.parse(String(row.payload));
  }
  getStoryImportSummary(id: string): StoryImportJob {
    const row = this.db.prepare("SELECT json_set(payload, '$.request.text', '') AS payload FROM studio_story_imports WHERE id=?").get(id);
    if (!row) throw new WorkflowError("STORY_IMPORT_NOT_FOUND", "STORY_IMPORT_NOT_FOUND", "failed");
    return JSON.parse(String(row.payload));
  }
  hasActiveStoryImport(seriesId: string): boolean {
    return Boolean(this.db.prepare("SELECT id FROM studio_story_imports WHERE series_id=? AND status IN ('queued','running') LIMIT 1").get(seriesId));
  }
  storyImportSummary(job: StoryImportJob): StoryImportJob {
    return { ...job, request: { ...job.request, text: "" } };
  }
  claimStoryImport(owner: string, now = Date.now()): StoryImportJob | null {
    return this.transaction(() => {
      const stale = this.db.prepare("SELECT id FROM studio_story_imports WHERE owner IS NOT NULL AND lease_until < ?").all(now);
      for (const row of stale) {
        const job = this.getStoryImport(String(row.id));
        if (job.status === "running") {
          job.status = "queued";
          job.updatedAt = new Date().toISOString();
          this.db.prepare("UPDATE studio_story_imports SET status='queued',payload=? WHERE id=?").run(JSON.stringify(job), job.id);
        }
        this.db.prepare("UPDATE studio_story_imports SET owner=NULL,lease_until=0 WHERE id=?").run(job.id);
      }
      const row = this.db.prepare("SELECT id,lease_version FROM studio_story_imports WHERE status='queued' AND owner IS NULL AND NOT EXISTS (SELECT 1 FROM series_maintenance m WHERE m.series_id=studio_story_imports.series_id) ORDER BY rowid LIMIT 1").get();
      if (!row) return null;
      const job = this.getStoryImport(String(row.id));
      job.status = "running";
      job.updatedAt = new Date().toISOString();
      const version=Number(row.lease_version)+1;this.claimedVersions.set(job.id,version);
      this.db.prepare("UPDATE studio_story_imports SET status='running',owner=?,lease_until=?,payload=?,lease_version=? WHERE id=?")
        .run(owner, now + 30_000, JSON.stringify(job),version, job.id);
      return job;
    });
  }
  heartbeatStoryImport(id: string, owner: string): boolean {
    return this.db.prepare("UPDATE studio_story_imports SET lease_until=? WHERE id=? AND owner=? AND lease_version=? AND lease_until>?")
      .run(Date.now() + 30_000, id, owner,this.claimedVersions.get(id)??-1,Date.now()).changes === 1;
  }
  isStoryImportOwner(id:string,owner:string):boolean {const row=this.db.prepare("SELECT owner,lease_version,lease_until FROM studio_story_imports WHERE id=?").get(id);return row?.owner===owner&&Number(row.lease_version)===this.claimedVersions.get(id)&&Number(row.lease_until)>Date.now();}
  finishStoryImport(id: string, owner: string, result: Record<string, unknown>): StoryImportJob {
    return this.updateStoryImport(id, owner, "succeeded", result, null);
  }
  failStoryImport(id: string, owner: string, error: { code: string; message: string }): StoryImportJob {
    return this.updateStoryImport(id, owner, "failed", null, error);
  }
  private updateStoryImport(
    id: string,
    owner: string,
    status: "succeeded" | "failed",
    result: Record<string, unknown> | null,
    error: { code: string; message: string } | null,
  ): StoryImportJob {
    return this.transaction(() => {
      const row = this.db.prepare("SELECT owner,lease_version,lease_until FROM studio_story_imports WHERE id=?").get(id);
      if (row?.owner !== owner || Number(row.lease_version)!==this.claimedVersions.get(id) || Number(row.lease_until)<=Date.now()) throw new WorkflowError("WORKER_LEASE_LOST", "WORKER_LEASE_LOST", "lease_lost");
      const job = this.getStoryImport(id);
      job.status = status;
      job.result = result;
      job.error = error;
      job.request.text = "";
      job.updatedAt = new Date().toISOString();
      this.db.prepare("UPDATE studio_story_imports SET status=?,payload=?,owner=NULL,lease_until=0 WHERE id=?")
        .run(status, JSON.stringify(job), id);
      return job;
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
      const row = this.db.prepare("SELECT id,lease_version FROM studio_jobs AS candidate WHERE status='queued' AND owner IS NULL AND NOT EXISTS (SELECT 1 FROM series_maintenance m WHERE m.series_id=candidate.series_id) AND NOT EXISTS (SELECT 1 FROM studio_jobs AS live WHERE live.series_id=candidate.series_id AND live.owner IS NOT NULL AND live.lease_until>strftime('%s','now')*1000) AND NOT EXISTS (SELECT 1 FROM studio_jobs AS dependency WHERE dependency.series_id=candidate.series_id AND dependency.episode<candidate.episode AND json_extract(dependency.payload,'$.request.kind')='episode' AND json_extract(candidate.payload,'$.request.kind')='episode' AND dependency.rowid=(SELECT MAX(latest.rowid) FROM studio_jobs AS latest WHERE latest.series_id=dependency.series_id AND latest.episode=dependency.episode AND json_extract(latest.payload,'$.request.kind')='episode') AND (dependency.status IN ('queued','running','paused','needs_review') OR json_extract(candidate.payload,'$.request.mode')='production' AND json_extract(dependency.payload,'$.request.mode')='production' AND dependency.status IN ('failed','cancelled'))) ORDER BY rowid LIMIT 1").get();
      if (!row) return null;
      const job = this.get(String(row.id));
      job.status = "running";
      job.leaseVersion=Number(row.lease_version)+1;this.claimedVersions.set(job.id,job.leaseVersion);
      this.db.prepare("UPDATE studio_jobs SET owner=?,lease_until=?,lease_version=? WHERE id=?").run(owner, now + 30_000,job.leaseVersion, job.id);
      return this.save(job);
    });
  }
  publishOwned(id:string,owner:string,version:number,work:()=>void):void {this.transaction(()=>{if(!this.isOwner(id,owner,version))throw new WorkflowError("WORKER_LEASE_LOST", "WORKER_LEASE_LOST", "lease_lost");work();});}
  isOwner(id:string,owner:string,version=this.claimedVersions.get(id)):boolean {
    const row=this.db.prepare("SELECT owner,lease_version,lease_until FROM studio_jobs WHERE id=?").get(id);
    return row?.owner===owner&&version!==undefined&&Number(row.lease_version)===version&&Number(row.lease_until)>Date.now();
  }
  heartbeat(id:string,owner:string,version=this.claimedVersions.get(id)):boolean {
    if(version===undefined)return false;const now=Date.now();
    return Number(this.db.prepare("UPDATE studio_jobs SET lease_until=? WHERE id=? AND owner=? AND lease_version=? AND lease_until>?").run(now+30_000,id,owner,version,now).changes)===1;
  }
  update(id: string, owner: string, patch: Partial<Pick<StudioJob, "progress" | "result" | "error" | "metrics">>, terminal?: JobStatus,version=this.claimedVersions.get(id)) {
    return this.transaction(() => {
      const row = this.db.prepare("SELECT owner,lease_version,lease_until FROM studio_jobs WHERE id=?").get(id);
      if (row?.owner !== owner || version===undefined || Number(row.lease_version)!==version || Number(row.lease_until)<=Date.now()) throw new WorkflowError("WORKER_LEASE_LOST", "WORKER_LEASE_LOST", "lease_lost");
      const job = Object.assign(this.get(id), patch);
      if (terminal) {
        job.status = terminal;
        this.db.prepare("UPDATE studio_jobs SET owner=NULL,lease_until=0 WHERE id=?").run(id);
      }
      return this.save(job);
    });
  }
  control(id: string, action: "pause" | "resume" | "cancel" | "retry" | "regenerate-audio") {
    return this.transaction(() => {
      const job = this.get(id);
      this.assertSeriesAvailable(job.request.seriesId);
      const owned = Boolean(this.db.prepare("SELECT owner FROM studio_jobs WHERE id=?").get(id)?.owner);
      if (action === "pause" && ["queued", "running"].includes(job.status)) { job.control = "pause"; job.status = "paused"; }
      else if (action === "resume" && job.status === "paused") { job.control = "run"; job.status = owned ? "running" : "queued"; }
      else if (action === "cancel" && ["queued", "running", "paused", "needs_review"].includes(job.status)) { job.control = "cancel"; if (!owned) job.status = "cancelled"; }
      else if (["retry","regenerate-audio"].includes(action) && ["failed", "needs_review", "cancelled"].includes(job.status) && !owned) {
        if(action==='regenerate-audio'){if(job.request.kind!=='episode')throw new WorkflowError('INVALID_JOB_TRANSITION','INVALID_JOB_TRANSITION','failed');job.request.regenerateAudio=true;}
        this.assertNoSeriesLockConflict(job.request.seriesId, job.request.episodeNumber, job.request.kind, id);
        job.control = "run"; job.status = "queued"; job.error = null; job.request.resume = true;
      } else throw new WorkflowError("INVALID_JOB_TRANSITION", "INVALID_JOB_TRANSITION", "failed");
      return this.save(job);
    });
  }
  events(after: number) {
    return this.db.prepare("SELECT id,payload FROM studio_events WHERE id>? ORDER BY id LIMIT 500").all(after)
      .map(r => ({ id: Number(r.id), job: this.summary(JSON.parse(String(r.payload)) as StudioJob) }));
  }
  draft(seriesId: string, episode: number): { version: number; text: string } {
    const row = this.db.prepare("SELECT version,text FROM studio_drafts WHERE series_id=? AND episode=? ORDER BY version DESC LIMIT 1").get(seriesId, episode);
    return row ? { version: Number(row.version), text: String(row.text) } : { version: 0, text: "" };
  }
  saveDraft(seriesId: string, episode: number, baseVersion: number, text: string) {
    return this.transaction(() => {
      const previous = this.draft(seriesId, episode);
      if (previous.version !== baseVersion) throw new WorkflowError("DRAFT_CONFLICT", "DRAFT_CONFLICT", "failed");
      this.db.prepare("INSERT INTO studio_drafts VALUES(?,?,?,?)").run(seriesId, episode, baseVersion + 1, text);
      return this.draft(seriesId, episode);
    });
  }
}
