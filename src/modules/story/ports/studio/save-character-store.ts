import type { CharacterRecord } from "../../../../contracts/story.js";
export interface SaveCharacterStore {
    upsertCharacter(char: CharacterRecord): void;
    getCharacter(id: string, seriesId?: string): CharacterRecord | null;
}
