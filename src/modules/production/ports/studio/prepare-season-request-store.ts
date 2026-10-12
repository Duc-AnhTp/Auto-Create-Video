import type { SeriesPlanRecord } from "../../../../contracts/story.js";
export interface PrepareSeasonRequestStore {
    listSeriesPlans(seriesId: string): SeriesPlanRecord[];
}
