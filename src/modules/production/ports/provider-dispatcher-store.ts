import type { AttemptLease } from "../../../contracts/production.js";
import type { ProviderJobRecord, LlmTokenUsageRecord, LlmTokenUsageSummary, BudgetLedgerSummary } from "../../../contracts/story.js";

export interface ProviderDispatcherStore {
atomicReserveProviderJob(job: ProviderJobRecord, options?: {
      budgetCapUsd?: number;
      workerLeaseSec?: number;
    }): {
    allowed: boolean;
    remainingUsd: number;
    totalCommittedUsd: number;
    reason?: string;
    reservedRecord?: ProviderJobRecord;
  };
audit(attemptId: string, payload: Record<string, unknown>): void;
claim(id: string, owner: string, now?: number, duration?: number): AttemptLease | null;
createOrUpdateProviderJob(job: ProviderJobRecord): void;
getDbPath(): string;
getLlmTokenUsageSummary(seriesId: string): LlmTokenUsageSummary;
getProviderJob(id: string): ProviderJobRecord | null;
getSeriesBudgetLedger(seriesId: string): BudgetLedgerSummary;
heartbeat(lease: AttemptLease, now?: number): boolean;
recordLlmTokenUsage(usage: Omit<LlmTokenUsageRecord, "created_at"> & { created_at?: string }): void;
release(lease: AttemptLease): void;
withLease<T>(lease: AttemptLease, fn: () => T): T;
}
