import { EpisodeRuntime } from "../../../bootstrap/episode-runtime.js";
import { log } from "../../../platform/observability/logger.js";
import { getArgValue, hasFlag, parseTransitionSec, resolveExecutionMode, resolveHedge } from '../arguments.js';
import type { SeriesCommandContext } from './context.js';
export async function episodeCommand(context: Pick<SeriesCommandContext, "subArgs" | "biblePath" | "seriesId" | "bible">): Promise<void> {
    const { subArgs, biblePath, seriesId, bible } = context;
    const scriptInput = getArgValue(subArgs, "--script");
    if (!scriptInput) {
        console.error("❌ Lỗi: Cần cung cấp --script <path_or_text>.");
        process.exit(2);
    }
    const { dryRun, provider, mockTts, skipRender, skipAudit, commitCanon } = resolveExecutionMode(subArgs);
    const resume = hasFlag(subArgs, "--resume");
    const hierarchical = hasFlag(subArgs, "--hierarchical");
    const pipeline = new EpisodeRuntime(bible);
    const res = await pipeline.produceEpisode(scriptInput, {
        seriesId,
        biblePath,
        provider,
        dryRun,
        mockTts,
        skipRender,
        skipAudit,
        resume, regenerateAudio: hasFlag(subArgs, "--regenerate-audio"),
        commitCanon,
        transitionDurationSec: parseTransitionSec(subArgs),
        useHierarchicalAssembly: hierarchical,
        hedge: resolveHedge(subArgs, provider),
        budgetCapUsd: getArgValue(subArgs, "--budget-cap-usd") === undefined ? undefined : Number(getArgValue(subArgs, "--budget-cap-usd")),
    });
    console.log("\n=======================================================");
    console.log(`🎉 HOÀN THÀNH SẢN XUẤT TẬP ${res.episodeNumber}: "${res.title}"`);
    console.log(`   Video: ${res.videoPath}`);
    console.log(`   Audio: ${res.audioPath}`);
    console.log(`   Thư mục xuất bản: ${res.outputDir}`);
    console.log("=======================================================\n");
}
