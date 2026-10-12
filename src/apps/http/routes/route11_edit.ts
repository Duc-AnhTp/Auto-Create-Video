import type { IncomingMessage, ServerResponse } from "node:http";
import { HttpError } from "../../../platform/errors.js";
import { readScopedJson } from "../scoped-request.js";
import { editShot } from "../../../bootstrap/studio-story.js";
import { EditShotRequest } from "../../../modules/story/index.js";
import { SeriesId } from "../../../contracts/requests.js";
import type { RouteContext, SendJson } from "./context.js";
export async function route11_edit(req: IncomingMessage, res: ServerResponse, url: URL, send: SendJson, ctx: Pick<RouteContext, "store">): Promise<boolean> {
    const edit = url.pathname.match(/^\/api\/v1\/series\/([^/]+)\/episodes\/(\d+)\/edit-shot$/);
    if (!(edit && req.method === "POST"))
        return false;
    const id = SeriesId.parse(edit[1]), body = EditShotRequest.parse(await readScopedJson(req, url));
    if (ctx.store.draft(id, Number(edit[2])).version !== body.baseVersion)
        throw new HttpError(409, "DRAFT_CONFLICT");
    send(await editShot(id, body));
    return true;
}
