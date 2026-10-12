import type { ChekhovGunRecord } from "../../../contracts/story.js";

export interface ChekhovTrackerStore {
listActiveChekhovGuns(seriesId: string, currentEpisode: number): ChekhovGunRecord[];
}
