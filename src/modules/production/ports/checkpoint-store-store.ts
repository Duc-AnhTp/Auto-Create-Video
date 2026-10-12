import type { ShotTakeRecord } from "../../../contracts/story.js";

export interface CheckpointStoreStore {
getEquivalentShotIds(shotId: string): string[];
listShotTakes(seriesId: string, episodeNumber: number, shotId?: string): ShotTakeRecord[];
}
