import { generateScreenplay } from "../../../../modules/story/index.js";
import { z } from 'zod';
import { type IncomingMessage, type ServerResponse } from "node:http";
import type { ServerRouteContext } from './context.js';
export async function legacy16_genScriptMatch(req: IncomingMessage, res: ServerResponse, url: URL, ctx: Pick<ServerRouteContext, "parseJsonBody" | "openStore">): Promise<boolean> {
    const pathname = url.pathname;
    const genScriptMatch = pathname.match(/^\/api\/series\/([^/]+)\/script\/generate$/);
    if (!(genScriptMatch && req.method === "POST"))
        return false;
    const seriesId = genScriptMatch[1];
    const body = z.object({ prompt: z.string().optional(), storyText: z.string().optional(), episodeNumber: z.coerce.number().int().positive().optional(), targetScenes: z.number().int().positive().optional(), tone: z.string().optional() }).passthrough().parse(await ctx.parseJsonBody(req));
    const result = await ctx.openStore(`data/series/${seriesId}/story_bible.db`, (bible) => generateScreenplay(bible, { body, seriesId }));
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ success: true, result }));
    return true;
}
