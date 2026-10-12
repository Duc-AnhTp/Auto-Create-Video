import type { IncomingMessage, ServerResponse } from "node:http";
import { CINEMATIC_LOOK_PRESETS } from "../../../modules/media/index.js";
import type { RouteContext, SendJson } from "./context.js";
export async function route28_postPresets(req: IncomingMessage, res: ServerResponse, url: URL, send: SendJson, ctx: Pick<RouteContext, never>): Promise<boolean> {
    const postPresetsMatch = url.pathname.match(/^\/api\/v1\/series\/([^/]+)\/cinematic-post\/presets$/);
    if (!(postPresetsMatch && req.method === "GET"))
        return false;
    send({
        success: true,
        presets: Object.values(CINEMATIC_LOOK_PRESETS),
        resolutionStandards: [
            { id: "4k", name: "4K UHD (3840x2160 / 2160x3840)", bitDepth: 10, colorSpace: "bt709" },
            { id: "1080p", name: "1080p Full HD (1920x1080 / 1080x1920)", bitDepth: 8, colorSpace: "bt709" },
        ],
        deliveryStandards: [
            { id: "broadcast_ebu_r128", name: "Broadcast EBU R128 (-23 LUFS, -1.0 dBTP)", targetLufs: -23.0, targetTp: -1.0 },
            { id: "streaming_youtube_tiktok", name: "Streaming YouTube/TikTok (-14 LUFS, -1.0 dBTP)", targetLufs: -14.0, targetTp: -1.0 },
        ],
    });
    return true;
}
