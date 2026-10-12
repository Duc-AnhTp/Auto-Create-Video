import type { CharacterRecord } from "../../../contracts/story.js";

export interface AudioAssemblerStore {
getCharacter(id: string, seriesId?: string): CharacterRecord | null;
}
