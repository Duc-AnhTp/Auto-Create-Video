import type { CountPendingSeriesJobsStore } from "../../ports/studio/count-pending-series-jobs-store.js";
export function countPendingSeriesJobs(bible: CountPendingSeriesJobsStore, args: {
    id: string;
}) {
    const { id } = args;
    return bible.listPendingJobsForSeries(id).length;
}
