import { type IncomingMessage, type ServerResponse } from "node:http";
import type { ServerRouteContext } from './context.js';
export async function legacy05_sseMatch(req: IncomingMessage, res: ServerResponse, url: URL, ctx: Pick<ServerRouteContext, "handleSseConnection">): Promise<boolean> {
    const pathname = url.pathname;
    const sseMatch = pathname.match(/^\/api\/series\/([^/]+)\/episodes\/(\d+)\/events$/);
    if (!(sseMatch && req.method === "GET"))
        return false;
    const seriesId = sseMatch[1];
    const epNum = parseInt(sseMatch[2], 10);
    ctx.handleSseConnection(req, res, seriesId, epNum);
    return true;
}
