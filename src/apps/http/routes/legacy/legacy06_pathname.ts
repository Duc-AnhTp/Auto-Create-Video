import { type IncomingMessage, type ServerResponse } from "node:http";
import type { ServerRouteContext } from './context.js';
export async function legacy06_pathname(req: IncomingMessage, res: ServerResponse, url: URL, ctx: Pick<ServerRouteContext, "settingsManager">): Promise<boolean> {
    const pathname = url.pathname;
    if (!(pathname === "/api/settings/models" && req.method === "GET"))
        return false;
    const providers = ctx.settingsManager.getProviders();
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ success: true, providers }));
    return true;
}
