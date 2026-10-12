import { SeasonOrchestrator } from "../../../bootstrap/season-runtime.js";
import { log } from "../../../platform/observability/logger.js";
import { getArgValue, hasFlag, parseTransitionSec, resolveExecutionMode } from '../arguments.js';
import type { SeriesCommandContext } from './context.js';
export async function seasonCommand(context: Pick<SeriesCommandContext, "seriesId" | "subArgs" | "bible">): Promise<void> {
    const { seriesId, subArgs, bible } = context;
    if (!seriesId) {
        console.error("❌ Lỗi: Cần cung cấp --series <seriesId>.");
        process.exit(2);
    }
    const execMode = resolveExecutionMode(subArgs);
    const planId = getArgValue(subArgs, "--plan");
    const fromEp = getArgValue(subArgs, "--from") ? parseInt(getArgValue(subArgs, "--from")!, 10) : undefined;
    const toEp = getArgValue(subArgs, "--to") ? parseInt(getArgValue(subArgs, "--to")!, 10) : undefined;
    const episodesArg = getArgValue(subArgs, "--episodes");
    const episodes = episodesArg
        ? episodesArg.split(",").map((e) => parseInt(e.trim(), 10)).filter((n) => !isNaN(n))
        : undefined;
    const budgetCap = getArgValue(subArgs, "--budget-cap")
        ? parseFloat(getArgValue(subArgs, "--budget-cap")!)
        : undefined;
    const outputDir = getArgValue(subArgs, "--output");
    const continueOnError = !hasFlag(subArgs, "--stop-on-error");
    const resume = !hasFlag(subArgs, "--no-resume");
    const hierarchical = !hasFlag(subArgs, "--no-hierarchical");
    const transitionDurationSec = parseTransitionSec(subArgs);
    console.log(`\n🎥 Đang khởi chạy Điều Phối Toàn Mùa (Season Orchestration) cho series '${seriesId}'...`);
    console.log(`   Provider:         ${execMode.provider} (Dry-run: ${execMode.dryRun})`);
    console.log(`   Resume:           ${resume}`);
    console.log(`   Continue on error: ${continueOnError}`);
    console.log(`   Hierarchical:     ${hierarchical}`);
    const orchestrator = new SeasonOrchestrator(bible);
    const result = await orchestrator.produceSeason({
        seriesId,
        planId,
        fromEpisode: fromEp,
        toEpisode: toEp,
        episodes,
        outputBaseDir: outputDir,
        provider: execMode.provider,
        dryRun: execMode.dryRun,
        mockTts: execMode.mockTts,
        skipAudit: execMode.skipAudit,
        skipRender: execMode.skipRender,
        resume,
        budgetCapUsd: budgetCap,
        commitCanon: execMode.commitCanon,
        continueOnError,
        useHierarchicalAssembly: hierarchical,
        transitionDurationSec,
    });
    console.log(`\n=======================================================`);
    console.log(`🎬 KẾT QUẢ ĐIỀU PHỐI MÙA PHIM (SEASON EXECUTION SUMMARY)`);
    console.log(`   Series:               ${seriesId}`);
    console.log(`   Trạng thái tổng thể:  ${result.success ? "✅ THÀNH CÔNG" : "⚠️ CÓ TẬP LỖI HOẶC VƯỢT NGÂN SÁCH"}`);
    console.log(`   Tập hoàn thành:       ${result.episodesCompleted} / ${result.totalTargetEpisodes}`);
    console.log(`   Tập thất bại:         ${result.episodesFailed}`);
    console.log(`   Tổng thời lượng:      ${result.totalDurationSec}s`);
    console.log(`   Chi phí xác nhận:     $${result.totalCostUsd.toFixed(2)} USD`);
    if (result.seasonMasterReportPath) {
        console.log(`   Báo cáo Master:       ${result.seasonMasterReportPath}`);
    }
    console.log(`=======================================================\n`);
}
