import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { RateCardManager } from "../../../modules/production/index.js";
import { normalizeScript } from "../../../modules/story/index.js";
import { log } from "../../../platform/observability/logger.js";
import { getArgValue } from '../arguments.js';
import type { SeriesCommandContext } from './context.js';
export async function planCommand(context: Pick<SeriesCommandContext, "subArgs" | "bible" | "seriesId">): Promise<void> {
    const { subArgs, bible, seriesId } = context;
    const scriptInput = getArgValue(subArgs, "--script");
    if (!scriptInput) {
        console.error("❌ Lỗi: Cần cung cấp --script <path_or_text> để dự toán chi phí.");
        process.exit(2);
    }
    let rawContent = scriptInput;
    if (existsSync(scriptInput)) {
        rawContent = await readFile(scriptInput, "utf8");
    }
    let script: any;
    try {
        script = await normalizeScript(rawContent, bible, { skipAudit: true });
    }
    catch (err: any) {
        console.error(`❌ Lỗi chuẩn hóa kịch bản: ${err.message}`);
        process.exit(1);
    }
    const rateManager = new RateCardManager(bible);
    rateManager.seedDefaultRatesIfEmpty();
    const totalScenes = script.scenes.length;
    const totalShots = script.scenes.reduce((acc: number, s: any) => acc + s.shots.length, 0);
    const totalDurationSec = script.scenes.reduce((acc: number, s: any) => acc + s.shots.reduce((a: number, sh: any) => a + (sh.durationSec || 4.0), 0), 0);
    const totalDialogueCount = script.scenes.reduce((acc: number, s: any) => acc + s.shots.reduce((a: number, sh: any) => a + (sh.dialogues?.length || 0), 0), 0);
    const targetSeriesId = seriesId || script.seriesId || "default-series";
    const sBudget = bible.getSeriesBudgetLedger(targetSeriesId);
    const budgetCapArg = getArgValue(subArgs, "--budget") || getArgValue(subArgs, "--budget-cap");
    const budgetCap = budgetCapArg ? parseFloat(budgetCapArg) : sBudget.maxBudgetUsd;
    console.log("\n=======================================================");
    console.log(`📋 BẢNG DỰ TOÁN KỊCH BẢN & CHI PHÍ SẢN XUẤT`);
    console.log(`   Tập ${script.episodeNumber}: "${script.title}" (Series: ${targetSeriesId})`);
    console.log("=======================================================");
    console.log(`🎞️ Tổng số cảnh (Scenes):     ${totalScenes}`);
    console.log(`🎬 Tổng số shot cú máy:       ${totalShots}`);
    console.log(`⏱️ Tổng thời lượng video:     ${totalDurationSec.toFixed(1)} giây (~${(totalDurationSec / 60).toFixed(2)} phút)`);
    console.log(`💬 Tổng số câu thoại TTS:     ${totalDialogueCount}`);
    console.log(`💰 Ngân sách khả dụng/trần:   $${budgetCap.toFixed(2)} USD\n`);
    const providersToCompare = [
        { id: "local_comfyui", name: "Local ComfyUI (Wan 2.1/2.2)", model: "wan2.2_local" },
        { id: "api_kling", name: "Kling AI Standard (1080p)", model: "kling-v2" },
        { id: "api_runway", name: "Runway Gen-3 Alpha Turbo", model: "gen3a_turbo" },
        { id: "api_veo", name: "Google Veo 3.1 Cinematic", model: "veo-3.1" },
        { id: "api_wan", name: "Wan 2.2 Cloud API", model: "wan-2.2" },
        { id: "api_seedance", name: "Seedance 2.0 Fast Tier", model: "seedance-2.0" },
        { id: "mock", name: "Simulator / Mock Test", model: "simulator" },
    ];
    console.log("┌─────────────────────────────┬───────────┬──────────────┬──────────────┬─────────────┐");
    console.log("│ Provider / Model            │ Đơn giá/s │ Chi phí pass │ +30% Rerolls │ Khả thi     │");
    console.log("├─────────────────────────────┼───────────┼──────────────┼──────────────┼─────────────┤");
    for (const p of providersToCompare) {
        const rate = rateManager.resolveRate(p.id, p.model);
        const baseCost = rate.ratePerSecUsd * totalDurationSec;
        const rerollCost = baseCost * 1.3;
        const isFeasible = budgetCap >= rerollCost;
        const statusStr = rate.ratePerSecUsd === 0 ? "MIỄN PHÍ" : isFeasible ? "✅ ĐỦ TIỀN" : "❌ VƯỢT TRẦN";
        const namePad = p.name.padEnd(27, " ");
        const ratePad = `$${rate.ratePerSecUsd.toFixed(2)}/s`.padStart(9, " ");
        const basePad = `$${baseCost.toFixed(2)}`.padStart(12, " ");
        const rerollPad = `$${rerollCost.toFixed(2)}`.padStart(12, " ");
        const statusPad = statusStr.padEnd(11, " ");
        console.log(`│ ${namePad} │ ${ratePad} │ ${basePad} │ ${rerollPad} │ ${statusPad} │`);
    }
    console.log("└─────────────────────────────┴───────────┴──────────────┴──────────────┴─────────────┘");
    console.log("\n💡 Gợi ý chiến lược sản xuất:");
    console.log("   1. Dùng `local_comfyui` để sinh toàn bộ shot ban đầu (chi phí $0).");
    console.log("   2. Chỉ reroll bằng `api_kling` hoặc `api_runway` cho những shot nhân vật chính thất bại Visual QA.");
    console.log("=======================================================\n");
}
