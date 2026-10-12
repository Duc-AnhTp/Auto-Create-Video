import { activateStoryBranch } from "../../../modules/story/index.js";
import type { IncomingMessage, ServerResponse } from "node:http";
import { SeriesId } from "../../../contracts/requests.js";
import type { RouteContext, SendJson } from "./context.js";
export async function route22_activateBranch(req: IncomingMessage, res: ServerResponse, url: URL, send: SendJson, ctx: Pick<RouteContext, "withBible">): Promise<boolean> {
    const activateBranchMatch = url.pathname.match(/^\/api\/v1\/series\/([^/]+)\/branches\/([^/]+)\/activate$/);
    if (!(activateBranchMatch && req.method === "POST"))
        return false;
    const id = SeriesId.parse(activateBranchMatch[1]);
    const branchId = activateBranchMatch[2];
    await ctx.withBible(id, (bible) => activateStoryBranch(bible, { id, branchId }));
    send({ success: true, activeBranchId: branchId });
    return true;
}
