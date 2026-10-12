import { saveProp } from "../../../../modules/story/index.js";
import { z } from 'zod';
import { type IncomingMessage, type ServerResponse } from "node:http";
import type { ServerRouteContext } from './context.js';
export async function legacy14_propMatch(req: IncomingMessage, res: ServerResponse, url: URL, ctx: Pick<ServerRouteContext, "parseJsonBody" | "openStore">): Promise<boolean> {
    const pathname = url.pathname;
    const propMatch = pathname.match(/^\/api\/series\/([^/]+)\/props$/);
    if (!(propMatch && req.method === "POST"))
        return false;
    const seriesId = propMatch[1];
    const body = z.object({ id: z.string().min(1), name: z.string().min(1), current_holder_id: z.string().optional(), description: z.string().optional() }).passthrough().parse(await ctx.parseJsonBody(req));
    const prop = await ctx.openStore(`data/series/${seriesId}/story_bible.db`, (bible) => saveProp(bible, { body, seriesId }));
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ success: true, prop }));
    return true;
}
