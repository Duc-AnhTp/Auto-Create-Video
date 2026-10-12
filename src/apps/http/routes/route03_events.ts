import type { IncomingMessage, ServerResponse } from "node:http";
import { HttpError } from "../../../platform/errors.js";
import type { RouteContext, SendJson } from "./context.js";
export async function route03_events(req: IncomingMessage, res: ServerResponse, url: URL, send: SendJson, ctx: Pick<RouteContext, "store" | "streams" | "timers">): Promise<boolean> {
    if (!((url.pathname === "/api/v1/events" || url.pathname === "/api/events" || url.pathname === "/api/v1/events/live") && req.method === "GET"))
        return false;
    let cursor = Number(req.headers["last-event-id"] || url.searchParams.get("after") || 0);
    if (!Number.isSafeInteger(cursor) || cursor < 0)
        throw new HttpError(400, "INVALID_CURSOR");
    let timer: ReturnType<typeof setInterval> | undefined;
    let closed = false;
    const cleanup = () => {
        if (closed) return;
        closed = true;
        if (timer) { clearInterval(timer); ctx.timers.delete(timer); }
        ctx.streams.delete(res);
        req.off("close", cleanup);
        res.off("close", cleanup);
        req.off("error", fail);
        res.off("error", fail);
    };
    const fail = () => { cleanup(); try { res.destroy(); } catch { /* Already failed transport. */ } };
    const flush = () => {
      try {
        if (closed) return;
        for (const event of ctx.store.events(cursor)) {
            res.write(`id: ${event.id}\nevent: job\ndata: ${JSON.stringify(event.job)}\n\n`);
            cursor = event.id;
        }
        res.write(": heartbeat\n\n");
      } catch {
        fail();
      }
    };
    req.on("close", cleanup);
    res.on("close", cleanup);
    req.on("error", fail);
    res.on("error", fail);
    ctx.streams.add(res);
    try {
      res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
      res.write(`event: snapshot\ndata: ${JSON.stringify({ jobs: ctx.store.list() })}\n\n`);
      flush();
      if (!closed) { timer = setInterval(flush, 1000); ctx.timers.add(timer); }
    } catch { fail(); }
    return true;
}
