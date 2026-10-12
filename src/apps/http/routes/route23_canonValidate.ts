import { validateEpisodeCanon } from "../../../modules/story/index.js";
import type { IncomingMessage, ServerResponse } from "node:http";
import { z } from "zod";
import { readScopedJson } from "../scoped-request.js";
import { SeriesId } from "../../../contracts/requests.js";
import type { RouteContext, SendJson } from "./context.js";
export async function route23_canonValidate(req: IncomingMessage, res: ServerResponse, url: URL, send: SendJson, ctx: Pick<RouteContext, "withBible">): Promise<boolean> {
    const canonValidateMatch = url.pathname.match(/^\/api\/v1\/series\/([^/]+)\/episodes\/(\d+)\/canon\/validate$/);
    if (!(canonValidateMatch && req.method === "POST"))
        return false;
    const id = SeriesId.parse(canonValidateMatch[1]);
    const episode = z.number().int().positive().parse(Number(canonValidateMatch[2]));
    const body = z.object({ scriptText: z.string() }).parse(await readScopedJson(req, url));
    const report = await ctx.withBible(id, (bible) => validateEpisodeCanon(bible, { body, id, episode }));
    send({ success: true, report });
    return true;
}
