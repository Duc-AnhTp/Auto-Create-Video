import { listStoryBranches } from "../../../modules/story/index.js";
import type { IncomingMessage, ServerResponse } from "node:http";
import { SeriesId } from "../../../contracts/requests.js";
import type { RouteContext, SendJson } from "./context.js";
export async function route19_branches(req: IncomingMessage, res: ServerResponse, url: URL, send: SendJson, ctx: Pick<RouteContext, "withBible">): Promise<boolean> {
    const branchesMatch = url.pathname.match(/^\/api\/v1\/series\/([^/]+)\/branches$/);
    if (!(branchesMatch && req.method === "GET"))
        return false;
    const id = SeriesId.parse(branchesMatch[1]);
    const branches = await ctx.withBible(id, (bible) => listStoryBranches(bible, { id }));
    send({ success: true, branches });
    return true;
}
