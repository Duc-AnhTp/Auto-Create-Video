import type { IncomingMessage, ServerResponse } from "node:http";
import { visemeAligner_alignTextToDuration } from "../../../modules/media/index.js";
import { readScopedJson } from "../scoped-request.js";
import { SeriesId } from "../../../contracts/requests.js";
import type { RouteContext, SendJson } from "./context.js";
export async function route38_lipSyncVisemes(req: IncomingMessage, res: ServerResponse, url: URL, send: SendJson, ctx: Pick<RouteContext, never>): Promise<boolean> {
    const lipSyncVisemesMatch = url.pathname.match(/^\/api\/v1\/series\/([^/]+)\/episodes\/(\d+)\/lip-sync\/visemes$/);
    if (!(lipSyncVisemesMatch && (req.method === "POST" || req.method === "GET")))
        return false;
    const id = SeriesId.parse(lipSyncVisemesMatch[1]);
    const queryText = url.searchParams.get("text") || "";
    const body = req.method === "POST" ? await readScopedJson(req, url) : {};
    const text = (body as any)?.text || queryText || "Xin chào đồng đội";
    const duration = parseFloat((body as any)?.durationSec || url.searchParams.get("durationSec") || "3.0");
    const fps = parseInt((body as any)?.fps || url.searchParams.get("fps") || "24", 10);
    const visemes = visemeAligner_alignTextToDuration(text, duration, fps);
    send({ success: true, visemes });
    return true;
}
