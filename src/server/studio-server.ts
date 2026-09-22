import { createServer, type Server, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile, writeFile, readdir, mkdir, stat } from "node:fs/promises";
import { createReadStream, existsSync } from "node:fs";
import { join, resolve, normalize, extname, basename, relative, isAbsolute, dirname } from "node:path";
import { exec } from "node:child_process";
import { BibleManager } from "../bible/bible-manager.js";
import { StoryToScreenplayGenerator } from "../series/story-to-screenplay.js";
import { ConceptArtGenerator } from "../series/concept-art-generator.js";
import { EpisodicPipeline, type EpisodicPipelineOptions } from "../series/episodic-pipeline.js";
import { parseRawScreenplay, normalizeScript } from "../series/script-normalizer.js";
import {
  parseNleTimeline,
  parseFcp7Xml,
  parseOtioJson,
  compareWithTimeline,
  applyNleEditsToBible,
  applyNleEditsToTimeline,
} from "../assembly/nle-ingest-parser.js";
import type { UnifiedTimeline, TimelineVideoShot } from "../series/timeline-schema.js";
import { log } from "../utils/logger.js";
import { StudioApi } from "./studio-api.js";
import { checkRequestOrigin, containedPath, HttpError, readJson } from "./http-safety.js";
import { SeriesId } from "./studio-contract.js";
import { ZodError } from "zod";
import { redact } from "../utils/redact.js";
import { SettingsManager } from "./settings-manager.js";
import { renderStudioHtml } from "./studio-ui.js";

export interface StudioServerOptions {
  port?: number;
  host?: string;
  autoOpen?: boolean;
  queuePath?: string;
  settingsPath?: string;
  workersEnabled?: boolean;
}

export class StudioServer {
  private server: Server | null = null;
  private port: number;
  private host: string;
  private sseClients: Map<string, Set<ServerResponse>> = new Map();
  private settingsManager: SettingsManager;
  private api: StudioApi;

  constructor(options: StudioServerOptions = {}) {
    this.port = options.port ?? 3456;
    this.host = options.host || "127.0.0.1";
    this.settingsManager = new SettingsManager(options.settingsPath);
    this.api = new StudioApi(options.queuePath ?? (process.env.NODE_ENV === "test" ? ":memory:" : resolve("data/studio-jobs.db")), options.workersEnabled ?? process.env.NODE_ENV !== "test");
  }

  public broadcastEvent(seriesId: string, episodeNumber: number, data: Record<string, any>): void {
    const key = `${seriesId}_${episodeNumber}`;
    const clients = this.sseClients.get(key);
    if (!clients || clients.size === 0) return;

    const payload = `data: ${JSON.stringify(data)}\n\n`;
    for (const res of clients) {
      try {
        res.write(payload);
      } catch {
        clients.delete(res);
      }
    }
  }

