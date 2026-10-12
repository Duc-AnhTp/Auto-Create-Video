import { generateReferenceConcept } from "../../../modules/production/index.js";
import type { IncomingMessage, ServerResponse } from "node:http";
import { z } from "zod";
import { readScopedJson } from "../scoped-request.js";
import { SeriesId } from "../../../contracts/requests.js";
import type { RouteContext, SendJson } from "./context.js";
export async function route33_concept(req: IncomingMessage, res: ServerResponse, url: URL, send: SendJson, ctx: Pick<RouteContext, "withBible">): Promise<boolean> {
    const conceptMatch = url.pathname.match(/^\/api\/v1\/series\/([^/]+)\/references\/generate$/);
    if (!(conceptMatch && req.method === "POST"))
        return false;
    const id = SeriesId.parse(conceptMatch[1]), body = z.object({ entityId: z.string().regex(/^[a-zA-Z0-9_-]+$/), entityType: z.enum(["character", "location"]), provider: z.enum(["mock", "cloud", "local_comfyui"]), turnaround: z.boolean().default(false) }).strict().parse(await readScopedJson(req, url));
    const result = await ctx.withBible(id, (bible) => generateReferenceConcept(bible, { body, id }));
    send({ result });
    return true;
}
