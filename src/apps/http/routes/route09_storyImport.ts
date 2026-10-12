import type { IncomingMessage, ServerResponse } from "node:http";
import type { RouteContext, SendJson } from "./context.js";
export async function route09_storyImport(req: IncomingMessage, res: ServerResponse, url: URL, send: SendJson, ctx: Pick<RouteContext, "store">): Promise<boolean> {
    const storyImportMatch = url.pathname.match(/^\/api\/v1\/story-imports\/([a-f0-9-]+)$/i);
    if (!(storyImportMatch && req.method === "GET"))
        return false;
    send({ job: ctx.store.getStoryImportSummary(storyImportMatch[1]) });
    return true;
}
