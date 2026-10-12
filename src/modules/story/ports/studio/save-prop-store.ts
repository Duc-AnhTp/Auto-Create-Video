import type { KeyPropRecord } from "../../../../contracts/story.js";
export interface SavePropStore {
    upsertKeyProp(prop: KeyPropRecord): void;
    getKeyProp(id: string, seriesId?: string): KeyPropRecord | null;
}
