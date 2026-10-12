import type { CharacterRecord, KeyPropRecord, LlmTokenUsageRecord, StoryBeatRecord, StoryThreadRecord, KnowledgeStateRecord, AnalysisReviewItemRecord, ChekhovGunRecord } from "../../../contracts/story.js";

export interface StoryAnalyzerStore {
approveReviewItem(id: string, reviewNotes?: string): boolean;
audit(attemptId: string, payload: Record<string, unknown>): void;
batchUpsertStoryBeats(beats: StoryBeatRecord[]): void;
enqueueReviewItem(item: AnalysisReviewItemRecord | Omit<AnalysisReviewItemRecord, "created_at">): AnalysisReviewItemRecord;
getPendingReviewItems(seriesId?: string): AnalysisReviewItemRecord[];
getReviewItem(id: string): AnalysisReviewItemRecord | null;
listReviewItems(seriesId?: string, status?: string): AnalysisReviewItemRecord[];
plantChekhovGun(gun: ChekhovGunRecord): ChekhovGunRecord;
recordKnowledgeState(record: Omit<KnowledgeStateRecord, "id" | "created_at">): KnowledgeStateRecord;
recordLlmTokenUsage(usage: Omit<LlmTokenUsageRecord, "created_at"> & { created_at?: string }): void;
rejectReviewItem(id: string, reviewNotes?: string): boolean;
upsertCharacter(char: CharacterRecord): void;
upsertKeyProp(prop: KeyPropRecord): void;
upsertStoryBeat(beat: StoryBeatRecord): void;
upsertStoryThread(thread: StoryThreadRecord): void;
}
