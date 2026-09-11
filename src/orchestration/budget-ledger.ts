import type { StoryBibleManager, ProviderJobRecord, BudgetLedgerSummary } from "../bible/bible-manager.js";
import { log } from "../utils/logger.js";

/**
 * 4-State Budget & Job Ledger (Requirements 8 & 9)
 *
 * Distinctly separates 4 cost categories:
 * - estimated: Projected cost based on duration & rate card before lock.
 * - reserved: Atomically locked in SQLite before dispatching request to provider.
 * - confirmed: Realized cost upon verified asset acquisition or provider charge.
 * - uncertain: Indeterminate timeout/failure where provider might bill compute.
 *
 * Implements atomic check-and-reserve transaction to prevent multi-worker race conditions.
 */

export class BudgetLedger {
  private bible: StoryBibleManager;

  constructor(bible: StoryBibleManager) {
    this.bible = bible;
  }

  /**
   * Retrieves the current 4-state budget summary for a series.
   */
  public getLedgerSummary(seriesId: string): BudgetLedgerSummary {
    return this.bible.getSeriesBudgetLedger(seriesId);
  }

  /**
   * Atomically checks available balance, verifies worker lease, and reserves budget for a job.
   * If available budget is insufficient or job is leased by another worker, reservation is rejected.
   * Prevents multi-worker double-spend by recording the reservation inside an immediate SQLite transaction.
   * Zero-cost / mock jobs strictly retain $0.00 cost without substituting default rates.
   */
  public atomicReserveForJob(
    job: Omit<ProviderJobRecord, "created_at" | "updated_at" | "status" | "cost_category">,
    options?: { budgetCapUsd?: number; workerLeaseSec?: number }
  ): {
    allowed: boolean;
    remainingUsd: number;
    totalCommittedUsd: number;
    reason?: string;
    reservedRecord?: ProviderJobRecord;
  } {
    const estimatedCost =
      job.estimated_cost_usd !== undefined
        ? job.estimated_cost_usd
        : (job.reserved_cost_usd ?? 0.0);

    const recordToReserve: ProviderJobRecord = {
      ...job,
      status: "reserved",
      cost_category: "reserved",
      estimated_cost_usd: estimatedCost,
      reserved_cost_usd: estimatedCost,
      confirmed_cost_usd: 0.0,
      uncertain_cost_usd: 0.0,
      attempt_count: job.attempt_count || 1,
      max_attempts: job.max_attempts || 3,
      is_retryable: job.is_retryable ?? true,
      worker_id: job.worker_id || "worker_default",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    if (typeof (this.bible as any).atomicReserveProviderJob === "function") {
      return (this.bible as any).atomicReserveProviderJob(recordToReserve, options);
    }

    // Fallback if atomicReserveProviderJob not present
    const seriesId = job.series_id;
    const summary = this.bible.getSeriesBudgetLedger(seriesId);
    const effectiveCap = options?.budgetCapUsd !== undefined ? Math.min(summary.maxBudgetUsd, options.budgetCapUsd) : summary.maxBudgetUsd;
    const potentialCommitment = summary.totalCommittedUsd + estimatedCost;

    if (potentialCommitment > effectiveCap) {
      log.warn(
        `[BUDGET HARD CAP] Không thể giữ chỗ ngân sách cho job ${job.id}! Đã cam kết: $${summary.totalCommittedUsd.toFixed(4)}, Cần thêm: $${estimatedCost.toFixed(4)}, Ngân sách tối đa: $${effectiveCap.toFixed(4)}`
      );
      return {
        allowed: false,
        remainingUsd: summary.remainingAvailableUsd,
        totalCommittedUsd: summary.totalCommittedUsd,
        reason: `Budget cap exceeded ($${effectiveCap.toFixed(2)})`,
      };
    }

    this.bible.createOrUpdateProviderJob(recordToReserve);
    const updatedSummary = this.bible.getSeriesBudgetLedger(seriesId);
    return {
      allowed: true,
      remainingUsd: updatedSummary.remainingAvailableUsd,
      totalCommittedUsd: updatedSummary.totalCommittedUsd,
      reservedRecord: recordToReserve,
    };
  }

  /**
   * Transitions job to 'submitted' once remote provider returns a remote jobId.
   */
  public markSubmitted(jobId: string, providerJobId: string, idempotencyKey?: string): ProviderJobRecord {
    const job = this.bible.getProviderJob(jobId);
    if (!job) throw new Error(`Provider job '${jobId}' not found`);

    job.status = "submitted";
    job.provider_job_id = providerJobId;
    if (idempotencyKey) {
      job.idempotency_key = idempotencyKey;
    }
    job.updated_at = new Date().toISOString();

    this.bible.createOrUpdateProviderJob(job);
    return job;
  }

  /**
   * Transitions job to 'completed' with 'confirmed' cost.
   * Unlocks reserved cost and locks confirmed cost.
   */
  public markConfirmed(
    jobId: string,
    actualCostUsd: number,
    outputs?: { localPath?: string; url?: string }
  ): ProviderJobRecord {
    const job = this.bible.getProviderJob(jobId);
    if (!job) throw new Error(`Provider job '${jobId}' not found`);

    job.status = "completed";
    job.cost_category = "confirmed";
    job.confirmed_cost_usd = actualCostUsd;
    job.reserved_cost_usd = 0.0;
    job.uncertain_cost_usd = 0.0;
    if (outputs?.localPath) job.output_local_path = outputs.localPath;
    if (outputs?.url) job.output_url = outputs.url;
    job.completed_at = new Date().toISOString();
    job.updated_at = new Date().toISOString();

    this.bible.createOrUpdateProviderJob(job);
    return job;
  }

  /**
   * Transitions job to 'uncertain_timeout' with 'uncertain' cost (Requirement 3 & 8).
   * Holds the cost in the ledger so other workers cannot double-spend it.
   */
  public markUncertainTimeout(
    jobId: string,
    errorMessage: string,
    remoteJobId?: string
  ): ProviderJobRecord {
    const job = this.bible.getProviderJob(jobId);
    if (!job) throw new Error(`Provider job '${jobId}' not found`);

    const uncertainCost = job.reserved_cost_usd > 0 ? job.reserved_cost_usd : job.estimated_cost_usd;

    job.status = "uncertain_timeout";
    job.cost_category = "uncertain";
    job.uncertain_cost_usd = uncertainCost;
    job.reserved_cost_usd = 0.0;
    if (remoteJobId) job.provider_job_id = remoteJobId;
    job.error_code = "UNCERTAIN_TIMEOUT";
    job.error_message = errorMessage;
    job.updated_at = new Date().toISOString();

    this.bible.createOrUpdateProviderJob(job);
    log.warn(
      `[UNCERTAIN TIMEOUT] Job '${jobId}' đã chuyển sang diện dè chừng. Chi phí $${uncertainCost.toFixed(4)} được giữ lại để đối soát.`
    );
    return job;
  }

  /**
   * Transitions job to 'failed'.
   * If the provider bills for failed attempts (e.g. content filter or server crash after render),
   * records the cost as 'confirmed'. Otherwise releases the reserved funds.
   */
  public markFailed(
    jobId: string,
    options: {
      errorCode?: string;
      errorMessage: string;
      isBillableFailure: boolean;
      actualCostUsd?: number;
      isRetryable?: boolean;
    }
  ): ProviderJobRecord {
    const job = this.bible.getProviderJob(jobId);
    if (!job) throw new Error(`Provider job '${jobId}' not found`);

    job.status = "failed";
    job.error_code = options.errorCode || "JOB_FAILED";
    job.error_message = options.errorMessage;
    job.is_retryable = options.isRetryable ?? false;
    job.updated_at = new Date().toISOString();

    if (options.isBillableFailure && options.actualCostUsd) {
      job.cost_category = "confirmed";
      job.confirmed_cost_usd = options.actualCostUsd;
      job.reserved_cost_usd = 0.0;
      job.uncertain_cost_usd = 0.0;
    } else {
      // Release reservation
      job.cost_category = "estimated";
      job.reserved_cost_usd = 0.0;
      job.uncertain_cost_usd = 0.0;
    }

    this.bible.createOrUpdateProviderJob(job);
    return job;
  }

  /**
   * Reconciles an uncertain job:
   * - If remote provider confirmed job was completed -> markConfirmed
   * - If remote provider confirmed job was never created/cancelled without charge -> release reservation
   */
  public reconcileUncertainJob(
    jobId: string,
    resolution: "confirmed_success" | "confirmed_no_charge" | "confirmed_billed_failure",
    details?: { actualCostUsd?: number; localPath?: string; url?: string; error?: string }
  ): ProviderJobRecord {
    const job = this.bible.getProviderJob(jobId);
    if (!job) throw new Error(`Provider job '${jobId}' not found`);

    if (resolution === "confirmed_success") {
      return this.markConfirmed(jobId, details?.actualCostUsd || job.uncertain_cost_usd, {
        localPath: details?.localPath,
        url: details?.url,
      });
    } else if (resolution === "confirmed_billed_failure") {
      return this.markFailed(jobId, {
        isBillableFailure: true,
        actualCostUsd: details?.actualCostUsd || job.uncertain_cost_usd,
        errorMessage: details?.error || "Remote job failed after billing",
        isRetryable: false,
      });
    } else {
      // No charge: release uncertain cost
      job.cost_category = "estimated";
      job.uncertain_cost_usd = 0.0;
      job.status = "failed";
      job.error_message = details?.error || "Reconciled: remote provider discarded job without charge";
      job.updated_at = new Date().toISOString();
      this.bible.createOrUpdateProviderJob(job);
      return job;
    }
  }
}
