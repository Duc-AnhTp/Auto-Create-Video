import type { SeriesMetadataRecord } from "../../../../contracts/story.js";
export interface InitializeStoryStore {
    upsertSeriesMetadata(meta: SeriesMetadataRecord): void;
}
