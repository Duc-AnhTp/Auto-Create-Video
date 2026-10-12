import { readNleShotMetadata } from "../../../../modules/story/index.js";
import { applyNleIngest } from "../../../../modules/production/index.js";
import { z } from 'zod';
import { existsSync } from "node:fs";
import { copyFile, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { type IncomingMessage, type ServerResponse } from "node:http";
import { dirname, isAbsolute, join, normalize, relative, resolve } from "node:path";
import { applyNleEditsToTimeline, compareWithTimeline, parseNleTimeline } from "../../../../modules/media/index.js";
import type { UnifiedTimeline } from "../../../../contracts/timeline.js";
import { log } from "../../../../platform/observability/logger.js";
import { containedPath } from "../../../../platform/filesystem/containment.js";
import { SeriesId } from "../../../../contracts/requests.js";
import type { ServerRouteContext } from './context.js';
export async function legacy19_nleIngestMatch(req: IncomingMessage, res: ServerResponse, url: URL, ctx: Pick<ServerRouteContext, "parseJsonBody" | "openStore">): Promise<boolean> {
    const pathname = url.pathname;
    const nleIngestMatch = pathname.match(/^\/api\/series\/([^/]+)\/episodes\/(\d+)\/nle\/ingest$/);
    if (!(nleIngestMatch && req.method === "POST"))
        return false;
    const seriesId = SeriesId.parse(nleIngestMatch[1]);
    const epNum = parseInt(nleIngestMatch[2], 10);
    const body = z.object({ content: z.string().optional(), xmlContent: z.string().optional(), otioContent: z.string().optional(), filePath: z.string().optional(), xmlPath: z.string().optional(), otioPath: z.string().optional(), format: z.enum(["xml", "otio"]).optional(), apply: z.boolean().optional() }).passthrough().parse(await ctx.parseJsonBody(req));
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
            return true;
        }
        if (existsSync(safePath)) {
            content = await readFile(safePath, "utf-8");
        }
    }
    if (!content) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Missing required 'content' (XML or OTIO string) or valid 'filePath'" }));
        return true;
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
    }
    else {
        // Reconstruct baseline timeline using approved shot takes from Bible
        originalTimeline = await ctx.openStore(`data/series/${seriesId}/story_bible.db`, (bible) => readNleShotMetadata(bible, { seriesId, epNum }));
    }
    const diff = compareWithTimeline(originalTimeline, ingested);
    let applied = false;
    let updatedTimeline: UnifiedTimeline | undefined = undefined;
    if (body.apply === true) {
        const stagingTimelinePath = `${assemblyTimelinePath}.tmp.${Date.now()}`;
        const backupTimelinePath = `${assemblyTimelinePath}.bak.${Date.now()}`;
        try {
            updatedTimeline = applyNleEditsToTimeline(originalTimeline, diff, ingested);
            await mkdir(dirname(stagingTimelinePath), { recursive: true });
            await writeFile(stagingTimelinePath, JSON.stringify(updatedTimeline, null, 2), "utf-8");
            // Backup existing timeline before replacing
            if (existsSync(assemblyTimelinePath)) {
                await copyFile(assemblyTimelinePath, backupTimelinePath);
            }
            // 1. Rename staging file to destination
            await rename(stagingTimelinePath, assemblyTimelinePath);
            // 2. Apply edits to SQLite Story Bible
            try {
                applied = await ctx.openStore(`data/series/${seriesId}/story_bible.db`, (bible) => applyNleIngest(bible, { diff, seriesId, epNum }));
            }
            catch (dbErr: any) {
                // Rollback timeline file from backup if SQLite update fails
                if (existsSync(backupTimelinePath)) {
                    try {
                        await copyFile(backupTimelinePath, assemblyTimelinePath);
                    }
                    catch (caughtError) {
                        log.warn("[legacy19_nleIngestMatch] " + String(caughtError));
                    }
                }
                throw dbErr;
            }
            finally {
                if (existsSync(backupTimelinePath)) {
                    try {
                        await unlink(backupTimelinePath);
                    }
                    catch (caughtError) {
                        log.warn("[legacy19_nleIngestMatch] " + String(caughtError));
                    }
                }
            }
            log.info(`[NLE INGEST] Đã cập nhật file assembly timeline nguyên tử: ${assemblyTimelinePath}`);
        }
        catch (writeErr: any) {
            if (existsSync(stagingTimelinePath)) {
                try {
                    await unlink(stagingTimelinePath);
                }
                catch (caughtError) {
                    log.warn("[legacy19_nleIngestMatch] " + String(caughtError));
                }
            }
            log.warn(`[NLE INGEST] Lỗi cập nhật timeline nguyên tử: ${writeErr.message}`);
            throw new Error(`NLE atomic staging failed: ${writeErr.message}`);
        }
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
        success: true,
        seriesId,
        episodeNumber: epNum,
        diff,
        applied,
        timelineUpdated: Boolean(updatedTimeline),
    }));
    return true;
}
