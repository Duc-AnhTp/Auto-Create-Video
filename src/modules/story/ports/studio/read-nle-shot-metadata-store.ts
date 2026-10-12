import type { ShotTakeRecord } from "../../../../contracts/story.js";
export interface ReadNleShotMetadataStore {
    listShotTakes(seriesId: string, episodeNumber: number, shotId?: string): ShotTakeRecord[];
}
