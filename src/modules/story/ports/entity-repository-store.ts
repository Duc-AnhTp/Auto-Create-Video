import type { StateEventRecord } from "../../../contracts/story.js";

export interface EntityRepositoryStore {
listStateEvents(options?: {
    seriesId?: string;
    episodeNumber?: number;
    entityType?: string;
    entityId?: string;
  }): StateEventRecord[];
}
