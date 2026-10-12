import type { ShotTakeRecord } from "../../../../contracts/story.js";
export interface ApproveEpisodeTakeStore {
    getShotTake(takeId: string): ShotTakeRecord | null;
    getEquivalentShotIds(shotId: string): string[];
    approveShotTake(takeId: string): void;
}
