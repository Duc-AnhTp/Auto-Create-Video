import { prepareSeasonRequest } from "../../../modules/production/index.js";
import { existsSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { join, resolve } from "node:path";
import { z } from "zod";
import { containedPath } from "../../../platform/filesystem/containment.js";
import { HttpError } from "../../../platform/errors.js";
import { readScopedJson } from "../scoped-request.js";
import { EpisodeSeasonRequestSchema, SeriesId } from "../../../contracts/requests.js";
import type { RouteContext, SendJson } from "./context.js";
export async function route36_seasonRun(req: IncomingMessage, res: ServerResponse, url: URL, send: SendJson, ctx: Pick<RouteContext, "withBible" | "store" | "startWorker">): Promise<boolean> {
    const seasonRunMatch = url.pathname.match(/^\/api\/(?:v1\/)?series\/([^/]+)\/season\/run$/);
    if (!(seasonRunMatch && req.method === "POST"))
        return false;
    const id = SeriesId.parse(seasonRunMatch[1]);
    const body = z.object({
        planId: z.string().min(1).optional(), fromEpisode: z.number().int().positive().default(1),
        toEpisode: z.number().int().positive().optional(), totalEpisodes: z.number().int().min(1).max(24).optional(),
        provider: EpisodeSeasonRequestSchema.shape.provider.optional(),
        hedge: EpisodeSeasonRequestSchema.shape.hedge,
        mode: z.enum(["mock", "production"]), seasonBudgetUsd: z.number().finite().positive().optional(),
        approvalPolicy: z.enum(["auto_qa", "manual"]).default("auto_qa"), resume: z.boolean().default(true),
        enable4kPost: z.boolean().optional(), enableAutoBridge: z.boolean().optional(), customChapterTitles: z.array(z.string()).optional(),
    }).strict().parse(await readScopedJson(req, url));
    const dbDir = resolve("data", "series", id);
    containedPath(resolve("data"), dbDir);
    ctx.store.assertSeriesAvailable(id);
    if (!existsSync(join(dbDir, "story_bible.db")))
        throw new HttpError(404, "PLAN_REQUIRED");
    const input = EpisodeSeasonRequestSchema.parse({
        kind: "season", seriesId: id, provider: body.provider, mode: body.mode,
        budgetCapUsd: body.seasonBudgetUsd, resume: body.resume, hedge: body.hedge,
        season: { planId: body.planId, fromEpisode: body.fromEpisode, toEpisode: body.toEpisode ?? body.totalEpisodes ?? 5, approvalPolicy: body.approvalPolicy },
    });
    await ctx.withBible(id, (bible) => prepareSeasonRequest(bible, { id, body, input }));
    const job = ctx.store.enqueue(input);
    ctx.startWorker();
    send({ success: true, jobId: job.id, job }, 202);
    return true;
}
