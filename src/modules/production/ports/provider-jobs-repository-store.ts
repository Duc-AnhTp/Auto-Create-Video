
import type { SeriesMetadataRecord } from "../../../contracts/story.js";
import type { ProviderAttemptGroup } from "../../../contracts/production.js";


export interface ProviderJobsRepositoryStore {
transaction<T>(fn: () => T): T;
putGroup(value: ProviderAttemptGroup): void;
getGroup(id: string): ProviderAttemptGroup | null;
findGroup(seriesId: string, episode: number, shotId: string, hash: string): ProviderAttemptGroup | null;
listGroups(): ProviderAttemptGroup[];
getSeriesMetadata(id?: string): SeriesMetadataRecord | null;
}
