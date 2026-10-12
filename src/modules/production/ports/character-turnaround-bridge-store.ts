import type { ReferenceProvenance, ProductionArtifact } from "../../../contracts/production.js";
import type { SeriesMetadataRecord, CharacterRecord, LocationRecord } from "../../../contracts/story.js";

export interface CharacterTurnaroundBridgeStore {
getArtifact(id: string): ProductionArtifact | null;
getCharacter(id: string, seriesId?: string): CharacterRecord | null;
getLocation(id: string, seriesId?: string): LocationRecord | null;
getReference(path: string): ReferenceProvenance | null;
getSeriesMetadata(id?: string): SeriesMetadataRecord | null;
listArtifacts(seriesId: string, episode: number): ProductionArtifact[];
putArtifact(value: ProductionArtifact): ProductionArtifact;
putReference(value: ReferenceProvenance): void;
upsertCharacter(char: CharacterRecord): void;
upsertLocation(loc: LocationRecord): void;
}
