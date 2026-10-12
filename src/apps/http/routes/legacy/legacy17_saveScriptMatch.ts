import { saveScreenplay } from "../../../../modules/story/index.js";
import { z } from 'zod';
import { mkdir, writeFile } from "node:fs/promises";
import { type IncomingMessage, type ServerResponse } from "node:http";
import { join, resolve } from "node:path";
import { SeriesId } from "../../../../contracts/requests.js";
import { containedPath } from "../../../../platform/filesystem/containment.js";
import type { ServerRouteContext } from './context.js';
export async function legacy17_saveScriptMatch(req: IncomingMessage, res: ServerResponse, url: URL, ctx: Pick<ServerRouteContext, "parseJsonBody" | "openStore">): Promise<boolean> {
    const pathname = url.pathname;
    const saveScriptMatch = pathname.match(/^\/api\/series\/([^/]+)\/script\/save$/);
    if (!(saveScriptMatch && req.method === "POST"))
        return false;
    const seriesId = SeriesId.parse(saveScriptMatch[1]);
    const body = z.object({ episodeNumber: z.coerce.number().int().positive().optional(), rawScreenplay: z.string() }).passthrough().parse(await ctx.parseJsonBody(req));
    const epNum = body.episodeNumber || 1;
    const scriptsDir = resolve("data", "series", seriesId, "scripts");
    containedPath(resolve("data"), scriptsDir);
    await mkdir(scriptsDir, { recursive: true });
    const scriptPath = containedPath(scriptsDir, join(scriptsDir, `ep${String(epNum).padStart(2, "0")}.txt`));
    await writeFile(scriptPath, body.rawScreenplay, "utf8");
    const normalized = await ctx.openStore(`data/series/${seriesId}/story_bible.db`, (bible) => saveScreenplay(bible, { body, seriesId }));
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ success: true, scriptPath, script: normalized }));
    return true;
}
