import { z } from 'zod';
import { type IncomingMessage, type ServerResponse } from "node:http";
import type { ServerRouteContext } from './context.js';
export async function legacy07_pathname(req: IncomingMessage, res: ServerResponse, url: URL, ctx: Pick<ServerRouteContext, "parseJsonBody" | "settingsManager">): Promise<boolean> {
    const pathname = url.pathname;
    if (!(pathname === "/api/settings/models" && req.method === "POST"))
        return false;
    const body = z.object({ updates: z.record(z.string(), z.string()).optional() }).passthrough().parse(await ctx.parseJsonBody(req));
    if (body.updates && typeof body.updates === "object") {
        ctx.settingsManager.saveConfigUpdates(body.updates);
    }
    const providers = ctx.settingsManager.getProviders();
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ success: true, providers }));
    return true;
}
