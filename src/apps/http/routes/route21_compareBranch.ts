import { compareStoryBranches } from "../../../modules/story/index.js";
import type { IncomingMessage, ServerResponse } from "node:http";
import { HttpError } from "../../../platform/errors.js";
import { SeriesId } from "../../../contracts/requests.js";
import type { RouteContext, SendJson } from "./context.js";
export async function route21_compareBranch(req: IncomingMessage, res: ServerResponse, url: URL, send: SendJson, ctx: Pick<RouteContext, "withBible">): Promise<boolean> {
    const compareBranchMatch = url.pathname.match(/^\/api\/v1\/series\/([^/]+)\/branches\/compare$/);
    if (!(compareBranchMatch && req.method === "GET"))
        return false;
    const id = SeriesId.parse(compareBranchMatch[1]);
    const branchA = url.searchParams.get("branchA");
    const branchB = url.searchParams.get("branchB");
    if (!branchA || !branchB) {
        throw new HttpError(400, "MISSING_BRANCH_PARAMS");
    }
    const diff = await ctx.withBible(id, (bible) => compareStoryBranches(bible, { id, branchA, branchB }));
    send({ success: true, diff });
    return true;
}
