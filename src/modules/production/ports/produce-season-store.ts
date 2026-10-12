
import type { EpisodeSummaryRecord, BudgetLedgerSummary, SeriesPlanRecord, PlannedEpisodeRecord } from "../../../contracts/story.js";



export interface ProduceSeasonStore {
getCanonHistory(seriesId?: string): EpisodeSummaryRecord[];
getSeriesPlan(id: string): SeriesPlanRecord | null;
listSeriesPlans(seriesId: string): SeriesPlanRecord[];
getActiveSeriesPlan(seriesId: string): SeriesPlanRecord | null;
listPlannedEpisodes(planId: string): PlannedEpisodeRecord[];
getSeriesBudgetLedger(seriesId: string): BudgetLedgerSummary;
}
