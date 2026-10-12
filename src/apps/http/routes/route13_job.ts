import type { IncomingMessage, ServerResponse } from "node:http";
import type { RouteContext, SendJson } from "./context.js";
export async function route13_job(req: IncomingMessage, res: ServerResponse, url: URL, send: SendJson, ctx: Pick<RouteContext, "store" | "startWorker">): Promise<boolean> {
    const jobMatch = url.pathname.match(/^\/api\/v1\/jobs\/([a-f0-9-]+)(?:\/(pause|resume|cancel|retry|regenerate-audio))?$/);
    if (!(jobMatch && req.method === "POST" && jobMatch[2]))
        return false;
    send({ job: ctx.store.summary(ctx.store.control(jobMatch[1], jobMatch[2] as "pause" | "resume" | "cancel" | "retry" | "regenerate-audio")) });
    ctx.startWorker();
    return true;
}
