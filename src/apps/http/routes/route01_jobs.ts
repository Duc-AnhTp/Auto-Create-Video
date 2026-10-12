import type { IncomingMessage, ServerResponse } from "node:http";
import type { RouteContext, SendJson } from "./context.js";
export async function route01_jobs(req: IncomingMessage, res: ServerResponse, url: URL, send: SendJson, ctx: Pick<RouteContext, "startWorker" | "store">): Promise<boolean> {
    if (!(url.pathname === "/api/v1/jobs" && req.method === "GET"))
        return false;
    ctx.startWorker();
    send({ jobs: ctx.store.list() });
    return true;
}
