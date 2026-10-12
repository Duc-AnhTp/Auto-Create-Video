import { querySemanticMemory } from "../../../modules/story/index.js";
import type { IncomingMessage, ServerResponse } from "node:http";
import { z } from "zod";
import { readScopedJson } from "../scoped-request.js";
import { SeriesId } from "../../../contracts/requests.js";
import type { RouteContext, SendJson } from "./context.js";
export async function route25_semanticMemory(req: IncomingMessage, res: ServerResponse, url: URL, send: SendJson, ctx: Pick<RouteContext, "withBible">): Promise<boolean> {
    const semanticMemoryMatch = url.pathname.match(/^\/api\/v1\/series\/([^/]+)\/episodes\/(\d+)\/semantic-memory\/query$/);
    if (!(semanticMemoryMatch && req.method === "POST"))
        return false;
    const id = SeriesId.parse(semanticMemoryMatch[1]);
    const episode = z.number().int().positive().parse(Number(semanticMemoryMatch[2]));
    const body = z.object({
        queryText: z.string(),
        topK: z.number().int().positive().optional(),
        tokenBudget: z.number().int().positive().optional(),
    }).parse(await readScopedJson(req, url));
    const result = await ctx.withBible(id, (bible) => querySemanticMemory(bible, { id, episode, body }));
    send({ success: true, ...result });
    return true;
}
