import type { ShotTakeRecord, StateEventRecord } from "../../../contracts/story.js";

export interface NleIngestParserStore {
listShotTakes(seriesId: string, episodeNumber: number, shotId?: string): ShotTakeRecord[];
recordStateEvent(event: StateEventRecord): void;
upsertShotTake(take: ShotTakeRecord): void;
}
