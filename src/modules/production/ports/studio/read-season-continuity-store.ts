import type { CharacterRecord, KeyPropRecord, CharacterKnowledgeRecord, StateEventRecord, ChekhovGunRecord } from "../../../../contracts/story.js";
export interface ReadSeasonContinuityStore {
    getCharacterKnowledge(characterId: string, upToEpisode?: number): CharacterKnowledgeRecord[];
    listCharacters(seriesId?: string): CharacterRecord[];
    listChekhovGuns(seriesId: string, status?: string): ChekhovGunRecord[];
    listKeyProps(seriesId?: string): KeyPropRecord[];
    listStateEvents(options?: {
        seriesId?: string;
        episodeNumber?: number;
        entityType?: string;
        entityId?: string;
    }): StateEventRecord[];
}
