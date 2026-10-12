import { log } from "../../../platform/observability/logger.js";
import { getArgValue } from '../arguments.js';
import type { SeriesCommandContext } from './context.js';
export async function jobsCommand(context: Pick<SeriesCommandContext, "subArgs" | "seriesId" | "bible">): Promise<void> {
    const { subArgs, seriesId, bible } = context;
    const epArg = getArgValue(subArgs, "--episode");
    const statusFilter = getArgValue(subArgs, "--status");
    const sId = seriesId || "default-series";
    const epNum = epArg ? parseInt(epArg, 10) : undefined;
    const jobs = bible.listPendingJobsForSeries(sId, epNum);
    console.log(`\n📋 DANH SÁCH PROVIDER JOBS (${sId}${epNum ? ` - Tập ${epNum}` : ""}):`);
    if (jobs.length === 0) {
        console.log("  Không có job nào đang chờ xử lý.");
    }
    else {
        for (const j of jobs) {
            if (statusFilter && j.status !== statusFilter)
                continue;
            console.log(`  - [${j.id}] Trạng thái: ${j.status.toUpperCase()} | Shot: ${j.shot_id} | Provider: ${j.provider}`);
            console.log(`    Remote Job ID: ${j.provider_job_id || "None"} | Attempts: ${j.attempt_count}/${j.max_attempts}`);
            console.log(`    Spec Hash: ${j.spec_hash.slice(0, 16)}... | Chi phí: Est $${j.estimated_cost_usd} / Res $${j.reserved_cost_usd} / Conf $${j.confirmed_cost_usd}`);
            if (j.error_message)
                console.log(`    Lỗi: ${j.error_message}`);
        }
    }
    console.log("");
}
