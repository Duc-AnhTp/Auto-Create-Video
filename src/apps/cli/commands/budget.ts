import { log } from "../../../platform/observability/logger.js";
import { getArgValue } from '../arguments.js';
import type { SeriesCommandContext } from './context.js';
export async function budgetCommand(context: Pick<SeriesCommandContext, "seriesId" | "subArgs" | "bible">): Promise<void> {
    const { seriesId, subArgs, bible } = context;
    const sId = seriesId || "default-series";
    const setMax = getArgValue(subArgs, "--set-max");
    if (setMax) {
        const maxVal = parseFloat(setMax);
        bible.setSeriesBudget(sId, maxVal);
        console.log(`\n✅ Đã cập nhật hạn mức ngân sách series [${sId}] thành: $${maxVal.toFixed(2)} USD`);
    }
    else {
        const l = bible.getSeriesBudgetLedger(sId);
        console.log(`\n💰 NGÂN SÁCH SERIES [${sId}]:`);
        console.log(`  - Hạn mức tối đa: $${l.maxBudgetUsd.toFixed(2)} USD`);
        console.log(`  - Tổng cam kết:   $${l.totalCommittedUsd.toFixed(4)} USD`);
        console.log(`  - Còn lại:        $${l.remainingAvailableUsd.toFixed(4)} USD`);
    }
}
