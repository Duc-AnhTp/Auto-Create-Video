import type { ProviderAttemptGroup, ReferenceProvenance, ProductionArtifact, AttemptLease } from "../../../contracts/production.js";
export interface ProductionStateStore {
transaction<T>(fn: () => T): T;
putReference(value: ReferenceProvenance): void;
getReference(path: string): ReferenceProvenance | null;
listReferences(seriesId: string): ReferenceProvenance[];
putArtifact(value: ProductionArtifact): ProductionArtifact;
getArtifact(id: string): ProductionArtifact | null;
findArtifact(path: string): ProductionArtifact | null;
listArtifacts(seriesId: string, episode: number): ProductionArtifact[];
putGroup(value: ProviderAttemptGroup): void;
getGroup(id: string): ProviderAttemptGroup | null;
findGroup(seriesId: string, episode: number, shotId: string, hash: string): ProviderAttemptGroup | null;
listGroups(): ProviderAttemptGroup[];
chooseWinner(groupId: string, attemptId: string): boolean;
claim(id: string, owner: string, now?: number, duration?: number): AttemptLease | null;
heartbeat(lease: AttemptLease, now?: number): boolean;
withLease<T>(lease: AttemptLease, fn: () => T): T;
release(lease: AttemptLease): void;
audit(attemptId: string, payload: Record<string, unknown>): void;
listAudit(attemptId: string): Record<string, unknown>[];
getRevision(): number;
bumpRevision(): void;
getIndex(key: string): string | null;
putIndex(key: string, payload: string): void;
}
