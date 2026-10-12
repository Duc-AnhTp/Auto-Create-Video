import type { CharacterRecord, SourceWorkRecord, SourceUnitRecord, SourceBlockRecord, StoryBeatRecord, StoryThreadRecord, SeriesPlanRecord, PlannedEpisodeRecord, CoverageLedgerRecord } from "../../../contracts/story.js";

export interface SeriesPlannerStore {
batchUpsertPlannedEpisodes(episodes: PlannedEpisodeRecord[]): void;
getSeriesPlan(id: string): SeriesPlanRecord | null;
getSourceWork(id: string): SourceWorkRecord | null;
listCharacters(seriesId?: string): CharacterRecord[];
listCoverageLedgers(planOrSeriesId: string): CoverageLedgerRecord[];
listSeriesPlans(seriesId: string): SeriesPlanRecord[];
listSourceBlocks(unitId: string): SourceBlockRecord[];
listSourceUnits(sourceId: string, revision?: number): SourceUnitRecord[];
listStoryBeats(seriesId: string, sourceId?: string): StoryBeatRecord[];
listStoryThreads(seriesId: string, status?: string): StoryThreadRecord[];
upsertCoverageLedger(cov: CoverageLedgerRecord): void;
upsertSeriesPlan(plan: SeriesPlanRecord): void;
}
