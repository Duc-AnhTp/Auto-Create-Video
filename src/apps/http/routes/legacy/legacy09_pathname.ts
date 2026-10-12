import { type IncomingMessage, type ServerResponse } from "node:http";
import type { ServerRouteContext } from './context.js';
export async function legacy09_pathname(req: IncomingMessage, res: ServerResponse, url: URL, ctx: Pick<ServerRouteContext, "catalog">): Promise<boolean> {
    const pathname = url.pathname;
    if (!(pathname === "/api/series/list" && req.method === "GET"))
        return false;
    const list = await ctx.catalog.listAllSeries();
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ series: list }));
    return true;
}
