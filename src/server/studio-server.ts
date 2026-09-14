import { createServer, type Server, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile, writeFile, readdir, mkdir, stat } from "node:fs/promises";
import { createReadStream, existsSync } from "node:fs";
import { join, resolve, normalize, extname } from "node:path";
import { exec } from "node:child_process";
import { BibleManager } from "../bible/bible-manager.js";
import { StoryToScreenplayGenerator } from "../series/story-to-screenplay.js";
import { ConceptArtGenerator } from "../series/concept-art-generator.js";
import { EpisodicPipeline, type EpisodicPipelineOptions } from "../series/episodic-pipeline.js";
import { parseRawScreenplay, normalizeScript } from "../series/script-normalizer.js";
import { log } from "../utils/logger.js";
import { SettingsManager } from "./settings-manager.js";
import { renderStudioHtml } from "./studio-ui.js";

export interface StudioServerOptions {
  port?: number;
  host?: string;
  autoOpen?: boolean;
}

export class StudioServer {
  private server: Server | null = null;
  private port: number;
  private host: string;
  private sseClients: Map<string, Set<ServerResponse>> = new Map();
  private settingsManager: SettingsManager;

  constructor(options: StudioServerOptions = {}) {
    this.port = options.port || 3456;
    this.host = options.host || "127.0.0.1";
    this.settingsManager = new SettingsManager();
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
        // CORS Headers
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
        res.setHeader("Access-Control-Allow-Headers", "Content-Type, Range");

        if (req.method === "OPTIONS") {
          res.writeHead(204);
          res.end();
          return;
        }

        const url = new URL(req.url || "/", `http://${this.host}:${this.port}`);
        const pathname = url.pathname;

        try {
          // 1. Health Check
          if (pathname === "/health") {
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ status: "ok", uptime: process.uptime(), timestamp: new Date().toISOString() }));
            return;
          }

          // 2. Web UI SPA (Home)
          if (pathname === "/" || pathname === "/studio") {
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
            const bible = new BibleManager(`data/series/${body.id}/story_bible.db`);
            const meta = {
              id: body.id,
              title: body.title || "Untitled Series",
              genre: body.genre || "Cinema Drama",
              visual_style: body.visual_style || "Cinematic 35mm, 8k photorealistic",
              aspect_ratio: body.aspect_ratio || "9:16",
              fps: Number(body.fps) || 30,
              created_at: new Date().toISOString(),
            };
            bible.upsertSeriesMetadata(meta);
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
            const bible = new BibleManager(`data/series/${seriesId}/story_bible.db`);
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
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ success: true, character: bible.getCharacter(body.id) }));
            return;
          }

          const locMatch = pathname.match(/^\/api\/series\/([^/]+)\/locations$/);
          if (locMatch && req.method === "POST") {
            const seriesId = locMatch[1];
            const body = await this.parseJsonBody(req);
            const bible = new BibleManager(`data/series/${seriesId}/story_bible.db`);
            bible.upsertLocation({
              id: body.id,
              series_id: seriesId,
              name: body.name,
              visual_summary: body.visual_summary,
              lighting_mood: body.lighting_mood,
              atmospheric_rules: body.atmospheric_rules,
              reference_image_path: body.reference_image_path,
            });
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ success: true, location: bible.getLocation(body.id) }));
            return;
          }

          const propMatch = pathname.match(/^\/api\/series\/([^/]+)\/props$/);
          if (propMatch && req.method === "POST") {
            const seriesId = propMatch[1];
            const body = await this.parseJsonBody(req);
            const bible = new BibleManager(`data/series/${seriesId}/story_bible.db`);
            bible.upsertKeyProp({
              id: body.id,
              series_id: seriesId,
              name: body.name,
              current_holder_id: body.current_holder_id,
              description: body.description,
            });
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ success: true, prop: bible.getKeyProp(body.id) }));
            return;
          }

          // AI Generate Concept Art
          const genArtMatch = pathname.match(/^\/api\/series\/([^/]+)\/gen-art$/);
          if (genArtMatch && req.method === "POST") {
            const seriesId = genArtMatch[1];
            const body = await this.parseJsonBody(req);
            const bible = new BibleManager(`data/series/${seriesId}/story_bible.db`);
            const gen = new ConceptArtGenerator(bible);
            let result;
            if (body.type === "location") {
              result = await gen.generateLocationConceptArt({
                seriesId,
                locationId: body.id,
                promptOverride: body.promptOverride,
                provider: body.provider || "mock",
              });
            } else {
              result = await gen.generateCharacterConceptArt({
                seriesId,
                characterId: body.id,
                promptOverride: body.promptOverride,
                provider: body.provider || "mock",
              });
            }
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ success: true, result }));
            return;
          }

          // AI Generate Screenplay
          const genScriptMatch = pathname.match(/^\/api\/series\/([^/]+)\/script\/generate$/);
          if (genScriptMatch && req.method === "POST") {
            const seriesId = genScriptMatch[1];
            const body = await this.parseJsonBody(req);
            const bible = new BibleManager(`data/series/${seriesId}/story_bible.db`);
            const generator = new StoryToScreenplayGenerator(bible);
            const result = await generator.generateScreenplay({
              seriesId,
              prompt: body.prompt,
              storyText: body.storyText,
              episodeNumber: body.episodeNumber,
              targetScenes: body.targetScenes || 3,
              tone: body.tone,
              skipAudit: true,
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

            const bible = new BibleManager(`data/series/${seriesId}/story_bible.db`);
            const normalized = await normalizeScript(body.rawScreenplay, bible, {
              seriesId,
              skipAudit: true,
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
                  error: err.message,
                  timestamp: new Date().toISOString(),
                });
              }
            };

            // Non-blocking kickoff if async requested
            if (body.async) {
              runProduction();
              res.writeHead(202, { "Content-Type": "application/json" });
              res.end(JSON.stringify({ success: true, message: "Bắt đầu sản xuất tập phim", seriesId, episodeNumber: epNum }));
            } else {
              await runProduction();
              res.writeHead(200, { "Content-Type": "application/json" });
              res.end(JSON.stringify({ success: true, seriesId, episodeNumber: epNum }));
            }
            return;
          }

          // 404 Not Found
          res.writeHead(404, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: `Route not found: ${req.method} ${pathname}` }));
        } catch (err: any) {
          log.error(`Studio API Error: ${err.message}`);
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: err.message }));
        }
      });

      this.server.listen(this.port, this.host, () => {
        const url = `http://${this.host}:${this.port}`;
        resolvePromise(url);
      });

      this.server.on("error", (err) => {
        reject(err);
      });
    });
  }

  public close(): Promise<void> {
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
      "Access-Control-Allow-Origin": "*",
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

    const safePath = normalize(resolve(rawPath));
    const projectRoot = normalize(resolve(process.cwd()));
    if (!safePath.startsWith(projectRoot) && !safePath.includes("output") && !safePath.includes("assets")) {
      res.writeHead(403, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Access denied to requested path" }));
      return;
    }

    if (!existsSync(safePath)) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: `File not found: ${rawPath}` }));
      return;
    }

    const ext = extname(safePath).toLowerCase();
    let contentType = "application/octet-stream";
    if (ext === ".mp4") contentType = "video/mp4";
    else if (ext === ".jpg" || ext === ".jpeg") contentType = "image/jpeg";
    else if (ext === ".png") contentType = "image/png";
    else if (ext === ".wav") contentType = "audio/wav";
    else if (ext === ".mp3") contentType = "audio/mpeg";

    const fileStat = await stat(safePath);
    const fileSize = fileStat.size;
    const range = req.headers.range;

    if (range) {
      const parts = range.replace(/bytes=/, "").split("-");
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
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
            const bible = new BibleManager(dbPath);
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
          } catch {}
        }
      }
    }
    return list;
  }

  private async getSeriesBibleData(seriesId: string): Promise<any> {
    const dbPath = join("data", "series", seriesId, "story_bible.db");
    const bible = new BibleManager(existsSync(dbPath) ? dbPath : ":memory:");
    return {
      metadata: bible.getSeriesMetadata(seriesId) || { id: seriesId, title: seriesId },
      characters: bible.listCharacters(seriesId),
      locations: bible.listLocations(seriesId),
      props: bible.listKeyProps(seriesId),
      worldState: bible.getAllWorldState(seriesId),
      canonHistory: bible.getCanonHistory(seriesId),
    };
  }

  private parseJsonBody(req: IncomingMessage): Promise<any> {
    return new Promise((resolvePromise, reject) => {
      let body = "";
      req.on("data", (chunk) => {
        body += chunk;
      });
      req.on("end", () => {
        try {
          resolvePromise(body ? JSON.parse(body) : {});
        } catch (err) {
          reject(new Error("Invalid JSON body"));
        }
      });
      req.on("error", reject);
    });
  }
}
