import { errorCode } from '../../../../platform/workflow-error.js';
import { z } from 'zod';
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { type IncomingMessage, type ServerResponse } from "node:http";
import { resolve } from "node:path";
import { log } from "../../../../platform/observability/logger.js";
import { containedPath } from "../../../../platform/filesystem/containment.js";
import { HttpError } from "../../../../platform/errors.js";
import { ProductionRequestSchema } from "../../../../contracts/requests.js";
import type { ServerRouteContext } from './context.js';
export async function legacy18_produceMatch(req: IncomingMessage, res: ServerResponse, url: URL, ctx: Pick<ServerRouteContext, "parseJsonBody" | "api" | "broadcastEvent" | "trackTimer" | "clearTimer">): Promise<boolean> {
    const pathname = url.pathname;
    const produceMatch = pathname.match(/^\/api\/series\/([^/]+)\/episodes\/produce$/);
    if (!(produceMatch && req.method === "POST"))
        return false;
    const seriesId = produceMatch[1];
    const body = z.object({ episodeNumber: z.coerce.number().int().positive().optional(), scriptPath: z.string().optional(), rawScreenplay: z.string().optional(), provider: z.string().optional(), dryRun: z.boolean().optional(), hedge: z.unknown().optional(), budgetCapUsd: z.number().nonnegative().optional(), resume: z.boolean().optional(), exportResolution: z.enum(["720p", "1080p"]).optional(), async: z.boolean().optional() }).passthrough().parse(await ctx.parseJsonBody(req));
    const epNum = body.episodeNumber || 1;
    if (ctx.api.isUnderMaintenance(seriesId)) {
        res.writeHead(409, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
            error: "PROJECT_MAINTENANCE",
            message: `Series '${seriesId}' is currently locked for maintenance.`,
        }));
        return true;
    }
    if (body.scriptPath)
        containedPath(resolve("data"), resolve(body.scriptPath));
    // Durable queue is authoritative whenever it is configured. Never fall through
    // to direct execution after a validation, lock, or persistence failure.
    let jobId: string | undefined;
    if (ctx.api.store) {
        let screenplayText = body.rawScreenplay;
        if (!screenplayText && body.scriptPath && existsSync(body.scriptPath)) {
            screenplayText = await readFile(body.scriptPath, "utf8");
        }
        const parsed = ProductionRequestSchema.safeParse({
            seriesId,
            episodeNumber: epNum,
            rawScreenplay: screenplayText || `// Episode ${epNum} screenplay`,
            provider: body.provider === "api_kling" ||
                body.provider === "api_runway" ||
                body.provider === "api_veo" ||
                body.provider === "api_seedance" ||
                body.provider === "local_comfyui"
                ? body.provider
                : "mock",
            mode: body.provider && body.provider !== "mock" && !body.dryRun
                ? "production"
                : "mock",
            hedge: body.hedge,
            budgetCapUsd: body.budgetCapUsd,
            resume: body.resume ?? true,
            exportResolution: body.exportResolution,
        });
        if (!parsed.success) {
            throw new HttpError(400, "INVALID_PRODUCTION_REQUEST", parsed.error.message);
        }
        try {
            const job = ctx.api.store.enqueue(parsed.data);
            jobId = job.id;
            ctx.api.startWorker();
        }
        catch (storeErr) {
            const code = errorCode(storeErr);
            if (code === "EPISODE_BUSY" || code === "SERIES_BUSY") {
                res.writeHead(409, { "Content-Type": "application/json" });
                res.end(JSON.stringify({
                    error: code,
                    code,
                    message: storeErr instanceof Error ? storeErr.message : String(storeErr),
                }));
                return true;
            }
            throw storeErr;
        }
    }
    if (jobId) {
        const store = ctx.api.store;
        const currentJobId = jobId;
        let lastStep = -1;
        const pollStartTime = Date.now();
        const maxPollDurationMs = 2 * 60 * 60 * 1000; // 2 hours max
        const pollTimer = setInterval(() => {
            if (Date.now() - pollStartTime > maxPollDurationMs) {
                ctx.clearTimer(pollTimer);
                log.warn(`[STUDIO SERVER] Poll timer timed out after 2h for job ${currentJobId}`);
                return true;
            }
            try {
                const current = store.get(currentJobId);
                if (current.progress && current.progress.step !== lastStep) {
                    lastStep = current.progress.step;
                    ctx.broadcastEvent(seriesId, epNum, {
                        type: "progress",
                        step: current.progress.step,
                        totalSteps: current.progress.total,
                        message: current.progress.message,
                        jobId: currentJobId,
                        timestamp: new Date().toISOString(),
                    });
                }
                if (["succeeded", "failed", "cancelled", "needs_review"].includes(current.status)) {
                    ctx.clearTimer(pollTimer);
                    ctx.broadcastEvent(seriesId, epNum, {
                        type: current.status === "succeeded" ? "complete" : current.status === "needs_review" ? "needs_review" : "error",
                        result: current.result,
                        error: current.error?.message,
                        jobId: currentJobId,
                        timestamp: new Date().toISOString(),
                    });
                }
            }
            catch {
                ctx.clearTimer(pollTimer);
            }
        }, 400);
        pollTimer.unref();
        ctx.trackTimer(pollTimer);
        if (body.async !== false) {
            res.writeHead(202, { "Content-Type": "application/json" });
            res.end(JSON.stringify({
                success: true,
                message: "Bắt đầu sản xuất tập phim",
                seriesId,
                episodeNumber: epNum,
                jobId: currentJobId,
            }));
            return true;
        }
        else {
            await new Promise<void>((resolveSync) => {
                const maxWaitMs = 120000; // 2 minutes max wait for sync produce
                const deadline = Date.now() + maxWaitMs;
                const checkTimer = setInterval(() => {
                    try {
                        const j = store.get(currentJobId);
                        if (["succeeded", "failed", "cancelled", "needs_review"].includes(j.status) ||
                            Date.now() > deadline) {
                            ctx.clearTimer(checkTimer);
                            resolveSync();
                        }
                    }
                    catch {
                        ctx.clearTimer(checkTimer);
                        resolveSync();
                    }
                }, 250);
                checkTimer.unref();
                ctx.trackTimer(checkTimer, resolveSync);
            });
            const finished = store.get(currentJobId);
            if (["queued", "running", "paused"].includes(finished.status)) {
                res.writeHead(202, { "Content-Type": "application/json" });
                res.end(JSON.stringify({
                    success: true,
                    pending: true,
                    seriesId,
                    episodeNumber: epNum,
                    jobId: currentJobId,
                    status: finished.status,
                }));
                return true;
            }
            const isSuccess = finished.status === "succeeded";
            res.writeHead(isSuccess ? 200 : 500, { "Content-Type": "application/json" });
            res.end(JSON.stringify({
                success: isSuccess,
                seriesId,
                episodeNumber: epNum,
                jobId: currentJobId,
                result: finished.result,
                error: finished.error,
            }));
            return true;
        }
    }
    throw new HttpError(503, "DURABLE_QUEUE_REQUIRED");
    return true;
}
