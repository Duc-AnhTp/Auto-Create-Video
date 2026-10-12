import type { CharacterRecord, CharacterWardrobeRecord, KeyPropRecord } from "../../../contracts/story.js";

export interface EpisodeFingerprintsStore {
getCharacter(id: string, seriesId?: string): CharacterRecord | null;
getKeyProp(id: string, seriesId?: string): KeyPropRecord | null;
getWardrobe(id: string): CharacterWardrobeRecord | null;
}
