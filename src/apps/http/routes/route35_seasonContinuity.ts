import { readSeasonContinuity } from "../../../modules/production/index.js";
import type { IncomingMessage, ServerResponse } from "node:http";
import { SeriesId } from "../../../contracts/requests.js";
import type { RouteContext, SendJson } from "./context.js";
export async function route35_seasonContinuity(req: IncomingMessage, res: ServerResponse, url: URL, send: SendJson, ctx: Pick<RouteContext, "withBible">): Promise<boolean> {
    const seasonContinuityMatch = url.pathname.match(/^\/api\/(?:v1\/)?series\/([^/]+)\/season\/continuity$/);
    if (!(seasonContinuityMatch && req.method === "GET"))
        return false;
    const id = SeriesId.parse(seasonContinuityMatch[1]);
    const epParam = url.searchParams.get("episodeNumber");
    const epNum = epParam ? parseInt(epParam, 10) : 1;
    const continuity = await ctx.withBible(id, (bible) => readSeasonContinuity(bible, { id, epNum }));
    send({ success: true, continuity });
    return true;
}
