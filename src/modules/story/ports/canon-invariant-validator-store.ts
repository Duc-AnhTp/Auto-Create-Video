import type { CharacterRecord, KeyPropRecord, CharacterKnowledgeRecord, StateEventRecord } from "../../../contracts/story.js";

export interface CanonInvariantValidatorStore {
getCharacterKnowledge(characterId: string, upToEpisode?: number): CharacterKnowledgeRecord[];
getKeyProp(id: string, seriesId?: string): KeyPropRecord | null;
listCharacters(seriesId?: string): CharacterRecord[];
listKeyProps(seriesId?: string): KeyPropRecord[];
recordStateEvent(event: StateEventRecord): void;
upsertKeyProp(prop: KeyPropRecord): void;
}
