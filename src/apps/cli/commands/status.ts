import { log } from "../../../platform/observability/logger.js";
import type { SeriesCommandContext } from './context.js';
export async function statusCommand(context: Pick<SeriesCommandContext, "bible" | "seriesId">): Promise<void> {
    const { bible, seriesId } = context;
    const meta = bible.getSeriesMetadata();
    const chars = bible.listCharacters();
    const locations = bible.listLocations();
    const props = bible.listKeyProps();
    const history = bible.getCanonHistory();
    console.log("\n=======================================================");
    console.log(`📖 BÁO CÁO STORY BIBLE: [${meta?.id || seriesId || "Unknown"}]`);
    console.log("=======================================================");
    if (meta) {
        console.log(`Tên Series:       ${meta.title} (${meta.genre || "N/A"})`);
        console.log(`Phong cách đồ họa: ${meta.visual_style}`);
        console.log(`Tỷ lệ khung hình: ${meta.aspect_ratio} | FPS: ${meta.fps}`);
    }
    else {
        console.log("Chưa khởi tạo metadata series (chạy `series:init` để khởi tạo).");
    }
    console.log(`\n🎭 Nhân Vật (${chars.length}):`);
    for (const c of chars) {
        const wardrobe = bible.getCharacterWardrobe(c.id);
        console.log(`  - [${c.id}] ${c.name} (${c.role}) - Trạng thái: ${c.status}`);
        if (c.distinguishing_marks)
            console.log(`    + Dấu hiệu đặc biệt: ${c.distinguishing_marks}`);
        if (c.face_reference_image)
            console.log(`    + Ảnh mặt chuẩn: ${c.face_reference_image}`);
        if (wardrobe)
            console.log(`    + Trang phục: ${wardrobe.visual_description}`);
    }
    console.log(`\n📍 Bối Cảnh / Địa Điểm (${locations.length}):`);
    for (const l of locations) {
        console.log(`  - [${l.id}] ${l.name}: ${l.visual_summary}`);
    }
    console.log(`\n🗝️ Đạo Cụ Đặc Biệt "Không Được Quên" (${props.length}):`);
    for (const p of props) {
        console.log(`  - [${p.id}] ${p.name} [${p.status}]: Người giữ hiện tại: ${p.current_holder_id || "Không ai"}`);
    }
    console.log(`\n🎬 Lịch Sử Các Tập Đã Sản Xuất (${history.length}):`);
    for (const ep of history) {
        console.log(`  - Tập ${ep.episode_number}: "${ep.title}" (${ep.created_at})`);
        console.log(`    Logline: ${ep.logline}`);
    }
    const effectiveSeriesId = meta?.id || seriesId || "default-series";
    const takesSummary = bible.getSeriesCostAndTakesSummary(effectiveSeriesId);
    console.log(`\n💰 Thống Kê Shot Takes & Chi Phí Sản Xuất (${effectiveSeriesId}):`);
    console.log(`  - Tổng số take đã sinh: ${takesSummary.totalTakes} (Đã duyệt: ${takesSummary.approvedTakes})`);
    console.log(`  - Tổng chi phí API ước tính: $${takesSummary.totalCostUsd.toFixed(4)} USD`);
    if (takesSummary.episodes.length > 0) {
        for (const ep of takesSummary.episodes) {
            console.log(`    + Tập ${ep.episodeNumber}: ${ep.takeCount} takes (${ep.approvedCount} đã duyệt) - $${ep.costUsd.toFixed(4)} USD`);
        }
    }
    const ledger = bible.getSeriesBudgetLedger(effectiveSeriesId);
    console.log(`\n📊 SỔ CÁI CHI PHÍ 4 TRẠNG THÁI & NGÂN SÁCH BẢO VỆ (${effectiveSeriesId}):`);
    console.log(`  - Hạn mức ngân sách tối đa (Budget Cap): $${ledger.maxBudgetUsd.toFixed(4)} USD`);
    console.log(`  - Tổng cam kết (Committed):             $${ledger.totalCommittedUsd.toFixed(4)} USD`);
    console.log(`  - Số dư khả dụng (Available):           $${ledger.remainingAvailableUsd.toFixed(4)} USD`);
    console.log(`  - Chi tiết các trạng thái chi phí:`);
    console.log(`    + Đã giữ chỗ (Reserved):     $${ledger.reservedCostUsd.toFixed(4)} USD`);
    console.log(`    + Đã xác nhận (Confirmed):   $${ledger.confirmedCostUsd.toFixed(4)} USD`);
    console.log(`    + Chưa xác định (Uncertain): $${ledger.uncertainCostUsd.toFixed(4)} USD`);
    const pendingJobs = bible.listPendingJobsForSeries(effectiveSeriesId) || [];
    const uncertainJobs = pendingJobs.filter((j) => j.status === "uncertain_timeout");
    if (uncertainJobs.length > 0) {
        console.log(`\n⚠️  CẢNH BÁO: Có ${uncertainJobs.length} job(s) ở trạng thái 'uncertain_timeout' đang treo ngân sách:`);
        for (const uj of uncertainJobs) {
            console.log(`    * Job [${uj.id}] (Provider: ${uj.provider}, RemoteID: ${uj.provider_job_id || "chưa rõ"}): Chi phí treo $${uj.uncertain_cost_usd.toFixed(4)} USD`);
            console.log(`      Lỗi: ${uj.error_message || "Timeout submit"}`);
        }
        console.log(`    -> Hãy chạy lệnh \`series:reconcile --series ${effectiveSeriesId}\` để đối soát và giải phóng.`);
    }
    console.log("=======================================================\n");
}
