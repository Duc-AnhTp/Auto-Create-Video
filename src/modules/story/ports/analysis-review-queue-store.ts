import type { CharacterRecord, KeyPropRecord, StoryBeatRecord, StoryThreadRecord, AnalysisReviewItemRecord, ChekhovGunRecord } from "../../../contracts/story.js";

export interface AnalysisReviewQueueStore {
approveReviewItem(id: string, reviewNotes?: string): boolean;
enqueueReviewItem(item: AnalysisReviewItemRecord | Omit<AnalysisReviewItemRecord, "created_at">): AnalysisReviewItemRecord;
getPendingReviewItems(seriesId?: string): AnalysisReviewItemRecord[];
getReviewItem(id: string): AnalysisReviewItemRecord | null;
listReviewItems(seriesId?: string, status?: string): AnalysisReviewItemRecord[];
plantChekhovGun(gun: ChekhovGunRecord): ChekhovGunRecord;
rejectReviewItem(id: string, reviewNotes?: string): boolean;
upsertCharacter(char: CharacterRecord): void;
upsertKeyProp(prop: KeyPropRecord): void;
upsertStoryBeat(beat: StoryBeatRecord): void;
upsertStoryThread(thread: StoryThreadRecord): void;
}
