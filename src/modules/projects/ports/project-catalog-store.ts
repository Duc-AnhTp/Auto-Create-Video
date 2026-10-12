
import type { SeriesMetadataRecord, CharacterRecord, LocationRecord, KeyPropRecord, EpisodeSummaryRecord } from "../../../contracts/story.js";



export interface ProjectCatalogStore {
getSeriesMetadata(id?: string): SeriesMetadataRecord | null;
listCharacters(seriesId?: string): CharacterRecord[];
listLocations(seriesId?: string): LocationRecord[];
getCanonHistory(seriesId?: string): EpisodeSummaryRecord[];
listKeyProps(seriesId?: string): KeyPropRecord[];
getAllWorldState(seriesId?: string): Record<string, unknown>;
}
