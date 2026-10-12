import { EpisodeRuntime } from "../../../bootstrap/episode-runtime.js";
import { log } from "../../../platform/observability/logger.js";
import { getArgValue, hasFlag, parseTransitionSec } from '../arguments.js';
import type { SeriesCommandContext } from './context.js';
export async function remuxCommand(context: Pick<SeriesCommandContext, "subArgs" | "seriesId" | "biblePath" | "bible">): Promise<void> {
    const { subArgs, seriesId, biblePath, bible } = context;
    const epArg = getArgValue(subArgs, "--episode");
    const episodeNumber = epArg ? parseInt(epArg, 10) : 1;
    const sId = seriesId || "default-series";
    const skipRender = hasFlag(subArgs, "--skip-render");
    const transitionDurationSec = parseTransitionSec(subArgs);
    console.log(`\n🎞️ [REMUX] Dựng lại video tập ${episodeNumber} từ các clip đã có...`);
    const pipeline = new EpisodeRuntime(bible);
    const res = await pipeline.remuxEpisode({
        seriesId: sId,
        episodeNumber,
        skipRender,
        transitionDurationSec,
    });
    console.log("\n=======================================================");
    console.log(`🎉 HOÀN TẤT DỰNG LẠI VIDEO TẬP ${episodeNumber}`);
    console.log(`   Video: ${res.videoPath}`);
    console.log(`   Audio: ${res.audioPath}`);
    console.log("=======================================================\n");
}
