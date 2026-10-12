import type { IncomingMessage, ServerResponse } from "node:http";
import type { RouteContext, SendJson } from "./context.js";
export async function route12_job(req: IncomingMessage, res: ServerResponse, url: URL, send: SendJson, ctx: Pick<RouteContext, "store">): Promise<boolean> {
    const jobMatch = url.pathname.match(/^\/api\/v1\/jobs\/([a-f0-9-]+)(?:\/(pause|resume|cancel|retry|regenerate-audio))?$/);
    if (!(jobMatch && req.method === "GET" && !jobMatch[2]))
        return false;
    send({ job: ctx.store.getSummary(jobMatch[1]) });
    return true;
}
