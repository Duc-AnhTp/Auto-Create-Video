import type { SeriesMetadataRecord, CharacterRecord, CharacterWardrobeRecord, LocationRecord, KeyPropRecord, CharacterKnowledgeRecord, EpisodeSummaryRecord, LlmTokenUsageRecord, SourceWorkRecord, SourceUnitRecord, SourceBlockRecord, StoryBeatRecord, StoryThreadRecord, KnowledgeStateRecord, SeriesPlanRecord, PlannedEpisodeRecord, CoverageLedgerRecord, ChekhovGunRecord } from "../../../contracts/story.js";
import type { ContinuityAuditResult, LlmInvoker } from "../application/continuity-auditor.js";

export interface StoryToScreenplayStore {
audit(attemptId: string, payload: Record<string, unknown>): void;
auditDraftScript(episodeNumber: number, draftScript: string, invoker?: LlmInvoker | { llmInvoker?: LlmInvoker; promptTemplate?: string }): Promise<ContinuityAuditResult>;
getActiveSeriesPlan(seriesId: string): SeriesPlanRecord | null;
getAllWorldState(seriesId?: string): Record<string, unknown>;
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
getWardrobe(id: string): CharacterWardrobeRecord | null;
getWorldStateForEpisode(seriesId:string, episodeNumber:number): Record<string,unknown>;
listActiveChekhovGuns(seriesId: string, currentEpisode: number): ChekhovGunRecord[];
listCharacters(seriesId?: string): CharacterRecord[];
listCharactersForEpisode(seriesId:string, episode:number): CharacterRecord[];
listCoverageLedgers(planOrSeriesId: string): CoverageLedgerRecord[];
listEpisodeSummaries(seriesId?: string): EpisodeSummaryRecord[];
listKeyProps(seriesId?: string): KeyPropRecord[];
listKeyPropsForEpisode(seriesId:string, episode:number): KeyPropRecord[];
listKnowledgeStates(seriesId: string, entityId?: string, factType?: string): KnowledgeStateRecord[];
listLocations(seriesId?: string): LocationRecord[];
listSourceBlocks(unitId: string): SourceBlockRecord[];
listSourceUnits(sourceId: string, revision?: number): SourceUnitRecord[];
listSourceWorks(seriesId?: string): SourceWorkRecord[];
listStoryBeats(seriesId: string, sourceId?: string): StoryBeatRecord[];
listStoryThreads(seriesId: string, status?: string): StoryThreadRecord[];
putIndex(key: string, payload: string): void;
recordLlmTokenUsage(usage: Omit<LlmTokenUsageRecord, "created_at"> & { created_at?: string }): void;
upsertCoverageLedger(cov: CoverageLedgerRecord): void;
}
