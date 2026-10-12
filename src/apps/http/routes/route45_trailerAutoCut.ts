import { log } from '../../../platform/observability/logger.js';
import { existsSync, readFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { join, resolve } from "node:path";
import { z } from "zod";
import { containedPath } from "../../../platform/filesystem/containment.js";
import { SeasonTrailerAutoCutter } from "../../../modules/media/index.js";
import { readScopedJson } from "../scoped-request.js";
import { SeriesId } from "../../../contracts/requests.js";
import type { RouteContext, SendJson } from "./context.js";
export async function route45_trailerAutoCut(req: IncomingMessage, res: ServerResponse, url: URL, send: SendJson, ctx: Pick<RouteContext, never>): Promise<boolean> {
    const trailerAutoCutMatch = url.pathname.match(/^\/api\/(?:v1\/)?series\/([^/]+)\/season\/trailer\/auto-cut$/);
    if (!(trailerAutoCutMatch && req.method === "POST"))
        return false;
    const id = SeriesId.parse(trailerAutoCutMatch[1]);
    const body = z
        .object({
        targetDurationSec: z.union([z.literal(30), z.literal(60), z.literal(90)]).default(60),
        seriesTitle: z.string().optional(),
        tagline: z.string().optional(),
        musicStyle: z.string().optional(),
    })
        .parse(await readScopedJson(req, url));
    const manifestPath = join("data", "series", id, "season_production", "season_manifest.json");
    let candidates: any[] = [];
    if (existsSync(manifestPath)) {
        try {
            const sManifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
            candidates = SeasonTrailerAutoCutter.extractCandidatesFromEpisodes(sManifest.episodes || []);
        }
        catch (caughtError) {
            log.warn("[route45_trailerAutoCut] " + String(caughtError));
        }
    }
    if (candidates.length === 0) {
        // Synthetic candidates across 5 episodes
        candidates = SeasonTrailerAutoCutter.extractCandidatesFromEpisodes([
            { episodeNumber: 1, tensionScore: 0.35, title: "Tập 1: Bắt Đầu", act: "act_1_setup" },
            { episodeNumber: 2, tensionScore: 0.55, title: "Tập 2: Đối Đầu", act: "act_2a_rising" },
            { episodeNumber: 3, tensionScore: 0.85, title: "Tập 3: Khúc Quanh", act: "midpoint_reversal" },
            { episodeNumber: 4, tensionScore: 0.75, title: "Tập 4: Tuyệt Vọng", act: "all_is_lost" },
            { episodeNumber: 5, tensionScore: 1.00, title: "Tập 5: Đại Chiến", act: "act_3_climax" },
        ]);
    }
    const outputDir = resolve("data", "series", id, "season_production", "season_trailer");
    containedPath(resolve("data"), outputDir);
    const trailerResult = await SeasonTrailerAutoCutter.generateSeasonTrailer(candidates, {
        seriesId: id,
        seriesTitle: body.seriesTitle || `Series ${id}`,
        tagline: body.tagline || "Định Mệnh Không Thể Đảo Ngược",
        targetDurationSec: body.targetDurationSec,
        outputDir,
        mockVideo: true,
    });
    send({ success: true, trailer: trailerResult });
    return true;
}
