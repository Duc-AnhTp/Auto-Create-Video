import { backupProject, listBackups, restoreProject, projectUsage } from "./project-backup.js";
import { SourceRequest, ScreenplayRequest, EditShotRequest, importStory, generateDraft, editShot } from "./story-service.js";
import type { IncomingMessage, ServerResponse } from "node:http";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { JobStore } from "./job-store.js";
import { DraftSchema, ProductionRequestSchema, SeriesId } from "./studio-contract.js";
import { containedPath, HttpError, readJson } from "./http-safety.js";
import { BibleManager } from "../bible/bible-manager.js";
import { PROVIDER_CAPABILITY_REGISTRY } from "../gateway/provider-capabilities.js";
import { redact } from "../utils/redact.js";

export class StudioApi {
  readonly store: JobStore;
  private worker?: ChildProcess;
  private streams = new Set<ServerResponse>();
  private timers = new Set<ReturnType<typeof setInterval>>();
  private closing = false;
  private maintenance = new Set<string>();

  isUnderMaintenance(seriesId: string): boolean {
    return this.maintenance.has(seriesId);
  }
  constructor(private dbPath = resolve("data/studio-jobs.db"), private workersEnabled = true) {
    this.store = new JobStore(dbPath);
    if (workersEnabled) { const timer = setInterval(() => this.startWorker(), 3000); timer.unref(); this.timers.add(timer); }
  }
  startWorker() {
    if (!this.workersEnabled || this.closing || this.worker) return;
    const base = dirname(fileURLToPath(import.meta.url));
    const compiled = join(base, "production-worker.js");
    const args = existsSync(compiled) ? [compiled] : [resolve("node_modules/tsx/dist/cli.mjs"), join(base, "production-worker.ts")];
    this.worker = spawn(process.execPath, [...args, this.dbPath, String(process.pid)], { windowsHide: true, stdio: "ignore", env: process.env });
    this.worker.on("error", () => { this.worker = undefined; });
    this.worker.on("exit", () => { this.worker = undefined; });
  }
  async close() {
    this.closing = true;
    for (const timer of this.timers) clearInterval(timer);
    for (const stream of this.streams) stream.end();
    // Do not kill remote jobs: a graceful signal finishes the current operation; lease recovery resumes polling.
    this.worker?.kill("SIGTERM");
    this.store.close();
  }
  async handle(req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> {
    if (!url.pathname.startsWith("/api/v1/")) return false;
    const send = (value: unknown, status = 200) => { res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" }); res.end(JSON.stringify(value)); };
    try {
      if (url.pathname === "/api/v1/jobs" && req.method === "GET") { this.startWorker(); send({ jobs: this.store.list() }); }
      else if (url.pathname === "/api/v1/jobs" && req.method === "POST") {
        const input = ProductionRequestSchema.parse(await readJson(req));
        const root = resolve("data");
        containedPath(root, join(root, "series", input.seriesId));
        if (this.maintenance.has(input.seriesId)) throw new HttpError(409,"PROJECT_MAINTENANCE");
        const job = this.store.enqueue(input); this.startWorker(); send({ jobId: job.id, job }, 202);
      } else if (url.pathname === "/api/v1/events" && req.method === "GET") {
        let cursor = Number(req.headers["last-event-id"] || url.searchParams.get("after") || 0);
        if (!Number.isSafeInteger(cursor) || cursor < 0) throw new HttpError(400, "INVALID_CURSOR");
        res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
        res.write(`event: snapshot\ndata: ${JSON.stringify({ jobs: this.store.list() })}\n\n`);
        this.streams.add(res);
        const flush = () => {
          for (const event of this.store.events(cursor)) { res.write(`id: ${event.id}\nevent: job\ndata: ${JSON.stringify(event.job)}\n\n`); cursor = event.id; }
          res.write(": heartbeat\n\n");
        };
        flush();
        const timer = setInterval(flush, 1000); this.timers.add(timer);
        req.on("close", () => { clearInterval(timer); this.timers.delete(timer); this.streams.delete(res); });
      } else if (url.pathname === "/api/v1/providers" && req.method === "GET") send({ capabilities: PROVIDER_CAPABILITY_REGISTRY });
      else {
        const maintenance = url.pathname.match(/^\/api\/v1\/series\/([^/]+)\/(backups|restore|usage)$/);
        if (maintenance) {
          const id=SeriesId.parse(maintenance[1]);
          if (req.method === "GET") { send(maintenance[2] === "usage" ? await projectUsage(id) : await listBackups(id)); return true; }
          if (req.method !== "POST") throw new HttpError(405,"METHOD_NOT_ALLOWED");
          if (this.maintenance.has(id) || this.store.list().some(job => job.request.seriesId===id && ["queued","running","paused","needs_review"].includes(job.status))) throw new HttpError(409,"PROJECT_BUSY");
          this.maintenance.add(id);
          try {
            if (maintenance[2] === "backups") send(await backupProject(id));
            else if (maintenance[2] === "restore") {const body=z.object({id:z.string().uuid()}).strict().parse(await readJson(req));send(await restoreProject(id,body.id));}
            else throw new HttpError(405,"METHOD_NOT_ALLOWED");
          } finally {this.maintenance.delete(id);}
          return true;
        }
        const story = url.pathname.match(/^\/api\/v1\/series\/([^/]+)\/(source|screenplay)$/);
        const edit = url.pathname.match(/^\/api\/v1\/series\/([^/]+)\/episodes\/(\d+)\/edit-shot$/);
        if (story && req.method === "POST") {
          const id = SeriesId.parse(story[1]);
          if (this.maintenance.has(id)) throw new HttpError(409,"PROJECT_MAINTENANCE");
          containedPath(resolve("data"), resolve("data", "series", id));
          const body = await readJson(req);
          send(story[2] === "source" ? await importStory(id, SourceRequest.parse(body)) : await generateDraft(id, ScreenplayRequest.parse(body)));
          return true;
        }
        if (edit && req.method === "POST") {
          const id = SeriesId.parse(edit[1]), body = EditShotRequest.parse(await readJson(req));
          if (this.store.draft(id, Number(edit[2])).version !== body.baseVersion) throw new HttpError(409, "DRAFT_CONFLICT");
          send(await editShot(id, body)); return true;
        }
        const jobMatch = url.pathname.match(/^\/api\/v1\/jobs\/([a-f0-9-]+)(?:\/(pause|resume|cancel|retry))?$/);
        const draft = url.pathname.match(/^\/api\/v1\/series\/([^/]+)\/episodes\/(\d+)\/draft$/);
        const artifacts = url.pathname.match(/^\/api\/v1\/series\/([^/]+)\/episodes\/(\d+)\/artifacts$/);
        if (jobMatch && req.method === "GET" && !jobMatch[2]) send({ job: this.store.get(jobMatch[1]) });
        else if (jobMatch && req.method === "POST" && jobMatch[2]) { send({ job: this.store.control(jobMatch[1], jobMatch[2] as "pause" | "resume" | "cancel" | "retry") }); this.startWorker(); }
        else if (draft) {
          const id = SeriesId.parse(draft[1]), episode = z.number().int().positive().parse(Number(draft[2]));
          if (req.method === "GET") send(this.store.draft(id, episode));
          else if (req.method === "POST") { const body = DraftSchema.parse(await readJson(req)); send(this.store.saveDraft(id, episode, body.baseVersion, body.text)); }
          else throw new HttpError(405, "METHOD_NOT_ALLOWED");
        } else if (artifacts && req.method === "GET") {
          const id = SeriesId.parse(artifacts[1]);
          const episode = z.number().int().positive().parse(Number(artifacts[2]));
          const dir = resolve("output", "series", id, `ep-${String(episode).padStart(2, "0")}`);
          if (!existsSync(dir)) { send({ timeline: null, files: [] }); return true; }
          containedPath(resolve("output"), dir);
          const candidates = [join(dir, "timeline.json"), join(dir, "assembly", "timeline.json")];
          const timelinePath = candidates.find(existsSync);
          const files: string[] = [];
          const walk = (path: string, depth = 0) => {
            if (depth > 3) return;
            for (const item of readdirSync(path, { withFileTypes: true })) {
              if (item.isSymbolicLink()) continue;
              const file = join(path, item.name);
              if (item.isDirectory()) walk(file, depth + 1);
              else if (/\.(mp4|wav|mp3|srt|vtt|ass|xml|otio)$/i.test(item.name)) files.push(file);
            }
          };
          walk(dir);
          send({ timeline: timelinePath ? JSON.parse(readFileSync(containedPath(dir, timelinePath), "utf8")) : null, files });
        } else throw new HttpError(404, "ROUTE_NOT_FOUND");
      }
    } catch (error) {
      const message = redact(error instanceof Error ? error.message : String(error));
      const status = error instanceof HttpError ? error.status : error instanceof z.ZodError ? 400 : /CONFLICT|BUSY|TRANSITION/.test(message) ? 409 : message === "JOB_NOT_FOUND" ? 404 : 500;
      send({ error: { code: error instanceof HttpError ? error.code : status === 400 ? "INVALID_REQUEST" : message.split(":")[0], message } }, status);
    }
    return true;
  }
}
