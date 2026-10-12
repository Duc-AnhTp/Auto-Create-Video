import type { LlmTokenUsageRecord } from "../../../contracts/story.js";

export interface TokenUsageStore {
recordLlmTokenUsage(usage: Omit<LlmTokenUsageRecord, "created_at"> & { created_at?: string }): void;
}
