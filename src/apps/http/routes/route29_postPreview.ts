import type { IncomingMessage, ServerResponse } from "node:http";
import { z } from "zod";
import { cdlGradingEngine_resolveCdl, cdlGradingEngine_transformRgbPixel, type CinematicPresetName } from "../../../modules/media/index.js";
import { readScopedJson } from "../scoped-request.js";
import type { RouteContext, SendJson } from "./context.js";
export async function route29_postPreview(req: IncomingMessage, res: ServerResponse, url: URL, send: SendJson, ctx: Pick<RouteContext, never>): Promise<boolean> {
    const postPreviewMatch = url.pathname.match(/^\/api\/v1\/series\/([^/]+)\/cinematic-post\/lut-preview$/);
    if (!(postPreviewMatch && req.method === "POST"))
        return false;
    const body = z
        .object({
        preset: z.string().optional(),
        customCdl: z
            .object({
            slope: z.tuple([z.number(), z.number(), z.number()]).optional(),
            offset: z.tuple([z.number(), z.number(), z.number()]).optional(),
            power: z.tuple([z.number(), z.number(), z.number()]).optional(),
            saturation: z.number().optional(),
        })
            .optional(),
    })
        .parse(await readScopedJson(req, url));
    const cdl = cdlGradingEngine_resolveCdl(body.preset as CinematicPresetName, body.customCdl as any);
    // Calculate test color patches
    const testSwatches = [
        { name: "Shadow (10% Grey)", rgb: [0.1, 0.1, 0.1] },
        { name: "Midtone (50% Grey)", rgb: [0.5, 0.5, 0.5] },
        { name: "Highlight (90% Grey)", rgb: [0.9, 0.9, 0.9] },
        { name: "Skin Tone (Warm)", rgb: [0.85, 0.65, 0.52] },
        { name: "Sky Cyan", rgb: [0.25, 0.65, 0.85] },
        { name: "Foliage Green", rgb: [0.2, 0.6, 0.25] },
    ];
    const preview = testSwatches.map((s) => {
        const [r, g, b] = cdlGradingEngine_transformRgbPixel(s.rgb[0], s.rgb[1], s.rgb[2], cdl);
        return {
            name: s.name,
            originalRgb: s.rgb,
            transformedRgb: [parseFloat(r.toFixed(3)), parseFloat(g.toFixed(3)), parseFloat(b.toFixed(3))],
        };
    });
    send({ success: true, cdl, preview });
    return true;
}
