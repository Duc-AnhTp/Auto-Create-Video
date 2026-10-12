import type { IncomingMessage, ServerResponse } from "node:http";
import { z } from "zod";
import { HttpError } from "../../../platform/errors.js";
import { readScopedJson } from "../scoped-request.js";
import { DraftSchema, SeriesId } from "../../../contracts/requests.js";
import type { RouteContext, SendJson } from "./context.js";
export async function route14_draft(req: IncomingMessage, res: ServerResponse, url: URL, send: SendJson, ctx: Pick<RouteContext, "store">): Promise<boolean> {
    const draft = url.pathname.match(/^\/api\/v1\/series\/([^/]+)\/episodes\/(\d+)\/draft$/);
    if (!(draft))
        return false;
    const id = SeriesId.parse(draft[1]), episode = z.number().int().positive().parse(Number(draft[2]));
    if (req.method === "GET")
        send(ctx.store.draft(id, episode));
    else if (req.method === "POST") {
        const body = DraftSchema.parse(await readScopedJson(req, url));
        send(ctx.store.saveDraft(id, episode, body.baseVersion, body.text));
    }
    else
        throw new HttpError(405, "METHOD_NOT_ALLOWED");
    return true;
}
