import { approveEpisodeTake } from "../../../modules/production/index.js";
import type { IncomingMessage, ServerResponse } from "node:http";
import { z } from "zod";
import { readScopedJson } from "../scoped-request.js";
import { SeriesId } from "../../../contracts/requests.js";
import type { RouteContext, SendJson } from "./context.js";
export async function route17_approve(req: IncomingMessage, res: ServerResponse, url: URL, send: SendJson, ctx: Pick<RouteContext, "withBible" | "timeline">): Promise<boolean> {
    const approveMatch = url.pathname.match(/^\/api\/v1\/series\/([^/]+)\/episodes\/(\d+)\/shots\/([^/]+)\/approve$/);
    if (!(approveMatch && req.method === "POST"))
        return false;
    const id = SeriesId.parse(approveMatch[1]);
    const episode = z.number().int().positive().parse(Number(approveMatch[2]));
    const shotId = approveMatch[3];
    const body = z.object({ takeId: z.string().min(1), expectedQaReport: z.string().nullable().optional() }).parse(await readScopedJson(req, url));
    const approvedTake = await ctx.withBible(id, (bible) => approveEpisodeTake(bible, { body, id, episode, shotId }, ctx.timeline));
    send({ success: true, approvedTake });
    return true;
}
