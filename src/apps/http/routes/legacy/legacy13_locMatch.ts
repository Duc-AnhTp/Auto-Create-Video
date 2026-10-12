import { saveLocation } from "../../../../modules/story/index.js";
import { z } from 'zod';
import { type IncomingMessage, type ServerResponse } from "node:http";
import type { ServerRouteContext } from './context.js';
export async function legacy13_locMatch(req: IncomingMessage, res: ServerResponse, url: URL, ctx: Pick<ServerRouteContext, "parseJsonBody" | "openStore">): Promise<boolean> {
    const pathname = url.pathname;
    const locMatch = pathname.match(/^\/api\/series\/([^/]+)\/locations$/);
    if (!(locMatch && req.method === "POST"))
        return false;
    const seriesId = locMatch[1];
    const body = z.object({ id: z.string().min(1), name: z.string().min(1), visual_summary: z.string().optional(), lighting_mood: z.string().optional(), atmospheric_rules: z.string().optional(), reference_image_path: z.string().optional() }).passthrough().parse(await ctx.parseJsonBody(req));
    const location = await ctx.openStore(`data/series/${seriesId}/story_bible.db`, (bible) => saveLocation(bible, { body, seriesId }));
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ success: true, location }));
    return true;
}
