import type { IncomingMessage, ServerResponse } from "node:http";
import { join, resolve } from "node:path";
import { containedPath } from "../../../platform/filesystem/containment.js";
import { readScopedJson } from "../scoped-request.js";
import { ProductionRequestSchema } from "../../../contracts/requests.js";
import type { RouteContext, SendJson } from "./context.js";
export async function route02_jobs(req: IncomingMessage, res: ServerResponse, url: URL, send: SendJson, ctx: Pick<RouteContext, "mediaJobs" | "store" | "startWorker">): Promise<boolean> {
    if (!(url.pathname === "/api/v1/jobs" && req.method === "POST"))
        return false;
    const input = ProductionRequestSchema.parse(await readScopedJson(req, url));
    const root = resolve("data");
    containedPath(root, join(root, "series", input.seriesId));
    ctx.store.assertSeriesAvailable(input.seriesId);
    const job = input.kind === "postprocess" ? await ctx.mediaJobs.enqueue(input) : ctx.store.enqueue(input);
    ctx.startWorker();
    send({ jobId: job.id, job: ctx.store.summary(job) }, 202);
    return true;
}
