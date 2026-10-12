import type { IncomingMessage, ServerResponse } from "node:http";
import { emotionalVoiceController_generateSettings } from "../../../modules/media/index.js";
import { readScopedJson } from "../scoped-request.js";
import { SeriesId } from "../../../contracts/requests.js";
import type { RouteContext, SendJson } from "./context.js";
export async function route37_lipSyncEmotion(req: IncomingMessage, res: ServerResponse, url: URL, send: SendJson, ctx: Pick<RouteContext, never>): Promise<boolean> {
    const lipSyncEmotionMatch = url.pathname.match(/^\/api\/v1\/series\/([^/]+)\/episodes\/(\d+)\/lip-sync\/emotion$/);
    if (!(lipSyncEmotionMatch && (req.method === "POST" || req.method === "GET")))
        return false;
    const id = SeriesId.parse(lipSyncEmotionMatch[1]);
    const queryText = url.searchParams.get("text") || "";
    const body = req.method === "POST" ? await readScopedJson(req, url) : {};
    const text = (body as any)?.text || queryText || "Chúng ta phải chiến đấu đến cùng!";
    const instruction = (body as any)?.actingInstruction || url.searchParams.get("actingInstruction") || "";
    const tension = parseFloat(url.searchParams.get("tension") || (body as any)?.tension || "0.75");
    const settings = emotionalVoiceController_generateSettings(text, {
        characterName: (body as any)?.characterName || "Diễn viên",
        explicitActingInstruction: instruction,
        sceneTensionScore: tension,
    });
    send({ success: true, settings });
    return true;
}
