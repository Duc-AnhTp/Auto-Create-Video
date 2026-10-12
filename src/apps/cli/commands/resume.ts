import { existsSync } from "node:fs";
import { join } from "node:path";
import { EpisodeRuntime } from "../../../bootstrap/episode-runtime.js";
import { log } from "../../../platform/observability/logger.js";
import { getArgValue, parseTransitionSec, resolveExecutionMode } from '../arguments.js';
import type { SeriesCommandContext } from './context.js';
export async function resumeCommand(context: Pick<SeriesCommandContext, "subArgs" | "seriesId" | "biblePath" | "bible">): Promise<void> {
    const { subArgs, seriesId, biblePath, bible } = context;
    const epArg = getArgValue(subArgs, "--episode");
    let scriptInput = getArgValue(subArgs, "--script");
    const sId = seriesId || "default-series";
    if (!scriptInput && epArg) {
        const epNumStr = String(parseInt(epArg, 10)).padStart(2, "0");
        const defaultScriptPath = join("output", "series", sId, `ep-${epNumStr}`, "script-normalized.json");
        if (existsSync(defaultScriptPath)) {
            scriptInput = defaultScriptPath;
        }
    }
    if (!scriptInput) {
        console.error("❌ Lỗi: Cần cung cấp --script <path> hoặc --episode <num> (để tìm kịch bản đã lưu).");
        process.exit(2);
    }
    const { dryRun, provider, mockTts, skipRender, skipAudit, commitCanon } = resolveExecutionMode(subArgs);
    console.log(`\n🔄 [RESUME] Đang tiếp tục sản xuất từ checkpoint...`);
    const pipeline = new EpisodeRuntime(bible);
    const res = await pipeline.produceEpisode(scriptInput, {
        seriesId: sId,
        biblePath,
        provider,
        dryRun,
        mockTts,
        skipRender,
        skipAudit,
        resume: true, regenerateAudio: subArgs.includes("--regenerate-audio"),
        commitCanon,
        transitionDurationSec: parseTransitionSec(subArgs),
    });
    console.log("\n=======================================================");
    console.log(`🎉 HOÀN THÀNH TIẾP TỤC TẬP ${res.episodeNumber}: "${res.title}"`);
    console.log(`   Video: ${res.videoPath}`);
    console.log(`   Audio: ${res.audioPath}`);
    console.log(`   Thư mục: ${res.outputDir}`);
    console.log("=======================================================\n");
}
