import { EpisodeRuntime } from "../../../bootstrap/episode-runtime.js";
import { log } from "../../../platform/observability/logger.js";
import { getArgValue, hasFlag, parseTransitionSec, resolveExecutionMode } from '../arguments.js';
import type { SeriesCommandContext } from './context.js';
export async function rerollCommand(context: Pick<SeriesCommandContext, "subArgs" | "seriesId" | "biblePath" | "bible">): Promise<void> {
    const { subArgs, seriesId, biblePath, bible } = context;
    const shotId = getArgValue(subArgs, "--shot");
    const epArg = getArgValue(subArgs, "--episode");
    if (!shotId) {
        console.error("❌ Lỗi: Cần cung cấp --shot <shotId> (ví dụ: --shot sc1_sh2).");
        process.exit(2);
    }
    const episodeNumber = epArg ? parseInt(epArg, 10) : 1;
    const sId = seriesId || "default-series";
    const { dryRun, provider } = resolveExecutionMode(subArgs);
    const promptOverride = getArgValue(subArgs, "--prompt");
    const approve = hasFlag(subArgs, "--approve") || hasFlag(subArgs, "--force-approve");
    const noRemux = hasFlag(subArgs, "--no-remux");
    const remuxRequested = hasFlag(subArgs, "--remux");
    const remuxAfterReroll = approve ? !noRemux : remuxRequested;
    const transitionDurationSec = parseTransitionSec(subArgs);
    console.log(`\n🎲 [REROLL] Tạo lại riêng shot [${shotId}] cho tập ${episodeNumber}...`);
    const pipeline = new EpisodeRuntime(bible);
    const res = await pipeline.rerollShot({
        seriesId: sId,
        episodeNumber,
        shotId,
        provider,
        dryRun,
        promptOverride,
        forceApprove: approve,
        remuxAfterReroll,
        transitionDurationSec,
    });
    console.log("\n=======================================================");
    console.log(`🎉 HOÀN TẤT TÁI TẠO SHOT [${res.shotId}]`);
    console.log(`   Take mới: ${res.takeId}`);
    console.log(`   Video: ${res.videoPath}`);
    console.log(`   Trạng thái phê duyệt: ${res.isApproved ? "ĐÃ PHÊ DUYỆT (Official)" : "CHỜ DUYỆT (Candidate)"}`);
    if (!res.isApproved) {
        console.log(`   ℹ️ Take mới được lưu an toàn. Dùng lệnh 'series take:approve' hoặc cờ '--approve' để đưa vào Master video.`);
    }
    console.log("=======================================================\n");
}
