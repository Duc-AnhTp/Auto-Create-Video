import { countPendingSeriesJobs } from "../../../modules/story/index.js";
import type { IncomingMessage, ServerResponse } from "node:http";
import { z } from "zod";
import { HttpError } from "../../../platform/errors.js";
import { readScopedJson } from "../scoped-request.js";
import { SeriesId } from "../../../contracts/requests.js";
import type { RouteContext, SendJson } from "./context.js";
export async function route08_maintenance(req: IncomingMessage, res: ServerResponse, url: URL, send: SendJson, ctx: Pick<RouteContext, "projectMaintenance" | "store" | "dispatchStore" | "withBible">): Promise<boolean> {
    const maintenance = url.pathname.match(/^\/api\/v1\/series\/([^/]+)\/(backups|restore|usage)$/);
    if (!(maintenance))
        return false;
    const id = SeriesId.parse(maintenance[1]);
    if (req.method === "GET") {
        send(maintenance[2] === "usage" ? await ctx.projectMaintenance.usage(id) : await ctx.projectMaintenance.list(id));
        return true;
    }
    if (req.method !== "POST")
        throw new HttpError(405, "METHOD_NOT_ALLOWED");
    const ownership = ctx.dispatchStore.seriesCoordinator.beginMaintenance(id);
    try {
        const unresolved = await ctx.withBible(id, (bible) => countPendingSeriesJobs(bible, { id }), ownership.token);
        if (unresolved) throw new HttpError(409, "REMOTE_ATTEMPTS_ACTIVE");
        if (maintenance[2] === "backups")
            send(await ctx.projectMaintenance.backup(id));
        else if (maintenance[2] === "restore") {
            const body = z.object({ id: z.string().uuid() }).strict().parse(await readScopedJson(req, url));
            send(await ctx.projectMaintenance.restore(id, body.id));
        }
        else
            throw new HttpError(405, "METHOD_NOT_ALLOWED");
    }
    finally {
        ownership.release();
    }
    return true;
}
