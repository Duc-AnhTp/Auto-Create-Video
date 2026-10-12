import type { BudgetLedgerStore } from "../../ports/budget-ledger-store.js";
import type { ProviderJobRecord, BudgetLedgerSummary } from "../../../../contracts/story.js";
import { log } from "../../../../platform/observability/logger.js";

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

export interface TokenSavingsSummary {
  usageStatus:"available"|"unavailable";
  seriesId: string;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCachedTokens: number;
  totalCacheCreationTokens: number;
  totalEstimatedSavingsUsd: number | null;
  cacheHitRatio: number;
}

export class BudgetLedger {
  private bible: BudgetLedgerStore;

  constructor(bible: BudgetLedgerStore) {
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
    job: Partial<ProviderJobRecord> &
      Pick<
        ProviderJobRecord,
        "id" | "series_id" | "episode_number" | "shot_id" | "provider" | "spec_hash"
      >,
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

    return this.bible.atomicReserveProviderJob(recordToReserve,options);
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
    outputs?: {
      localPath?: string;
      url?: string;
      isInvoiced?: boolean;
      metadata?: Record<string, unknown>;
    }
  ): ProviderJobRecord {
    if(!Number.isFinite(actualCostUsd)||actualCostUsd<0)throw new Error('INVALID_CONFIRMED_COST');
    const job = this.bible.getProviderJob(jobId);
    if (!job) throw new Error(`Provider job '${jobId}' not found`);

    const previousMetadata=JSON.parse(job.metadata_json??'{}');
    if(previousMetadata.cost_source==='provider_invoice'&&!outputs?.isInvoiced&&outputs?.metadata?.cost_source!=='manual_reconciliation'){
      actualCostUsd=job.confirmed_cost_usd;
      outputs={...outputs,isInvoiced:true,metadata:{...outputs?.metadata,cost_source:'provider_invoice'}};
    }
    this.bible.audit(jobId,{action:"cost_confirmation",previous:{confirmed:job.confirmed_cost_usd,reserved:job.reserved_cost_usd,uncertain:job.uncertain_cost_usd,metadata:job.metadata_json},amount:actualCostUsd,source:outputs?.metadata?.cost_source??(outputs?.isInvoiced?"provider_invoice":"rate_card_estimate"),timestamp:new Date().toISOString()});
    job.status = "completed";
    job.cost_category = "confirmed";
    job.confirmed_cost_usd = actualCostUsd;
    job.reserved_cost_usd = 0.0;
    job.uncertain_cost_usd = 0.0;
    if (outputs?.localPath) job.output_local_path = outputs.localPath;
    if (outputs?.url) job.output_url = outputs.url;
    if (outputs?.isInvoiced !== undefined || outputs?.metadata) {
      let meta: Record<string, unknown> = {};
      try {
        meta = JSON.parse(job.metadata_json || "{}");
      } catch (caughtError) { log.warn("[budget-ledger] "+String(caughtError)); }
      if (outputs.isInvoiced !== undefined) {
        meta.is_invoiced = outputs.isInvoiced;
        meta.cost_source = outputs.isInvoiced ? "provider_invoice" : "rate_card_estimate";
      }
      if (outputs.metadata) {
        Object.assign(meta, outputs.metadata);
      }
      job.metadata_json = JSON.stringify(meta);
    }
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
    if((options.isBillableFailure&&options.actualCostUsd===undefined)||(options.actualCostUsd!==undefined&&(!Number.isFinite(options.actualCostUsd)||options.actualCostUsd<0)))throw new Error('INVALID_CONFIRMED_COST');
    const job = this.bible.getProviderJob(jobId);
    if (!job) throw new Error(`Provider job '${jobId}' not found`);

    job.status = "failed";
    job.error_code = options.errorCode || "JOB_FAILED";
    job.error_message = options.errorMessage;
    job.is_retryable = options.isRetryable ?? false;
    job.updated_at = new Date().toISOString();

    if (options.isBillableFailure && options.actualCostUsd !== undefined) {
      job.metadata_json=JSON.stringify({...JSON.parse(job.metadata_json??'{}'),cost_source:'provider_invoice',is_invoiced:true});
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
    resolution:
      | "confirmed_success"
      | "confirmed_no_charge"
      | "confirmed_billed_failure"
      | "discard"
      | "confirm"
      | "fail",
    details?: { actualCostUsd?: number; localPath?: string; url?: string; error?: string }
  ): ProviderJobRecord {
    const reconcile=()=>{
    const job = this.bible.getProviderJob(jobId);
    if (!job) throw new Error(`Provider job '${jobId}' not found`);

    const metadata={...JSON.parse(job.metadata_json??'{}'),cost_source:'manual_reconciliation',invoice_conflict:false};
    if(['confirmed_success','confirm','confirmed_billed_failure','fail'].includes(resolution)&&(!Number.isFinite(details?.actualCostUsd)||details!.actualCostUsd!<0))throw new Error('RECONCILIATION_AMOUNT_REQUIRED');
    job.metadata_json=JSON.stringify(metadata);this.bible.createOrUpdateProviderJob(job);
    if (resolution === "confirmed_success" || resolution === "confirm") {
      return this.markConfirmed(jobId, details?.actualCostUsd!, {
        localPath: details?.localPath,
        url: details?.url, isInvoiced:false,metadata,
      });
    } else if (resolution === "confirmed_billed_failure" || resolution === "fail") {
      const reconciled=this.markFailed(jobId, {
        isBillableFailure: true,
        actualCostUsd: details!.actualCostUsd!,
        errorMessage: details?.error || "Remote job failed after billing",
        isRetryable: false,
      });
      reconciled.metadata_json=JSON.stringify(metadata);this.bible.createOrUpdateProviderJob(reconciled);return reconciled;
    } else {
      // No charge: release uncertain cost
      job.cost_category = "estimated";
      job.uncertain_cost_usd = 0.0;
      job.reserved_cost_usd = 0.0;
      job.confirmed_cost_usd = 0.0;
      job.status = "failed";
      job.error_message = details?.error || "Reconciled: remote provider discarded job without charge";
      job.updated_at = new Date().toISOString();
      this.bible.createOrUpdateProviderJob(job);
      return job;
    }
    };return this.bible.transaction?this.bible.transaction(reconcile):reconcile();
  }

  /**
   * Persists provider-reported LLM usage. Dollar savings remain unknown until explicit pricing is supplied.
   */
  public recordTokenUsage(
    seriesId: string,
    usage: {
      inputTokens: number;
      outputTokens: number;
      cachedTokens?: number;
      cacheCreationTokens?: number;
      provider: string;
      model: string;
      estimatedSavingsUsd?: number;
    }
  ): void {
    this.bible.recordLlmTokenUsage({
      series_id: seriesId,
      provider: usage.provider,
      model: usage.model,
      input_tokens: usage.inputTokens,
      output_tokens: usage.outputTokens,
      cached_tokens: usage.cachedTokens ?? 0,
      cache_creation_tokens: usage.cacheCreationTokens ?? 0,
      estimated_savings_usd: usage.estimatedSavingsUsd ?? null,
    });
  }

  /**
   * Returns persisted token usage, cache hit ratio, and an optional rate-based savings estimate.
   */
  public getTokenSavingsSummary(seriesId: string): TokenSavingsSummary {
    const summary = this.bible.getLlmTokenUsageSummary(seriesId);
    return {
      seriesId,
      ...summary,
    };
  }
}
