import type { CharacterRecord, LocationRecord, KeyPropRecord, ChekhovGunRecord } from "../../../../contracts/story.js";
export interface ReadNarrativeGraphStore {
    listCharacters(seriesId?: string): CharacterRecord[];
    listLocations(seriesId?: string): LocationRecord[];
    listKeyProps(seriesId?: string): KeyPropRecord[];
    listChekhovGuns(seriesId: string, status?: string): ChekhovGunRecord[];
    getAllWorldState(seriesId?: string): Record<string, unknown>;
    getPropTransfers(propId: string): Array<{
        prop_id: string;
        from_holder_id?: string | null;
        to_holder_id?: string | null;
        episode_number: number;
        created_at: string;
    }>;
}
