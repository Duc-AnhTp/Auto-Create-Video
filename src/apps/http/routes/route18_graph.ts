import { readNarrativeGraph } from "../../../modules/story/index.js";
import type { IncomingMessage, ServerResponse } from "node:http";
import { SeriesId } from "../../../contracts/requests.js";
import type { RouteContext, SendJson } from "./context.js";
export async function route18_graph(req: IncomingMessage, res: ServerResponse, url: URL, send: SendJson, ctx: Pick<RouteContext, "withBible">): Promise<boolean> {
    const graphMatch = url.pathname.match(/^\/api\/v1\/series\/([^/]+)\/narrative-graph$/);
    if (!(graphMatch && req.method === "GET"))
        return false;
    const id = SeriesId.parse(graphMatch[1]);
    const result = await ctx.withBible(id, (bible) => readNarrativeGraph(bible, { id }));
    send({ success: true, ...result });
    return true;
}
