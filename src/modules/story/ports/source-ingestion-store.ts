import type { SourceWorkRecord, SourceRevisionRecord } from "../../../contracts/story.js";

export interface SourceIngestionStore {
getSourceWork(id: string): SourceWorkRecord | null;
recordSourceWorkWithRevision(work: SourceWorkRecord, rev: SourceRevisionRecord, expectedPreviousRevision?: number): void;
upsertSourceWork(work: SourceWorkRecord): void;
}
