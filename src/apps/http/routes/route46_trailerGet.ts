import { log } from '../../../platform/observability/logger.js';
import { existsSync, readFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { join } from "node:path";
import { SeriesId } from "../../../contracts/requests.js";
import type { RouteContext, SendJson } from "./context.js";
export async function route46_trailerGet(req: IncomingMessage, res: ServerResponse, url: URL, send: SendJson, ctx: Pick<RouteContext, never>): Promise<boolean> {
    const trailerGetMatch = url.pathname.match(/^\/api\/(?:v1\/)?series\/([^/]+)\/season\/trailer$/);
    if (!(trailerGetMatch && req.method === "GET"))
        return false;
    const id = SeriesId.parse(trailerGetMatch[1]);
    const possiblePaths = [
        join("data", "series", id, "season_production", "season_trailer", "trailer_manifest.json"),
        join("data", "series", id, "trailer_delivery", "trailer_manifest.json"),
    ];
    let foundManifest: any = null;
    for (const p of possiblePaths) {
        if (existsSync(p)) {
            try {
                foundManifest = JSON.parse(readFileSync(p, "utf-8"));
                break;
            }
            catch (caughtError) {
                log.warn("[route46_trailerGet] " + String(caughtError));
            }
        }
    }
    if (foundManifest) {
        send({ success: true, trailer: foundManifest });
    }
    else {
        send({ success: false, message: "Chưa có trailer nào được tạo cho mùa phim này." }, 404);
    }
    return true;
}
