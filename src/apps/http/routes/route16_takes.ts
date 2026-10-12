import { listEpisodeTakes } from "../../../modules/story/index.js";
import type { IncomingMessage, ServerResponse } from "node:http";
import { z } from "zod";
import { SeriesId } from "../../../contracts/requests.js";
import type { RouteContext, SendJson } from "./context.js";
export async function route16_takes(req: IncomingMessage, res: ServerResponse, url: URL, send: SendJson, ctx: Pick<RouteContext, "withBible">): Promise<boolean> {
    const takesMatch = url.pathname.match(/^\/api\/v1\/series\/([^/]+)\/episodes\/(\d+)\/takes$/);
    if (!(takesMatch && req.method === "GET"))
        return false;
    const id = SeriesId.parse(takesMatch[1]);
    const episode = z.number().int().positive().parse(Number(takesMatch[2]));
    const shotId = url.searchParams.get("shotId") || undefined;
    const takes = await ctx.withBible(id, (bible) => listEpisodeTakes(bible, { id, episode, shotId }));
    send({ takes });
    return true;
}
