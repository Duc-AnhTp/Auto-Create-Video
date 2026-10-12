import { existsSync, readdirSync, readFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { join, resolve } from "node:path";
import { z } from "zod";
import { containedPath } from "../../../platform/filesystem/containment.js";
import { SeriesId } from "../../../contracts/requests.js";
import type { RouteContext, SendJson } from "./context.js";
export async function route15_artifacts(req: IncomingMessage, res: ServerResponse, url: URL, send: SendJson, ctx: Pick<RouteContext, never>): Promise<boolean> {
    const artifacts = url.pathname.match(/^\/api\/v1\/series\/([^/]+)\/episodes\/(\d+)\/artifacts$/);
    if (!(artifacts && req.method === "GET"))
        return false;
    const id = SeriesId.parse(artifacts[1]);
    const episode = z.number().int().positive().parse(Number(artifacts[2]));
    const dir = resolve("output", "series", id, `ep-${String(episode).padStart(2, "0")}`);
    if (!existsSync(dir)) {
        send({ timeline: null, files: [] });
        return true;
    }
    containedPath(resolve("output"), dir);
    const candidates = [join(dir, "timeline.json"), join(dir, "assembly", "timeline.json")];
    const timelinePath = candidates.find(existsSync);
    const files: string[] = [];
    const walk = (path: string, depth = 0) => {
        if (depth > 3)
            return;
        for (const item of readdirSync(path, { withFileTypes: true })) {
            if (item.isSymbolicLink())
                continue;
            const file = join(path, item.name);
            if (item.isDirectory())
                walk(file, depth + 1);
            else if (/\.(mp4|wav|mp3|srt|vtt|ass|xml|otio)$/i.test(item.name))
                files.push(file);
        }
    };
    walk(dir);
    send({ timeline: timelinePath ? JSON.parse(readFileSync(containedPath(dir, timelinePath), "utf8")) : null, files });
    return true;
}
