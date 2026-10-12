import type { ReferenceProvenance, ProductionArtifact } from "../../../contracts/production.js";

export interface ArtifactStoreStore {
getArtifact(id: string): ProductionArtifact | null;
getReference(path: string): ReferenceProvenance | null;
listArtifacts(seriesId: string, episode: number): ProductionArtifact[];
putArtifact(value: ProductionArtifact): ProductionArtifact;
putReference(value: ReferenceProvenance): void;
}
