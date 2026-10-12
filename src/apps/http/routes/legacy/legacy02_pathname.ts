import { type IncomingMessage, type ServerResponse } from "node:http";
import type { ServerRouteContext } from './context.js';
export async function legacy02_pathname(req: IncomingMessage, res: ServerResponse, url: URL, ctx: Pick<ServerRouteContext, never>): Promise<boolean> {
    const pathname = url.pathname;
    if (!(pathname === "/health"))
        return false;
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok", uptime: process.uptime(), timestamp: new Date().toISOString() }));
    return true;
}
