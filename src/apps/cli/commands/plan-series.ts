import { SeriesPlanner } from "../../../modules/story/index.js";
import { CoverageLedgerManager } from "../../../modules/story/index.js";
import { log } from "../../../platform/observability/logger.js";
import { getArgValue } from '../arguments.js';
import type { SeriesCommandContext } from './context.js';
export async function planSeriesCommand(context: Pick<SeriesCommandContext, "seriesId" | "subArgs" | "bible">): Promise<void> {
    const { seriesId, subArgs, bible } = context;
    if (!seriesId) {
        console.error("❌ Lỗi: Cần cung cấp --series <seriesId>.");
        process.exit(2);
    }
    const explicitSource = getArgValue(subArgs, "--source");
    let sourceWork = explicitSource ? bible.getSourceWork(explicitSource) : null;
    if (!sourceWork) {
        const works = bible.listSourceWorks(seriesId);
        if (works.length > 0)
            sourceWork = works[0];
    }
    if (!sourceWork) {
        console.error(`❌ Không tìm thấy tác phẩm nguồn nào cho series '${seriesId}'. Hãy chạy 'series:ingest' trước.`);
        process.exit(2);
    }
    const targetEpisodes = getArgValue(subArgs, "--episodes")
        ? parseInt(getArgValue(subArgs, "--episodes")!, 10)
        : undefined;
    const targetDuration = getArgValue(subArgs, "--duration")
        ? parseFloat(getArgValue(subArgs, "--duration")!)
        : undefined;
    const totalDuration = getArgValue(subArgs, "--total-duration")
        ? parseFloat(getArgValue(subArgs, "--total-duration")!)
        : undefined;
    const pacingPreset = (getArgValue(subArgs, "--pacing") as any) || "standard";
    console.log(`\n📋 Đang lập kế hoạch chuyển thể cho '${sourceWork.title}' (Pacing: ${pacingPreset})...`);
    const planner = new SeriesPlanner(bible);
    const planResult = await planner.planSeries({
        seriesId,
        sourceId: sourceWork.id,
        targetEpisodes,
        targetDurationPerEpisodeSec: targetDuration,
        targetTotalDurationSec: totalDuration,
        pacingPreset,
        status: (getArgValue(subArgs, "--status") as any) || "draft",
    });
    console.log(`✅ Đã tạo Kế Hoạch Chuyển Thể: ${planResult.plan.id}`);
    console.log(`   Trạng thái:          ${planResult.plan.status.toUpperCase()}`);
    console.log(`   Số tập dự kiến:      ${planResult.episodes.length} tập`);
    console.log(`   Thời lượng mục tiêu: ${planResult.episodes[0]?.target_duration_sec}s / tập (Tổng: ${planResult.summary.estimatedTotalDurationSec}s)`);
    console.log(`   Sổ cái độ phủ:       ${planResult.coverageLedgers.length} bản ghi`);
    const coverageMetrics = CoverageLedgerManager.calculateCoverage(seriesId, planResult.plan.id, bible);
    console.log(`   Độ phủ chương:       ${coverageMetrics.unitCoveragePercent}%`);
    console.log(`   Bảo toàn beat chính: ${coverageMetrics.mandatoryBeatsCoveragePercent}%`);
    if (planResult.warnings.length > 0) {
        console.log(`\n⚠️ Cảnh báo xung đột / điều chỉnh:`);
        for (const w of planResult.warnings) {
            console.log(`   - ${w}`);
        }
    }
    console.log(`\nDanh sách các tập phim dự kiến:`);
    for (const ep of planResult.episodes) {
        console.log(`   [Tập ${ep.episode_number}] ${ep.title} (${ep.target_duration_sec}s)`);
        console.log(`     Mục tiêu:   ${ep.goal}`);
        console.log(`     Hồi kết:    ${ep.ending}`);
    }
    if (planResult.plan.status === "draft") {
        console.log(`\n💡 Kế hoạch hiện ở trạng thái DRAFT. Để phê duyệt và kích hoạt sản xuất, chạy:`);
        console.log(`   npx tsx src/cli.ts series:plan-approve ${planResult.plan.id} --series ${seriesId}`);
    }
}
