import type { ShotTakeRecord } from "../../../../contracts/story.js";
export interface ApproveConformedTakesStore {
    listShotTakes(seriesId: string, episodeNumber: number, shotId?: string): ShotTakeRecord[];
    approveShotTake(takeId: string): void;
}
