import { legacyRoutes } from './routes/legacy/index.js';
import type { StoryStore } from '../../bootstrap/ports/workflow-store.js';
import type { ProjectCatalog, ProjectSettings } from '../../modules/projects/index.js';
export interface StudioHttpServerDependencies {
    api: StudioApiPort;
    settings: ProjectSettings;
    catalog: ProjectCatalog;
    withBible<T>(path: string, fn: (store: StoryStore) => T | Promise<T>): Promise<T>;
}
import { createReadStream, existsSync } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { basename, extname, isAbsolute, join, normalize, relative, resolve } from "node:path";
import { log } from "../../platform/observability/logger.js";
import { applicationError } from "./application-error.js";
import { checkRequestOrigin, localStudioHost } from "./http-safety.js";
import { HttpError } from "../../platform/errors.js";
import { ProjectPaths } from "../../platform/filesystem/project-paths.js";
import { readScopedJson } from "./scoped-request.js";
import type {StudioHttpApi} from "./studio-api.js";
type StudioApiPort=Pick<StudioHttpApi,"handle"|"close"|"store"|"isUnderMaintenance"|"startWorker"|"ready">;
import { SeriesId } from "../../contracts/requests.js";
export interface StudioServerOptions {
    port?: number;
    host?: string;
    autoOpen?: boolean;
    queuePath?: string;
    settingsPath?: string;
    workersEnabled?: boolean;
}
export class StudioHttpServer {
    private server: Server | null = null;
    private port: number;
    private host: string;
    private ownedTimers = new Map<ReturnType<typeof setInterval>, (() => void) | undefined>();
    private trackTimer(timer: ReturnType<typeof setInterval>, onClose?: () => void) { this.ownedTimers.set(timer, onClose); }
    private clearTimer(timer: ReturnType<typeof setInterval>) { clearInterval(timer); this.ownedTimers.delete(timer); }
    private sseClients: Map<string, Set<ServerResponse>> = new Map();
    private settingsManager: ProjectSettings;
    private catalog: StudioHttpServerDependencies["catalog"];
    private openStore: StudioHttpServerDependencies["withBible"];
    private api: StudioApiPort;
    constructor(options: StudioServerOptions, dependencies: StudioHttpServerDependencies) {
        this.port = options.port ?? 3456;
        this.host = localStudioHost(options.host ?? '127.0.0.1');
        this.settingsManager = dependencies.settings;
        this.api = dependencies.api;
        this.catalog = dependencies.catalog;
        this.openStore = dependencies.withBible;
    }
    public broadcastEvent(seriesId: string, episodeNumber: number, data: Record<string, unknown>): void {
        const key = `${seriesId}_${episodeNumber}`;
        const clients = this.sseClients.get(key);
        if (!clients || clients.size === 0)
            return;
        const payload = `data: ${JSON.stringify(data)}\n\n`;
        for (const res of clients) {
            try {
                res.write(payload);
            }
            catch {
                clients.delete(res);
            }
        }
    }
    public async start(): Promise<string> {
        await this.api.ready();
        return new Promise((resolvePromise, reject) => {
            this.server = createServer(async (req, res) => {
                try {
                    checkRequestOrigin(req, this.host, this.port);
                }
                catch (error) {
                    res.writeHead(error instanceof HttpError ? error.status : 403, { "Content-Type": "application/json" });
                    res.end(JSON.stringify({ error: error instanceof Error ? error.message : "Forbidden" }));
                    return;
                }
                res.setHeader("X-Content-Type-Options", "nosniff");
                res.setHeader("Referrer-Policy", "no-referrer");
                if (req.method === "OPTIONS") {
                    res.writeHead(204);
                    res.end();
                    return;
                }
                const url = new URL(req.url || "/", `http://${this.host === "::1" ? "[::1]" : this.host}:${this.port}`);
                const pathname = url.pathname;
                try {
                    const seriesPath = pathname.match(/^\/api\/(?:v1\/)?series\/([^/]+)\//);
                    if (seriesPath)
                        SeriesId.parse(decodeURIComponent(seriesPath[1]));
                    if (await this.api.handle(req, res, url))
                        return;
                    const context = { trackTimer: (timer: ReturnType<typeof setInterval>, onClose?: () => void) => this.trackTimer(timer, onClose), clearTimer: (timer: ReturnType<typeof setInterval>) => this.clearTimer(timer), api: this.api, settingsManager: this.settingsManager, catalog: this.catalog, openStore: this.openStore, broadcastEvent: (...args: Parameters<StudioHttpServer['broadcastEvent']>) => this.broadcastEvent(...args), parseJsonBody: (request: IncomingMessage) => this.parseJsonBody(request), handleSseConnection: (request: IncomingMessage, response: ServerResponse, id: string, episode: number) => this.handleSseConnection(request, response, id, episode), handleMediaStream: (request: IncomingMessage, response: ServerResponse, target: URL) => this.handleMediaStream(request, response, target) };
                    for (const route of legacyRoutes)
                        if (await route(req, res, url, context))
                            return;
                    // 404 Not Found
                    res.writeHead(404, { "Content-Type": "application/json" });
                    res.end(JSON.stringify({ error: `Route not found: ${req.method} ${pathname}` }));
                }
                catch (err: unknown) {
                    const failure = applicationError(err);
                    log.error(`Studio API Error: ${failure.error.message}`);
                    res.writeHead(failure.status, { "Content-Type": "application/json" });
                    res.end(JSON.stringify({
                        error: { message: failure.error.message, code: failure.error.code },
                        code: failure.error.code,
                        message: failure.error.message,
                    }));
                }
            });
            this.server.listen(this.port, this.host, () => {
                const address = this.server!.address();
                if (address && typeof address !== "string")
                    this.port = address.port;
                this.api.startWorker();
                const url = `http://${this.host === "::1" ? "[::1]" : this.host}:${this.port}`;
                resolvePromise(url);
            });
            this.server.on("error", (err) => {
                reject(err);
            });
        });
    }
    public async close(): Promise<void> {
        for (const [timer, onClose] of this.ownedTimers) {
            clearInterval(timer);
            onClose?.();
        }
        this.ownedTimers.clear();
        await this.api.close();
        for (const clients of this.sseClients.values())
            for (const client of clients)
                client.end();
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
            }
            catch {
                this.clearTimer(pingInterval);
            }
        }, 15000);
        this.trackTimer(pingInterval);
        req.on("close", () => {
            this.clearTimer(pingInterval);
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
        const paths = new ProjectPaths(), seriesId = url.searchParams.get("seriesId") ?? paths.inferSeries(rawPath);
        const safePath = paths.check(seriesId, rawPath, true);
        if (!existsSync(join(paths.workspace, "data", "series", seriesId, "story_bible.db")))
            throw new HttpError(404, "SERIES_NOT_FOUND");
        if (safePath.split(/[\\/]/).some(part => part.startsWith("staging")))
            throw new HttpError(403, "ARTIFACT_NOT_PUBLISHED");
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
        if (fileName.startsWith(".") ||
            lowerPath.includes(".git") ||
            lowerPath.endsWith(".env") ||
            lowerPath.endsWith(".db") ||
            lowerPath.endsWith(".sqlite") ||
            lowerPath.endsWith(".ts") ||
            lowerPath.endsWith(".js") ||
            lowerPath.endsWith(".json")) {
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
        if (ext === ".mp4")
            contentType = "video/mp4";
        else if (ext === ".jpg" || ext === ".jpeg")
            contentType = "image/jpeg";
        else if (ext === ".png")
            contentType = "image/png";
        else if (ext === ".wav")
            contentType = "audio/wav";
        else if (ext === ".mp3")
            contentType = "audio/mpeg";
        else if (ext === ".srt")
            contentType = "text/plain; charset=utf-8";
        else if (ext === ".vtt")
            contentType = "text/vtt; charset=utf-8";
        else if (ext === ".ass")
            contentType = "text/x-ssa; charset=utf-8";
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
            }
            else if (match[1] !== "") {
                start = parseInt(match[1], 10);
                end = match[2] !== "" ? parseInt(match[2], 10) : fileSize - 1;
            }
            else {
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
            stream.on("error", () => {
                if (!res.headersSent) {
                    res.writeHead(500, { "Content-Type": "application/json" });
                    res.end(JSON.stringify({ error: "Stream read error" }));
                } else {
                    res.destroy();
                }
            });
            res.on("close", () => stream.destroy());
            res.writeHead(206, {
                "Content-Range": `bytes ${start}-${end}/${fileSize}`,
                "Accept-Ranges": "bytes",
                "Content-Length": chunkSize,
                "Content-Type": contentType,
            });
            stream.pipe(res);
        }
        else {
            const stream = createReadStream(safePath);
            stream.on("error", () => {
                if (!res.headersSent) {
                    res.writeHead(500, { "Content-Type": "application/json" });
                    res.end(JSON.stringify({ error: "Stream read error" }));
                } else {
                    res.destroy();
                }
            });
            res.on("close", () => stream.destroy());
            res.writeHead(200, {
                "Content-Length": fileSize,
                "Content-Type": contentType,
                "Accept-Ranges": "bytes",
            });
            stream.pipe(res);
        }
    }
    private async parseJsonBody(req: IncomingMessage): Promise<any> {
        return readScopedJson(req, new URL(req.url ?? "/", `http://${this.host}:${this.port}`));
    }
}
