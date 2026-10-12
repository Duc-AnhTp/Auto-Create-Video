import type { SeriesMetadataRecord, CharacterRecord, LocationRecord, KeyPropRecord, CharacterKnowledgeRecord, EpisodeSummaryRecord, SourceWorkRecord, SourceUnitRecord, StoryBeatRecord, StoryThreadRecord, KnowledgeStateRecord, SeriesPlanRecord, PlannedEpisodeRecord, CoverageLedgerRecord, ChekhovGunRecord } from "../../../contracts/story.js";

export interface ContextBuilderStore {
getActiveSeriesPlan(seriesId: string): SeriesPlanRecord | null;
getCanonHistory(seriesId?: string): EpisodeSummaryRecord[];
getCharacterKnowledge(characterId: string, upToEpisode?: number): CharacterKnowledgeRecord[];
getDbPath(): string;
getEpisodeSummary(episodeNumber: number, seriesId?: string): EpisodeSummaryRecord | null;
getIndex(key: string): string | null;
getNegativeConstraints(episodeNumber: number, seriesId?: string): string[];
getPlannedEpisode(planIdOrId: string, episodeNumber?: number): PlannedEpisodeRecord | null;
getRevision(): number;
getSeriesMetadata(id?: string): SeriesMetadataRecord | null;
getSeriesPlan(id: string): SeriesPlanRecord | null;
getSourceUnit(id: string): SourceUnitRecord | null;
getWorldStateForEpisode(seriesId:string, episodeNumber:number): Record<string,unknown>;
listActiveChekhovGuns(seriesId: string, currentEpisode: number): ChekhovGunRecord[];
listCharacters(seriesId?: string): CharacterRecord[];
listCharactersForEpisode(seriesId:string, episode:number): CharacterRecord[];
listCoverageLedgers(planOrSeriesId: string): CoverageLedgerRecord[];
listEpisodeSummaries(seriesId?: string): EpisodeSummaryRecord[];
listKeyPropsForEpisode(seriesId:string, episode:number): KeyPropRecord[];
listKnowledgeStates(seriesId: string, entityId?: string, factType?: string): KnowledgeStateRecord[];
listLocations(seriesId?: string): LocationRecord[];
listSourceWorks(seriesId?: string): SourceWorkRecord[];
listStoryBeats(seriesId: string, sourceId?: string): StoryBeatRecord[];
listStoryThreads(seriesId: string, status?: string): StoryThreadRecord[];
putIndex(key: string, payload: string): void;
}
