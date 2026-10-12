import { type IncomingMessage, type ServerResponse } from "node:http";
import type { ServerRouteContext } from './context.js';
export async function legacy04_pathname(req: IncomingMessage, res: ServerResponse, url: URL, ctx: Pick<ServerRouteContext, "handleMediaStream">): Promise<boolean> {
    const pathname = url.pathname;
    if (!(pathname === "/api/media/stream"))
        return false;
    await ctx.handleMediaStream(req, res, url);
    return true;
}
