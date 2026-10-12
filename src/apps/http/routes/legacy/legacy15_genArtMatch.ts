import { generateConceptArt } from "../../../../modules/production/index.js";
import { z } from 'zod';
import { type IncomingMessage, type ServerResponse } from "node:http";
import { SeriesId } from "../../../../contracts/requests.js";
import type { ServerRouteContext } from './context.js';
export async function legacy15_genArtMatch(req: IncomingMessage, res: ServerResponse, url: URL, ctx: Pick<ServerRouteContext, "parseJsonBody" | "openStore">): Promise<boolean> {
    const pathname = url.pathname;
    const genArtMatch = pathname.match(/^\/api\/series\/([^/]+)\/gen-art$/);
    if (!(genArtMatch && req.method === "POST"))
        return false;
    const seriesId = SeriesId.parse(genArtMatch[1]);
    const body = z.object({ allowMock: z.boolean().optional(), type: z.enum(["character", "location"]).optional(), id: z.string().min(1), promptOverride: z.string().optional(), provider: z.enum(["mock", "local_comfyui", "cloud"]).optional() }).passthrough().parse(await ctx.parseJsonBody(req));
    const allowMock = body.allowMock !== undefined ? Boolean(body.allowMock) : true;
    const result = await ctx.openStore(`data/series/${seriesId}/story_bible.db`, (bible) => generateConceptArt(bible, { body, seriesId, allowMock }));
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ success: true, result }));
    return true;
}
