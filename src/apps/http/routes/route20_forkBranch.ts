import { forkStoryBranch } from "../../../modules/story/index.js";
import type { IncomingMessage, ServerResponse } from "node:http";
import { z } from "zod";
import { readScopedJson } from "../scoped-request.js";
import { SeriesId } from "../../../contracts/requests.js";
import type { RouteContext, SendJson } from "./context.js";
export async function route20_forkBranch(req: IncomingMessage, res: ServerResponse, url: URL, send: SendJson, ctx: Pick<RouteContext, "withBible">): Promise<boolean> {
    const forkBranchMatch = url.pathname.match(/^\/api\/v1\/series\/([^/]+)\/branches\/fork$/);
    if (!(forkBranchMatch && req.method === "POST"))
        return false;
    const id = SeriesId.parse(forkBranchMatch[1]);
    const body = z.object({
        name: z.string().min(1),
        description: z.string().optional(),
        parentBranchId: z.string().optional(),
        fromSnapshotId: z.string().optional(),
        fromEpisodeNumber: z.number().int().positive().optional(),
    }).parse(await readScopedJson(req, url));
    const branch = await ctx.withBible(id, (bible) => forkStoryBranch(bible, { id, body }));
    send({ success: true, branch }, 201);
    return true;
}
