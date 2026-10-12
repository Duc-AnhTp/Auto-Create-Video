import type { DurableHedgeStore } from "./durable-hedge-store.js";
import type { AttemptLease } from "../../../contracts/production.js";
import type { ProviderJobRecord, SeriesBudgetRecord, ProviderRateCardRecord, LlmTokenUsageRecord, LlmTokenUsageSummary, BudgetLedgerSummary } from "../../../contracts/story.js";

export interface JobOrchestratorStore extends DurableHedgeStore {
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
findCompletedJobBySpecHash(specHash: string): ProviderJobRecord | null;
getDbPath(): string;
getLlmTokenUsageSummary(seriesId: string): LlmTokenUsageSummary;
getProviderJob(id: string): ProviderJobRecord | null;
getProviderJobsForShot(seriesId: string, episodeNumber: number, shotId: string): ProviderJobRecord[];
getRateCard(provider: string, modelName?: string): ProviderRateCardRecord | null;
getSeriesBudget(seriesId: string): SeriesBudgetRecord;
getSeriesBudgetLedger(seriesId: string): BudgetLedgerSummary;
heartbeat(lease: AttemptLease, now?: number): boolean;
listPendingJobsForSeries(seriesId: string, episodeNumber?: number): ProviderJobRecord[];
listRateCards(provider?: string): ProviderRateCardRecord[];
recordLlmTokenUsage(usage: Omit<LlmTokenUsageRecord, "created_at"> & { created_at?: string }): void;
release(lease: AttemptLease): void;
setRateCard(rateCard: any): void;
withLease<T>(lease: AttemptLease, fn: () => T): T;
}
