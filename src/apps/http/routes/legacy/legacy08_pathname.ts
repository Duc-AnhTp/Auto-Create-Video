import { z } from 'zod';
import { type IncomingMessage, type ServerResponse } from "node:http";
import type { ServerRouteContext } from './context.js';
export async function legacy08_pathname(req: IncomingMessage, res: ServerResponse, url: URL, ctx: Pick<ServerRouteContext, "parseJsonBody" | "settingsManager">): Promise<boolean> {
    const pathname = url.pathname;
    if (!(pathname === "/api/settings/test-connection" && req.method === "POST"))
        return false;
    const body = z.object({ providerId: z.string(), credentials: z.record(z.string(), z.string()).optional() }).passthrough().parse(await ctx.parseJsonBody(req));
    const result = await ctx.settingsManager.probeProvider(body.providerId, body.credentials);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(result));
    return true;
}
