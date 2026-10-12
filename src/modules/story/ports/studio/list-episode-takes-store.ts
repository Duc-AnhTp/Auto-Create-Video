import type { ShotTakeRecord } from "../../../../contracts/story.js";
export interface ListEpisodeTakesStore {
    listShotTakes(seriesId: string, episodeNumber: number, shotId?: string): ShotTakeRecord[];
}
