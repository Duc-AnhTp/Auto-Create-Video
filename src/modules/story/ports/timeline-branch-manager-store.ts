import type { CanonSnapshotRecord } from "../../../contracts/story.js";

export interface TimelineBranchManagerStore {
getCanonSnapshot(snapshotId: string): CanonSnapshotRecord | null;
getSnapshotForEpisode(seriesId: string, episodeNumber: number): CanonSnapshotRecord | null;
}
