import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { finalizeEpisodeProduction } from "../../../bootstrap/finalize-episode.js";
import { log } from "../../../platform/observability/logger.js";
import { getArgValue, hasFlag } from '../arguments.js';
import type { SeriesCommandContext } from './context.js';
export async function finalizeCommand(context: Pick<SeriesCommandContext, "subArgs" | "seriesId" | "bible">): Promise<void> {
    const { subArgs, seriesId, bible } = context;
    const epArg = getArgValue(subArgs, "--episode");
    const epNum = epArg ? parseInt(epArg, 10) : 1;
    const sId = seriesId || "default-series";
    const epNumStr = String(epNum).padStart(2, "0");
    const outDir = getArgValue(subArgs, "--out") ||
        join("output", "series", sId, `ep-${epNumStr}`);
    const scriptPath = getArgValue(subArgs, "--script") ||
        join(outDir, "script-normalized.json");
    if (!existsSync(scriptPath)) {
        console.error(`❌ Lỗi: Không tìm thấy kịch bản tại ${scriptPath}. Cần chạy 'series:episode' trước.`);
        process.exit(2);
    }
    let script: any;
    try {
        script = JSON.parse(await readFile(scriptPath, "utf8"));
    }
    catch (err: any) {
        console.error(`❌ Lỗi đọc kịch bản: ${err.message}`);
        process.exit(1);
    }
    const allowMock = hasFlag(subArgs, "--allow-mock-media") || hasFlag(subArgs, "--dry-run");
    console.log(`\n🔒 [FINALIZE] Bắt đầu kiểm tra và chốt tập ${epNum} ('${script.title}') cho series '${sId}'...`);
    const result = await finalizeEpisodeProduction({
        seriesId: sId,
        episodeNumber: epNum,
        script,
        bible,
        outputDir: outDir,
        allowMockMedia: allowMock,
    });
    if (!result.success) {
        console.error(`\n❌ Chốt tập thất bại: ${result.error}`);
        if (result.missingApprovals && result.missingApprovals.length > 0) {
            console.error(`   Shots chưa duyệt hoặc thiếu file:`);
            for (const s of result.missingApprovals)
                console.error(`     - ${s}`);
        }
        if (result.mockTakesDetected && result.mockTakesDetected.length > 0) {
            console.error(`   Takes mock bị phát hiện (bị chặn đưa vào canon):`);
            for (const m of result.mockTakesDetected)
                console.error(`     - ${m}`);
        }
        process.exit(1);
    }
    console.log("\n=======================================================");
    console.log(`🎉 TẬP PHIM ĐÃ ĐƯỢC CHỐT VÀO CANON THÀNH CÔNG!`);
    console.log(`   Tập:        ${epNum} - "${script.title}"`);
    console.log(`   Master MP4: ${result.masterVideoPath}`);
    console.log(`   Commit ID:  ${result.commitId}`);
    console.log(`   QA Status:  ${result.qaReport?.isValid ? "PASSED (Hợp lệ)" : "N/A"}`);
    console.log("=======================================================\n");
}
