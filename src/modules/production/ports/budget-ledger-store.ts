import type { ProviderJobRecord, LlmTokenUsageRecord, LlmTokenUsageSummary, BudgetLedgerSummary } from "../../../contracts/story.js";

export interface BudgetLedgerStore {
transaction?<T>(fn:()=>T):T;
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
createOrUpdateProviderJob(job: ProviderJobRecord): void;
getLlmTokenUsageSummary(seriesId: string): LlmTokenUsageSummary;
getProviderJob(id: string): ProviderJobRecord | null;
getSeriesBudgetLedger(seriesId: string): BudgetLedgerSummary;
recordLlmTokenUsage(usage: Omit<LlmTokenUsageRecord, "created_at"> & { created_at?: string }): void;
}
