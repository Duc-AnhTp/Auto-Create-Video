import type { LocationRecord } from "../../../../contracts/story.js";
export interface SaveLocationStore {
    upsertLocation(loc: LocationRecord): void;
    getLocation(id: string, seriesId?: string): LocationRecord | null;
}
