import { type IncomingMessage, type ServerResponse } from "node:http";
import type { ServerRouteContext } from './context.js';
export async function legacy11_bibleMatch(req: IncomingMessage, res: ServerResponse, url: URL, ctx: Pick<ServerRouteContext, "catalog">): Promise<boolean> {
    const pathname = url.pathname;
    const bibleMatch = pathname.match(/^\/api\/series\/([^/]+)\/bible$/);
    if (!(bibleMatch && req.method === "GET"))
        return false;
    const seriesId = bibleMatch[1];
    const data = await ctx.catalog.getSeriesBibleData(seriesId);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(data));
    return true;
}
