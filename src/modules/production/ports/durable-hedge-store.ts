import type { AttemptLease } from "../../../contracts/production.js";
import type { ProviderJobRecord, SeriesBudgetRecord, LlmTokenUsageRecord, LlmTokenUsageSummary, BudgetLedgerSummary } from "../../../contracts/story.js";
import type { ProviderAttemptGroup } from "../../../contracts/production.js";

export interface DurableHedgeStore {
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
atomicReserveProviderGroup(group: ProviderAttemptGroup, jobs: ProviderJobRecord[], cap?: number, forceNew?: boolean, maxReRolls?: number): boolean;
audit(attemptId: string, payload: Record<string, unknown>): void;
chooseWinner(groupId: string, attemptId: string): boolean;
claim(id: string, owner: string, now?: number, duration?: number): AttemptLease | null;
createOrUpdateProviderJob(job: ProviderJobRecord): void;
findGroup(seriesId: string, episode: number, shotId: string, hash: string): ProviderAttemptGroup | null;
getDbPath(): string;
getGroup(id: string): ProviderAttemptGroup | null;
getLlmTokenUsageSummary(seriesId: string): LlmTokenUsageSummary;
getProviderJob(id: string): ProviderJobRecord | null;
getSeriesBudget(seriesId: string): SeriesBudgetRecord;
getSeriesBudgetLedger(seriesId: string): BudgetLedgerSummary;
heartbeat(lease: AttemptLease, now?: number): boolean;
listGroups(): ProviderAttemptGroup[];
putGroup(value: ProviderAttemptGroup): void;
recordLlmTokenUsage(usage: Omit<LlmTokenUsageRecord, "created_at"> & { created_at?: string }): void;
release(lease: AttemptLease): void;
withLease<T>(lease: AttemptLease, fn: () => T): T;
}
