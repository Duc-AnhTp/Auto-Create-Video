import type { ProviderJobRecord } from "../../../../contracts/story.js";
export interface CountPendingSeriesJobsStore {
    listPendingJobsForSeries(seriesId: string, episodeNumber?: number): ProviderJobRecord[];
}
