import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { startSeriesReviewServer } from "../../http/review-server.js";
import { log } from "../../../platform/observability/logger.js";
import { getArgValue, hasFlag } from '../arguments.js';
import type { SeriesCommandContext } from './context.js';
export async function reviewCommand(context: Pick<SeriesCommandContext, "subArgs" | "seriesId" | "biblePath">): Promise<void> {
    const { subArgs, seriesId, biblePath } = context;
    const epArg = getArgValue(subArgs, "--episode");
    const episodeNumber = epArg ? parseInt(epArg, 10) : 1;
    const sId = seriesId || "default-series";
    const epNumStr = String(episodeNumber).padStart(2, "0");
    const scriptPath = getArgValue(subArgs, "--script") ||
        join("output", "series", sId, `ep-${epNumStr}`, "script-normalized.json");
    let script: any = null;
    if (existsSync(scriptPath)) {
        try {
            script = JSON.parse(await readFile(scriptPath, "utf8"));
        }
        catch (caughtError) {
            log.warn("[series] " + String(caughtError));
        }
    }
    if (!script) {
        script = {
            seriesId: sId,
            episodeNumber,
            title: `Tập ${episodeNumber}`,
            scenes: [],
        };
    }
    const port = parseInt(getArgValue(subArgs, "--port") || "3001", 10);
    const server = startSeriesReviewServer({
        script,
        biblePath,
        seriesId: sId,
        episodeNumber,
        outputDir: join("output", "series", sId, `ep-${epNumStr}`),
        port,
        autoOpen: !hasFlag(subArgs, "--no-open"),
    });
    await server;
}
