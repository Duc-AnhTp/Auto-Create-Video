import type { SourceUnitRecord, SourceBlockRecord, StoryBeatRecord, SeriesPlanRecord, CoverageLedgerRecord } from "../../../contracts/story.js";

export interface CoverageLedgerStore {
getSeriesPlan(id: string): SeriesPlanRecord | null;
listCoverageLedgers(planOrSeriesId: string): CoverageLedgerRecord[];
listSourceBlocks(unitId: string): SourceBlockRecord[];
listSourceUnits(sourceId: string, revision?: number): SourceUnitRecord[];
listStoryBeats(seriesId: string, sourceId?: string): StoryBeatRecord[];
upsertCoverageLedger(cov: CoverageLedgerRecord): void;
}
