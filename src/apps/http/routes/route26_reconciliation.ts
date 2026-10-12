import { readProviderReconciliation } from "../../../modules/production/index.js";
import type { IncomingMessage, ServerResponse } from "node:http";
import { SeriesId } from "../../../contracts/requests.js";
import type { RouteContext, SendJson } from "./context.js";
export async function route26_reconciliation(req: IncomingMessage, res: ServerResponse, url: URL, send: SendJson, ctx: Pick<RouteContext, "withBible">): Promise<boolean> {
    const reconciliationMatch = url.pathname.match(/^\/api\/(?:v1\/)?series\/([^/]+)\/reconciliation$/);
    if (!(reconciliationMatch && req.method === "GET"))
        return false;
    const id = SeriesId.parse(reconciliationMatch[1]);
    const data = await ctx.withBible(id, (bible) => readProviderReconciliation(bible, { id }));
    send({ success: true, ...data });
    return true;
}
