import type { CharacterRecord, LocationRecord, KeyPropRecord, CharacterKnowledgeRecord, EpisodeSummaryRecord, SourceWorkRecord, StoryBeatRecord, SeriesPlanRecord, CoverageLedgerRecord } from "../../../../contracts/story.js";
export interface QuerySemanticMemoryStore {
    getActiveSeriesPlan(seriesId: string): SeriesPlanRecord | null;
    getCharacterKnowledge(characterId: string, upToEpisode?: number): CharacterKnowledgeRecord[];
    getDbPath(): string;
    getIndex(key: string): string | null;
    getRevision(): number;
    getWorldStateForEpisode(seriesId: string, episodeNumber: number): Record<string, unknown>;
    listCharactersForEpisode(seriesId: string, episode: number): CharacterRecord[];
    listCoverageLedgers(planOrSeriesId: string): CoverageLedgerRecord[];
    listEpisodeSummaries(seriesId?: string): EpisodeSummaryRecord[];
    listKeyPropsForEpisode(seriesId: string, episode: number): KeyPropRecord[];
    listLocations(seriesId?: string): LocationRecord[];
    listSourceWorks(seriesId?: string): SourceWorkRecord[];
    listStoryBeats(seriesId: string, sourceId?: string): StoryBeatRecord[];
    putIndex(key: string, payload: string): void;
    listCharacters(seriesId?: string): CharacterRecord[];
    listKeyProps(seriesId?: string): KeyPropRecord[];
}
