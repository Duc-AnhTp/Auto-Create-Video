import { log } from '../../../platform/observability/logger.js';
import { readFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { ProjectPaths } from "../../../platform/filesystem/project-paths.js";
import { z } from "zod";
import { sceneLightingMatcher_harmonizeScene } from "../../../modules/media/index.js";
import { UnifiedTimelineSchema } from "../../../contracts/timeline.js";
import { readScopedJson } from "../scoped-request.js";
import { SeriesId } from "../../../contracts/requests.js";
import type { RouteContext, SendJson } from "./context.js";
export async function route42_sceneLighting(req: IncomingMessage, res: ServerResponse, url: URL, send: SendJson, ctx: Pick<RouteContext, never>): Promise<boolean> {
    const sceneLightingMatch = url.pathname.match(/^\/api\/(?:v1\/)?series\/([^/]+)\/scenes\/([^/]+)\/lighting\/harmonize$/);
    if (!(sceneLightingMatch && req.method === "POST"))
        return false;
    const id = SeriesId.parse(sceneLightingMatch[1]);
    const sceneId = sceneLightingMatch[2];
    const body = z
        .object({
        episodeNumber: z.number().int().positive().optional().default(1),
        targetEnvironmentPreset: z
            .enum(["golden_hour", "daylight_overcast", "cyberpunk_night", "interior_candle", "studio_commercial"])
            .optional()
            .default("golden_hour"),
        keyLightAzimuthDeg: z.number().optional().default(45),
        keyLightElevationDeg: z.number().optional().default(25),
        masterShotId: z.string().optional(),
        shots: z
            .array(z.object({
            shotId: z.string(),
            shotType: z.any().optional(),
            clipPath: z.string().optional(),
            measuredCct: z.number().optional(),
            averageRgb: z.tuple([z.number(), z.number(), z.number()]).optional(),
        }))
            .optional(),
    })
        .parse(await readScopedJson(req, url));
    let shotsToHarmonize = body.shots;
    // If shots not passed in body, attempt to load from episode timeline or construct representative coverage
    if (!shotsToHarmonize || shotsToHarmonize.length === 0) {
        const timelinePath = new ProjectPaths().episodeTimeline(id, body.episodeNumber);
        if (timelinePath) {
            try {
                const tl = UnifiedTimelineSchema.parse(JSON.parse(readFileSync(timelinePath, "utf-8")));
                shotsToHarmonize = tl.videoTrack.map((v) => ({
                    shotId: v.shotId,
                    shotType: v.shotType as any,
                    clipPath: v.approvedClipPath,
                }));
            }
            catch (caughtError) {
                log.warn("[route42_sceneLighting] " + String(caughtError));
            }
        }
        if (!shotsToHarmonize || shotsToHarmonize.length === 0) {
            // Default 5-shot coverage representation
            shotsToHarmonize = [
                { shotId: `${sceneId}_shot_1`, shotType: "establishing", averageRgb: [180, 140, 95] },
                { shotId: `${sceneId}_shot_2`, shotType: "two_shot", averageRgb: [175, 138, 98] },
                { shotId: `${sceneId}_shot_3`, shotType: "ots_a_b", averageRgb: [165, 145, 120] },
                { shotId: `${sceneId}_shot_4`, shotType: "ots_b_a", averageRgb: [170, 142, 115] },
                { shotId: `${sceneId}_shot_5`, shotType: "close_up", averageRgb: [160, 130, 90] },
            ];
        }
    }
    const result = sceneLightingMatcher_harmonizeScene({
        sceneId,
        masterShotId: body.masterShotId,
        shots: shotsToHarmonize,
        targetEnvironmentPreset: body.targetEnvironmentPreset as any,
        keyLightAzimuthDeg: body.keyLightAzimuthDeg,
        keyLightElevationDeg: body.keyLightElevationDeg,
    });
    send({ success: true, result });
    return true;
}
