import type { IncomingMessage, ServerResponse } from "node:http";
import { ManualReconciliationSchema, reconcileManually } from "../../../modules/production/index.js";
import { readScopedJson } from "../scoped-request.js";
import { SeriesId } from "../../../contracts/requests.js";
import type { RouteContext, SendJson } from "./context.js";
export async function route32_manual(req: IncomingMessage, res: ServerResponse, url: URL, send: SendJson, ctx: Pick<RouteContext, "withBible" | "dispatchStore">): Promise<boolean> {
    const manualMatch = url.pathname.match(/^\/api\/v1\/series\/([^/]+)\/reconciliation$/);
    if (!(manualMatch && req.method === "POST"))
        return false;
    const id = SeriesId.parse(manualMatch[1]), body = ManualReconciliationSchema.parse(await readScopedJson(req, url));
    const job = await ctx.withBible(id, bible => reconcileManually(bible, ctx.dispatchStore, id, body));
    send({ job });
    return true;
}
