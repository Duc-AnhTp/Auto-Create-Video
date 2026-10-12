import { repairEpisodeCanon } from "../../../modules/story/index.js";
import type { IncomingMessage, ServerResponse } from "node:http";
import { z } from "zod";
import { readScopedJson } from "../scoped-request.js";
import { SeriesId } from "../../../contracts/requests.js";
import type { RouteContext, SendJson } from "./context.js";
export async function route24_canonRepair(req: IncomingMessage, res: ServerResponse, url: URL, send: SendJson, ctx: Pick<RouteContext, "withBible">): Promise<boolean> {
    const canonRepairMatch = url.pathname.match(/^\/api\/v1\/series\/([^/]+)\/episodes\/(\d+)\/canon\/repair$/);
    if (!(canonRepairMatch && req.method === "POST"))
        return false;
    const id = SeriesId.parse(canonRepairMatch[1]);
    const episode = z.number().int().positive().parse(Number(canonRepairMatch[2]));
    const body = z.object({
        scriptText: z.string(),
        persistToBible: z.boolean().optional(),
    }).parse(await readScopedJson(req, url));
    const result = await ctx.withBible(id, (bible) => repairEpisodeCanon(bible, { body, id, episode }));
    send({ success: true, result });
    return true;
}
