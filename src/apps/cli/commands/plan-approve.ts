import { SeriesPlanner } from "../../../modules/story/index.js";
import { log } from "../../../platform/observability/logger.js";
import { getArgValue } from '../arguments.js';
import type { SeriesCommandContext } from './context.js';
export async function planApproveCommand(context: Pick<SeriesCommandContext, "subArgs" | "bible">): Promise<void> {
    const { subArgs, bible } = context;
    const planId = subArgs[0] && !subArgs[0].startsWith("-")
        ? subArgs[0]
        : getArgValue(subArgs, "--plan") || getArgValue(subArgs, "--id");
    if (!planId) {
        console.error("❌ Lỗi: Cần cung cấp planId (ví dụ: series:plan-approve <planId> hoặc --plan <planId>).");
        process.exit(2);
    }
    const planner = new SeriesPlanner(bible);
    try {
        const approved = planner.approvePlan(planId, getArgValue(subArgs, "--by") || "cli_operator");
        const activated = planner.activatePlan(planId);
        console.log(`\n✅ Đã phê duyệt và kích hoạt Kế Hoạch Chuyển Thể: [${activated.id}]`);
        console.log(`   Series ID:  ${activated.series_id}`);
        console.log(`   Trạng thái: ${activated.status.toUpperCase()}`);
        console.log(`   Kế hoạch hiện đã sẵn sàng cho sản xuất (series:season).\n`);
    }
    catch (err: any) {
        console.error(`❌ Lỗi phê duyệt kế hoạch: ${err.message}`);
        process.exit(1);
    }
}