  public async start(): Promise<string> {
    return new Promise((resolvePromise, reject) => {
      this.server = createServer(async (req, res) => {
        try { checkRequestOrigin(req, this.host, this.port); }
        catch (error) { res.writeHead(error instanceof HttpError ? error.status : 403, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: error instanceof Error ? error.message : "Forbidden" })); return; }
        res.setHeader("X-Content-Type-Options", "nosniff");
        res.setHeader("Referrer-Policy", "no-referrer");
        if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }
        const url = new URL(req.url || "/", `http://${this.host}:${this.port}`);
        const pathname = url.pathname;

        try {
          const seriesPath = pathname.match(/^\/api\/(?:v1\/)?series\/([^/]+)\//);
          if (seriesPath) SeriesId.parse(decodeURIComponent(seriesPath[1]));
          if (await this.api.handle(req, res, url)) return;
          if (pathname === "/studio-next" || pathname.startsWith("/studio-assets/")) {
            const webRoot = resolve("dist/studio");
            const file = pathname === "/studio-next" ? join(webRoot, "index.html") : join(webRoot, pathname.slice(1));
            if (!existsSync(file)) throw new HttpError(404, "STUDIO_BUILD_REQUIRED", "Chạy npm run build:studio để mở Studio mới.");
            const safe = containedPath(webRoot, file);
            const type = extname(safe) === ".js" ? "text/javascript" : extname(safe) === ".css" ? "text/css" : "text/html; charset=utf-8";
            res.writeHead(200, { "Content-Type": type }); res.end(await readFile(safe)); return;
          }
          // 1. Health Check
          if (pathname === "/health") {
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ status: "ok", uptime: process.uptime(), timestamp: new Date().toISOString() }));
            return;
          }

          // 2. Web UI SPA (Home)
          if (pathname === "/" || pathname === "/studio" || pathname === "/studio-legacy") {
            res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
            res.end(renderStudioHtml());
            return;
          }

          // 3. Media Stream (Video / Audio / Image with Range Request)
          if (pathname === "/api/media/stream") {
            await this.handleMediaStream(req, res, url);
            return;
          }

          // 4. Server-Sent Events (SSE) for Episode Progress
          const sseMatch = pathname.match(/^\/api\/series\/([^/]+)\/episodes\/(\d+)\/events$/);
          if (sseMatch && req.method === "GET") {
            const seriesId = sseMatch[1];
            const epNum = parseInt(sseMatch[2], 10);
            this.handleSseConnection(req, res, seriesId, epNum);
            return;
          }

          // 5. REST APIs
          // Settings & Model Hub
          if (pathname === "/api/settings/models" && req.method === "GET") {
            const providers = this.settingsManager.getProviders();
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ success: true, providers }));
            return;
          }

          if (pathname === "/api/settings/models" && req.method === "POST") {
            const body = await this.parseJsonBody(req);
            if (body.updates && typeof body.updates === "object") {
              this.settingsManager.saveConfigUpdates(body.updates);
            }
            const providers = this.settingsManager.getProviders();
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ success: true, providers }));
            return;
          }

          if (pathname === "/api/settings/test-connection" && req.method === "POST") {
            const body = await this.parseJsonBody(req);
            const result = await this.settingsManager.probeProvider(body.providerId, body.credentials);
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify(result));
            return;
          }

          if (pathname === "/api/series/list" && req.method === "GET") {
            const list = await this.listAllSeries();
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ series: list }));
            return;
          }

          if (pathname === "/api/series/init" && req.method === "POST") {
            const body = await this.parseJsonBody(req);
            SeriesId.parse(body.id);
            const meta = {
              id: body.id,
              title: body.title || "Untitled Series",
              genre: body.genre || "Cinema Drama",
              visual_style: body.visual_style || "Cinematic 35mm, 8k photorealistic",
              aspect_ratio: body.aspect_ratio || "9:16",
              fps: Number(body.fps) || 30,
              created_at: new Date().toISOString(),
            };
            await this.withBible(`data/series/${body.id}/story_bible.db`, (bible) => {
              bible.upsertSeriesMetadata(meta);
            });
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ success: true, metadata: meta }));
            return;
          }

          const bibleMatch = pathname.match(/^\/api\/series\/([^/]+)\/bible$/);
          if (bibleMatch && req.method === "GET") {
            const seriesId = bibleMatch[1];
            const data = await this.getSeriesBibleData(seriesId);
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify(data));
            return;
          }

          const charMatch = pathname.match(/^\/api\/series\/([^/]+)\/characters$/);
          if (charMatch && req.method === "POST") {
            const seriesId = charMatch[1];
            const body = await this.parseJsonBody(req);
            const character = await this.withBible(`data/series/${seriesId}/story_bible.db`, (bible) => {
              bible.upsertCharacter({
                id: body.id,
                series_id: seriesId,
                name: body.name,
                role: body.role || "supporting",
                visual_summary: body.visual_summary,
                distinguishing_marks: body.distinguishing_marks,
                status: body.status || "alive",
                face_reference_image: body.face_reference_image,
                voice_profile_id: body.voice_profile_id || "lucylab:default",
              });
              return bible.getCharacter(body.id, seriesId);
            });
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ success: true, character }));
            return;
          }

          const locMatch = pathname.match(/^\/api\/series\/([^/]+)\/locations$/);
          if (locMatch && req.method === "POST") {
            const seriesId = locMatch[1];
            const body = await this.parseJsonBody(req);
            const location = await this.withBible(`data/series/${seriesId}/story_bible.db`, (bible) => {
              bible.upsertLocation({
                id: body.id,
                series_id: seriesId,
                name: body.name,
                visual_summary: body.visual_summary,
                lighting_mood: body.lighting_mood,
                atmospheric_rules: body.atmospheric_rules,
                reference_image_path: body.reference_image_path,
              });
              return bible.getLocation(body.id, seriesId);
            });
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ success: true, location }));
            return;
          }

          const propMatch = pathname.match(/^\/api\/series\/([^/]+)\/props$/);
          if (propMatch && req.method === "POST") {
            const seriesId = propMatch[1];
            const body = await this.parseJsonBody(req);
            const prop = await this.withBible(`data/series/${seriesId}/story_bible.db`, (bible) => {
              bible.upsertKeyProp({
                id: body.id,
                series_id: seriesId,
                name: body.name,
                current_holder_id: body.current_holder_id,
                description: body.description,
              });
              return bible.getKeyProp(body.id, seriesId);
            });
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ success: true, prop }));
            return;
          }

          // AI Generate Concept Art
          const genArtMatch = pathname.match(/^\/api\/series\/([^/]+)\/gen-art$/);
          if (genArtMatch && req.method === "POST") {
            const seriesId = genArtMatch[1];
            const body = await this.parseJsonBody(req);
            const allowMock = body.allowMock !== undefined ? Boolean(body.allowMock) : true;
            const result = await this.withBible(`data/series/${seriesId}/story_bible.db`, async (bible) => {
              const gen = new ConceptArtGenerator(bible);
              if (body.type === "location") {
                return await gen.generateLocationConceptArt({
                  seriesId,
                  locationId: body.id,
                  promptOverride: body.promptOverride,
                  provider: body.provider || "mock",
                  allowMock,
                });
              } else {
                return await gen.generateCharacterConceptArt({
                  seriesId,
                  characterId: body.id,
                  promptOverride: body.promptOverride,
                  provider: body.provider || "mock",
                  allowMock,
                });
              }
            });
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ success: true, result }));
            return;
          }

          // AI Generate Screenplay
          const genScriptMatch = pathname.match(/^\/api\/series\/([^/]+)\/script\/generate$/);
          if (genScriptMatch && req.method === "POST") {
            const seriesId = genScriptMatch[1];
            const body = await this.parseJsonBody(req);
            const result = await this.withBible(`data/series/${seriesId}/story_bible.db`, async (bible) => {
              const generator = new StoryToScreenplayGenerator(bible);
              return await generator.generateScreenplay({
                seriesId,
                prompt: body.prompt,
                storyText: body.storyText,
                episodeNumber: body.episodeNumber,
                targetScenes: body.targetScenes || 3,
                tone: body.tone,
                skipAudit: true,
              });
            });
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ success: true, result }));
            return;
          }

          // Save Screenplay
          const saveScriptMatch = pathname.match(/^\/api\/series\/([^/]+)\/script\/save$/);
          if (saveScriptMatch && req.method === "POST") {
            const seriesId = saveScriptMatch[1];
            const body = await this.parseJsonBody(req);
            const epNum = body.episodeNumber || 1;
            const scriptsDir = join("data", "series", seriesId, "scripts");
            await mkdir(scriptsDir, { recursive: true });
            const scriptPath = join(scriptsDir, `ep${String(epNum).padStart(2, "0")}.txt`);
            await writeFile(scriptPath, body.rawScreenplay, "utf8");

            const normalized = await this.withBible(`data/series/${seriesId}/story_bible.db`, async (bible) => {
              return await normalizeScript(body.rawScreenplay, bible, {
                seriesId,
                skipAudit: true,
              });
            });

            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ success: true, scriptPath, script: normalized }));
            return;
          }

          // Produce Episode
          const produceMatch = pathname.match(/^\/api\/series\/([^/]+)\/episodes\/produce$/);
          if (produceMatch && req.method === "POST") {
            const seriesId = produceMatch[1];
            const body = await this.parseJsonBody(req);
            const epNum = body.episodeNumber || 1;

            if (body.scriptPath) containedPath(resolve("data"), resolve(body.scriptPath));
            const pipeline = new EpisodicPipeline(`data/series/${seriesId}/story_bible.db`);

            // Start production in async worker
            const onProgressCallback = (step: number, totalSteps: number, message: string) => {
              this.broadcastEvent(seriesId, epNum, {
                type: "progress",
                step,
                totalSteps,
                message,
                timestamp: new Date().toISOString(),
              });
            };

            const runProduction = async () => {
              try {
                const scriptContent = body.rawScreenplay || body.scriptPath;
                const result = await pipeline.produceEpisode(scriptContent, {
                  seriesId,
                  dryRun: body.dryRun ?? false,
                  provider: body.provider || "mock",
                  skipAudit: body.skipAudit ?? false,
                  skipRender: body.skipRender ?? false,
                  budgetCapUsd: body.budgetCapUsd,
                  onProgress: onProgressCallback,
                });
                this.broadcastEvent(seriesId, epNum, {
                  type: "complete",
                  result,
                  timestamp: new Date().toISOString(),
                });
              } catch (err: any) {
                this.broadcastEvent(seriesId, epNum, {
                  type: "error",
                  error: redact(err.message),
                  timestamp: new Date().toISOString(),
                });
                throw err;
              } finally { pipeline.close(); }
            };

            // Non-blocking kickoff if async requested
            if (body.async) {
              void runProduction().catch((error) => log.error("Production failed", error));
              res.writeHead(202, { "Content-Type": "application/json" });
              res.end(JSON.stringify({ success: true, message: "Bắt đầu sản xuất tập phim", seriesId, episodeNumber: epNum }));
            } else {
              await runProduction();
              res.writeHead(200, { "Content-Type": "application/json" });
              res.end(JSON.stringify({ success: true, seriesId, episodeNumber: epNum }));
            }
            return;
          }

          // Two-Way NLE Round-Trip: Ingest Edited FCP7 XML / OTIO Timeline
          const nleIngestMatch = pathname.match(/^\/api\/series\/([^/]+)\/episodes\/(\d+)\/nle\/ingest$/);
          if (nleIngestMatch && req.method === "POST") {
            const seriesId = nleIngestMatch[1];
            const epNum = parseInt(nleIngestMatch[2], 10);
            const body = await this.parseJsonBody(req);

            let content = body.content || body.xmlContent || body.otioContent;
            const inputPath = body.filePath || body.xmlPath || body.otioPath;
            if (!content && inputPath) {
              const safePath = containedPath(process.cwd(), normalize(resolve(inputPath)));
              const projectRoot = normalize(resolve(process.cwd()));
              const isWin = process.platform === "win32";
              const normSafe = isWin ? safePath.toLowerCase() : safePath;
              const normRoot = isWin ? projectRoot.toLowerCase() : projectRoot;
              const rel = relative(normRoot, normSafe);
              if (rel.startsWith("..") || isAbsolute(rel)) {
                res.writeHead(403, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ error: "Access denied: filePath outside project boundary" }));
                return;
              }
              if (existsSync(safePath)) {
                content = await readFile(safePath, "utf-8");
              }
            }

            if (!content) {
              res.writeHead(400, { "Content-Type": "application/json" });
              res.end(JSON.stringify({ error: "Missing required 'content' (XML or OTIO string) or valid 'filePath'" }));
              return;
            }

            const ingested = parseNleTimeline(content, body.format);

            // Attempt to load original timeline from assembly output or construct baseline from Bible
            const epNumStr = String(epNum).padStart(2, "0");
            const candidatePaths = [
              join("output", "series", seriesId, `ep-${epNumStr}`, "assembly", "timeline.json"),
              join("output", "series", seriesId, `ep${epNum}`, "assembly", "timeline.json"),
              join("output", "series", seriesId, `ep-${epNumStr}`, "timeline.json"),
              join("data", "series", seriesId, "episodes", `ep${epNum}`, "assembly", "timeline.json"),
            ];
            const assemblyTimelinePath = candidatePaths.find((p) => existsSync(p)) || candidatePaths[0];
            let originalTimeline: UnifiedTimeline;

            if (existsSync(assemblyTimelinePath)) {
              const rawTl = await readFile(assemblyTimelinePath, "utf-8");
              originalTimeline = JSON.parse(rawTl) as UnifiedTimeline;
            } else {
              // Reconstruct baseline timeline using approved shot takes from Bible
              originalTimeline = await this.withBible(`data/series/${seriesId}/story_bible.db`, async (bible) => {
                const takes = bible.listShotTakes(seriesId, epNum);
                const approvedTakes = takes.filter((t) => t.is_approved === 1);
                const shots: TimelineVideoShot[] = approvedTakes.map((t, idx) => ({
                  shotId: t.shot_id,
                  sceneId: "scene_1",
                  startFrame: idx * 90,
                  endFrame: (idx + 1) * 90,
                  durationFrames: 90,
                  startSec: idx * 3.0,
                  endSec: (idx + 1) * 3.0,
                  durationSec: 3.0,
                  shotType: "medium",
                  visualPrompt: t.prompt || "Shot visual prompt",
                  approvedClipPath: t.local_path,
                  trimStartSec: 0,
                }));
                return {
                  seriesId,
                  episodeNumber: epNum,
                  fps: 30,
                  sampleRate: 48000,
                  targetTotalFrames: shots.length * 90,
                  targetTotalDurationSec: shots.length * 3.0,
                  videoTrack: shots,
                  dialogueTrack: [],
                  sfxTrack: [],
                  ambienceTrack: [],
                  subtitleTrack: [],
                  stems: {},
                  metrics: {
                    videoDurationSec: shots.length * 3.0,
                    audioDurationSec: shots.length * 3.0,
                    driftSec: 0,
                    driftFrames: 0,
                    isWithinTolerance: true,
                    toleranceSec: 0.05,
                  },
                };
              });
            }

            const diff = compareWithTimeline(originalTimeline, ingested);
            let applied = false;
            let updatedTimeline: UnifiedTimeline | undefined = undefined;

            if (body.apply === true) {
              applied = await this.withBible(`data/series/${seriesId}/story_bible.db`, async (bible) => {
                return applyNleEditsToBible(diff, bible, seriesId, epNum);
              });
              try {
                updatedTimeline = applyNleEditsToTimeline(originalTimeline, diff, ingested);
                await mkdir(dirname(assemblyTimelinePath), { recursive: true });
                await writeFile(assemblyTimelinePath, JSON.stringify(updatedTimeline, null, 2), "utf-8");
                log.info(`[NLE INGEST] Đã cập nhật file assembly timeline: ${assemblyTimelinePath}`);
              } catch (writeErr: any) {
                log.warn(`[NLE INGEST] Lỗi cập nhật timeline.json: ${writeErr.message}`);
              }
            }

            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(
              JSON.stringify({
                success: true,
                seriesId,
                episodeNumber: epNum,
                diff,
                applied,
                timelineUpdated: Boolean(updatedTimeline),
              })
            );
            return;
          }

          // 404 Not Found
          res.writeHead(404, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: `Route not found: ${req.method} ${pathname}` }));
        } catch (err: any) {
          log.error(`Studio API Error: ${redact(err.message)}`);
          res.writeHead(err instanceof HttpError ? err.status : err instanceof ZodError ? 400 : 500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: redact(err.message) }));
        }
      });

      this.server.listen(this.port, this.host, () => {
        const address = this.server!.address();
        if (address && typeof address !== "string") this.port = address.port;
        this.api.startWorker();
        const url = `http://${this.host}:${this.port}`;
        resolvePromise(url);
      });

      this.server.on("error", (err) => {
        reject(err);
      });
    });
  }

  public async close(): Promise<void> {
    await this.api.close();
    for (const clients of this.sseClients.values()) for (const client of clients) client.end();
    return new Promise((resolveClose) => {
      if (!this.server) {
        resolveClose();
        return;
      }
      this.server.close(() => {
        resolveClose();
      });
    });
  }

  private handleSseConnection(req: IncomingMessage, res: ServerResponse, seriesId: string, epNum: number): void {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
    });

    const key = `${seriesId}_${epNum}`;
    if (!this.sseClients.has(key)) {
      this.sseClients.set(key, new Set());
    }
    this.sseClients.get(key)!.add(res);

    // Welcome event
    res.write(`data: ${JSON.stringify({ type: "connected", seriesId, episodeNumber: epNum })}\n\n`);

    // Keepalive ping every 15s
    const pingInterval = setInterval(() => {
      try {
        res.write(": ping\n\n");
      } catch {
        clearInterval(pingInterval);
      }
    }, 15000);

    req.on("close", () => {
      clearInterval(pingInterval);
      this.sseClients.get(key)?.delete(res);
    });
  }

  private async handleMediaStream(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
    const rawPath = url.searchParams.get("path");
    if (!rawPath) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Missing 'path' query parameter" }));
      return;
    }

    const safePath = containedPath(process.cwd(), normalize(resolve(rawPath)));
    const projectRoot = normalize(resolve(process.cwd()));
    const isWin = process.platform === "win32";
    const normSafe = isWin ? safePath.toLowerCase() : safePath;
    const normRoot = isWin ? projectRoot.toLowerCase() : projectRoot;
    const rel = relative(normRoot, normSafe);
    if (rel.startsWith("..") || isAbsolute(rel) || rel === "") {
      res.writeHead(403, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Access denied to requested path" }));
      return;
    }

    const lowerPath = safePath.toLowerCase();
    const fileName = basename(safePath);
    if (
      fileName.startsWith(".") ||
      lowerPath.includes(".git") ||
      lowerPath.endsWith(".env") ||
      lowerPath.endsWith(".db") ||
      lowerPath.endsWith(".sqlite") ||
      lowerPath.endsWith(".ts") ||
      lowerPath.endsWith(".js") ||
      lowerPath.endsWith(".json")
    ) {
      res.writeHead(403, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Access denied to sensitive or non-media files" }));
      return;
    }

    const ext = extname(safePath).toLowerCase();
    const ALLOWED_EXTS = new Set([
      ".mp4", ".mov", ".mkv", ".webm",
      ".jpg", ".jpeg", ".png", ".webp",
      ".wav", ".mp3", ".m4a", ".aac",
      ".srt", ".vtt", ".ass", ".otio", ".xml",
    ]);
    if (!ALLOWED_EXTS.has(ext)) {
      res.writeHead(403, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Access denied: unapproved media extension" }));
      return;
    }

    if (!existsSync(safePath)) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: `File not found: ${rawPath}` }));
      return;
    }

    let contentType = "application/octet-stream";
    if (ext === ".mp4") contentType = "video/mp4";
    else if (ext === ".jpg" || ext === ".jpeg") contentType = "image/jpeg";
    else if (ext === ".png") contentType = "image/png";
    else if (ext === ".wav") contentType = "audio/wav";
    else if (ext === ".mp3") contentType = "audio/mpeg";
    else if (ext === ".srt") contentType = "text/plain; charset=utf-8";
    else if (ext === ".vtt") contentType = "text/vtt; charset=utf-8";
    else if (ext === ".ass") contentType = "text/x-ssa; charset=utf-8";

    const fileStat = await stat(safePath);
    if (fileStat.isDirectory()) {
      res.writeHead(403, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Access denied: cannot stream directories" }));
      return;
    }
    const fileSize = fileStat.size;
    const range = req.headers.range;

    if (range) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
      if (!match) {
        res.writeHead(416, {
          "Content-Range": `bytes */${fileSize}`,
          "Content-Type": contentType,
        });
        res.end();
        return;
      }

      let start: number;
      let end: number;

      if (match[1] === "" && match[2] !== "") {
        // Suffix byte range: bytes=-500 (requesting last 500 bytes)
        const suffixLen = parseInt(match[2], 10);
        if (isNaN(suffixLen) || suffixLen <= 0) {
          res.writeHead(416, {
            "Content-Range": `bytes */${fileSize}`,
            "Content-Type": contentType,
          });
          res.end();
          return;
        }
        start = Math.max(0, fileSize - suffixLen);
        end = fileSize - 1;
      } else if (match[1] !== "") {
        start = parseInt(match[1], 10);
        end = match[2] !== "" ? parseInt(match[2], 10) : fileSize - 1;
      } else {
        res.writeHead(416, {
          "Content-Range": `bytes */${fileSize}`,
          "Content-Type": contentType,
        });
        res.end();
        return;
      }

      if (isNaN(start) || isNaN(end) || start > end || start >= fileSize) {
        res.writeHead(416, {
          "Content-Range": `bytes */${fileSize}`,
          "Content-Type": contentType,
        });
        res.end();
        return;
      }

      end = Math.min(end, fileSize - 1);
      const chunkSize = end - start + 1;
      const stream = createReadStream(safePath, { start, end });

      res.writeHead(206, {
        "Content-Range": `bytes ${start}-${end}/${fileSize}`,
        "Accept-Ranges": "bytes",
        "Content-Length": chunkSize,
        "Content-Type": contentType,
      });
      stream.pipe(res);
    } else {
      res.writeHead(200, {
        "Content-Length": fileSize,
        "Content-Type": contentType,
        "Accept-Ranges": "bytes",
      });
      createReadStream(safePath).pipe(res);
    }
  }

  private async listAllSeries(): Promise<any[]> {
    const seriesDir = join("data", "series");
    if (!existsSync(seriesDir)) return [];

    const entries = await readdir(seriesDir, { withFileTypes: true });
    const list: any[] = [];

    for (const ent of entries) {
      if (ent.isDirectory()) {
        const dbPath = join(seriesDir, ent.name, "story_bible.db");
        if (existsSync(dbPath)) {
          try {
            await this.withBible(dbPath, (bible) => {
              const meta = bible.getSeriesMetadata(ent.name) || { id: ent.name, title: ent.name };
              const chars = bible.listCharacters(ent.name);
              const locs = bible.listLocations(ent.name);
              const history = bible.getCanonHistory(ent.name);
              list.push({
                ...meta,
                characterCount: chars.length,
                locationCount: locs.length,
                episodeCount: history.length,
              });
            });
          } catch {}
        }
      }
    }
    return list;
  }

  private async getSeriesBibleData(seriesId: string): Promise<any> {
    const dbPath = join("data", "series", seriesId, "story_bible.db");
    return await this.withBible(existsSync(dbPath) ? dbPath : ":memory:", (bible) => {
      return {
        metadata: bible.getSeriesMetadata(seriesId) || { id: seriesId, title: seriesId },
        characters: bible.listCharacters(seriesId),
        locations: bible.listLocations(seriesId),
        props: bible.listKeyProps(seriesId),
        worldState: bible.getAllWorldState(seriesId),
        canonHistory: bible.getCanonHistory(seriesId),
      };
    });
  }

  private async withBible<T>(dbPath: string, fn: (bible: BibleManager) => T | Promise<T>): Promise<T> {
    const bible = new BibleManager(dbPath);
    try {
      return await fn(bible);
    } finally {
      try {
        bible.close();
      } catch {}
    }
  }

  private async parseJsonBody(req: IncomingMessage): Promise<any> {
    return readJson(req);
  }
}
