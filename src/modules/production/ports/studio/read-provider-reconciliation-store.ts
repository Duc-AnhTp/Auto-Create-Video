import type { BudgetLedgerStore } from "../budget-ledger-store.js";
import type { ReferenceProvenance, ProductionArtifact } from "../../../../contracts/production.js";
import type { SeriesMetadataRecord, CharacterRecord, LocationRecord, ProviderJobRecord } from "../../../../contracts/story.js";
import type { ProviderAttemptGroup } from "../../../../contracts/production.js";
export interface ReadProviderReconciliationStore extends BudgetLedgerStore {
    unresolvedUsage?(seriesId:string):number;
    legacyUsageReview?(seriesId:string):Record<string,unknown>[];
    listProviderJobs(seriesId?: string, episodeNumber?: number): ProviderJobRecord[];
    listCharacters(seriesId?: string): CharacterRecord[];
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
    listGroups(): ProviderAttemptGroup[];
    listAudit(attemptId: string): Record<string, unknown>[];
}
