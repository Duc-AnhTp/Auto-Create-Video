
import type { SeriesMetadataRecord, CharacterRecord, CharacterWardrobeRecord, LocationRecord, KeyPropRecord, CharacterKnowledgeRecord, EpisodeSummaryRecord, CanonSnapshotRecord, KnowledgeStateRecord } from "../../../contracts/story.js";



export interface CanonRepositoryStore {
getSeriesMetadata(id?: string): SeriesMetadataRecord | null;
getCharacter(id: string, seriesId?: string): CharacterRecord | null;
listCharacters(seriesId?: string): CharacterRecord[];
updateCharacterStatus(id: string, status: CharacterRecord["status"], distinguishingMarks?: string): void;
getWardrobe(id: string): CharacterWardrobeRecord | null;
listWardrobesForCharacter(characterId: string): CharacterWardrobeRecord[];
setCharacterActiveWardrobe(characterId: string, wardrobeId: string): void;
getLocation(id: string, seriesId?: string): LocationRecord | null;
listLocations(seriesId?: string): LocationRecord[];
getKeyProp(id: string, seriesId?: string): KeyPropRecord | null;
listKeyProps(seriesId?: string): KeyPropRecord[];
transferKeyProp(propId: string, newHolderId?: string, status?: KeyPropRecord["status"]): void;
addKnowledge(characterId: string, factKey: string, revealedInEpisode: number, notes?: string): void;
getCharacterKnowledge(characterId: string, upToEpisode?: number): CharacterKnowledgeRecord[];
setWorldState(key: string, value: unknown, episodeNumber: number, seriesId?: string): void;
getWorldState(key: string, seriesId?: string): unknown | null;
getWorldStateForEpisode(seriesId:string, episodeNumber:number): Record<string,unknown>;
getAllWorldState(seriesId?: string): Record<string, unknown>;
recordEpisodeSummary(record: EpisodeSummaryRecord): void;
listEpisodeSummaries(seriesId?: string): EpisodeSummaryRecord[];
getCanonSnapshot(snapshotId: string): CanonSnapshotRecord | null;
getSnapshotForEpisode(seriesId: string, episodeNumber: number): CanonSnapshotRecord | null;
recordKnowledgeState(record: Omit<KnowledgeStateRecord, "id" | "created_at">): KnowledgeStateRecord;
}
