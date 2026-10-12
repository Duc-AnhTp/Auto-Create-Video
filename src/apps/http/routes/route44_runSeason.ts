import { existsSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { join } from "node:path";
import { z } from "zod";
import { MultiEpisodeRunner } from "../../../bootstrap/multi-episode-runtime.js";
import { HttpError } from "../../../platform/errors.js";
import { readScopedJson } from "../scoped-request.js";
import { SeriesId } from "../../../contracts/requests.js";
import type { RouteContext, SendJson } from "./context.js";
export async function route44_runSeason(req: IncomingMessage, res: ServerResponse, url: URL, send: SendJson, ctx: Pick<RouteContext, never>): Promise<boolean> {
    const runSeasonMatch = url.pathname.match(/^\/api\/(?:v1\/)?series\/([^/]+)\/season\/(?:run-production|demo)$/);
    if (!(runSeasonMatch && req.method === "POST"))
        return false;
    if (!url.pathname.endsWith("/demo"))
        throw new HttpError(409, "USE_DURABLE_SEASON_QUEUE", "Dùng season/run cho sản xuất thật hoặc season/demo cho mô phỏng.");
    const id = SeriesId.parse(runSeasonMatch[1]);
    const body = z
        .object({
        totalEpisodes: z.number().int().min(1).max(20).default(5),
        fromEpisode: z.number().int().min(1).default(1),
        toEpisode: z.number().int().min(1).optional(),
        seasonBudgetUsd: z.number().positive().default(100.0),
        enable4kPost: z.boolean().default(true),
        enableLightingHarmonization: z.boolean().default(true),
        enableEmotionalVoice: z.boolean().default(true),
        enableLipSync: z.boolean().default(true),
        generateSeasonTrailer: z.boolean().default(true),
        trailerTargetDurationSec: z.union([z.literal(30), z.literal(60), z.literal(90)]).default(60),
        trailerTagline: z.string().optional(),
    })
        .refine((data) => data.fromEpisode <= (data.toEpisode ?? data.totalEpisodes), {
            message: "fromEpisode must not exceed toEpisode or totalEpisodes",
        })
        .parse(await readScopedJson(req, url));
    const biblePath = join("data", "series", id, "story_bible.db");
    const runner = new MultiEpisodeRunner(existsSync(biblePath) ? biblePath : ":memory:");
    try {
        const manifest = await runner.runSeason({
            seriesId: id,
            mockVideo: true,
            totalEpisodes: body.totalEpisodes,
            fromEpisode: body.fromEpisode,
            toEpisode: body.toEpisode || body.totalEpisodes,
            seasonBudgetUsd: body.seasonBudgetUsd,
            outputBaseDir: join("data", "series", id, "season_production"),
            enable4kPost: body.enable4kPost,
            enableLightingHarmonization: body.enableLightingHarmonization,
            enableEmotionalVoice: body.enableEmotionalVoice,
            enableLipSync: body.enableLipSync,
            generateSeasonTrailer: body.generateSeasonTrailer,
            trailerTargetDurationSec: body.trailerTargetDurationSec,
            trailerTagline: body.trailerTagline,
        });
        send({ success: true, manifest });
        return true;
    }
    finally {
        runner.close();
    }
}
