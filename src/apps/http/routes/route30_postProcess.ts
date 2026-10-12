import type { IncomingMessage, ServerResponse } from "node:http";
import { readScopedJson } from "../scoped-request.js";
import { SeriesId } from "../../../contracts/requests.js";
import type { RouteContext, SendJson } from "./context.js";
export async function route30_postProcess(req: IncomingMessage, res: ServerResponse, url: URL, send: SendJson, ctx: Pick<RouteContext, "mediaJobs" | "startWorker" | "store">): Promise<boolean> {
    const postProcessMatch = url.pathname.match(/^\/api\/v1\/series\/([^/]+)\/cinematic-post\/process$/);
    if (!(postProcessMatch && req.method === "POST"))
        return false;
    const id = SeriesId.parse(postProcessMatch[1]);
    ctx.store.assertSeriesAvailable(id);
    const job = await ctx.mediaJobs.enqueueLegacy(id, await readScopedJson(req, url));
    ctx.startWorker();
    send({ success: true, jobId: job.id, job: ctx.store.summary(job) }, 202);
    return true;
}
