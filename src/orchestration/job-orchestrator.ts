import { existsSync } from "node:fs";
import { copyFile } from "node:fs/promises";
import { join } from "node:path";
import type { StoryBibleManager, ProviderJobRecord } from "../bible/bible-manager.js";
import { BudgetLedger } from "./budget-ledger.js";
import { RateCardManager } from "./rate-card-manager.js";
import {
  ResilientCircuitBreaker,
  ProviderConcurrencyLimiter,
  classifyProviderError,
  calculateBackoffWithJitter,
} from "./concurrency-and-retry.js";
import { computeVideoSpecHash } from "./spec-hasher.js";
import {
  type BackendProvider,
  type ShotExecutionSpec,
  type VideoJobStatus,
  type VideoProviderAdapter,
  VideoModelGateway,
  BudgetExceededError,
  CircuitBreakerOpenError,
  downloadVideoFromUrl,
} from "../gateway/video-gateway.js";
import { PROVIDER_CAPABILITY_REGISTRY } from "../gateway/provider-capabilities.js";
import { log } from "../utils/logger.js";

/**
 * Uncertain Timeout Error (Requirement 3)
 */
export class UncertainTimeoutError extends Error {
  public readonly jobId: string;
  public readonly provider: string;
  public readonly specHash: string;

  constructor(jobId: string, provider: string, specHash: string, originalMessage?: string) {
    super(
      `[UNCERTAIN TIMEOUT] Request submit tới provider '${provider}' bị timeout hoặc mất kết nối. Provider có thể đã nhận và đang sinh shot. Job '${jobId}' đã được gắn cờ 'uncertain_timeout' để đối soát; tuyệt đối không retry mù.` +
        (originalMessage ? ` Chi tiết: ${originalMessage}` : "")
    );
    this.name = "UncertainTimeoutError";
    this.jobId = jobId;
    this.provider = provider;
    this.specHash = specHash;
  }
}

export interface OrchestratorOptions {
  workerId?: string;
  maxAttempts?: number;
  pollIntervalMs?: number;
  pollTimeoutMs?: number;
  submitTimeoutMs?: number;
}

export interface ShotOrchestrationResult {
  jobId: string;
  providerJobId?: string;
  status: "completed" | "cached" | "failed" | "uncertain_timeout";
  videoPath?: string;
  videoUrl?: string;
  costUsd: number;
  specHash: string;
  isCacheHit: boolean;
  attemptsUsed: number;
}

/**
 * Resilient Job Orchestrator
 *
 * Implements full requirements:
 * 1. Persistent provider job tracking (remote jobId, specHash, attempt, output, cost).
 * 2. Resume polling without resubmit on restart.
 * 3. Uncertain timeout handling without blind retries.
 * 4. Selective idempotency key usage only when supported.
 * 5. Full input spec hash caching.
 * 7. Concurrency limits, exponential backoff with jitter, error classification.
 * 8. 4-state cost ledger.
 * 9. Multi-worker safe budget protection.
 * 10. Configurable rate cards.
 * 11. 3-state circuit breaker with HALF_OPEN probing.
 */
export class ResilientJobOrchestrator {
  private bible: StoryBibleManager;
  private ledger: BudgetLedger;
  private rateManager: RateCardManager;
  private gateway: VideoModelGateway;
  private circuitBreakers: Map<string, ResilientCircuitBreaker> = new Map();
  private concurrencyLimiter: ProviderConcurrencyLimiter;
  private workerId: string;
  private maxAttempts: number;
  private pollIntervalMs: number;
  private pollTimeoutMs: number;
  private submitTimeoutMs: number;

  constructor(
    bible: StoryBibleManager,
    gateway: VideoModelGateway,
    options: OrchestratorOptions = {}
  ) {
    this.bible = bible;
    this.gateway = gateway;
    this.ledger = new BudgetLedger(bible);
    this.rateManager = new RateCardManager(bible);
    this.rateManager.seedDefaultRatesIfEmpty();
    this.concurrencyLimiter = new ProviderConcurrencyLimiter();

    this.workerId = options.workerId || `worker_${process.pid}_${Math.random().toString(36).slice(2, 7)}`;
    this.maxAttempts = options.maxAttempts || 3;
    this.pollIntervalMs = options.pollIntervalMs || 1500;
    this.pollTimeoutMs = options.pollTimeoutMs || 120000; // 2 min
    this.submitTimeoutMs = options.submitTimeoutMs || 30000; // 30s submit timeout
  }

  public getLedger(): BudgetLedger {
    return this.ledger;
  }

  public getRateManager(): RateCardManager {
    return this.rateManager;
  }

  public getCircuitBreaker(provider: string): ResilientCircuitBreaker {
    let cb = this.circuitBreakers.get(provider);
    if (!cb) {
      cb = new ResilientCircuitBreaker(provider, {
        maxConsecutiveFailures: 3,
        baseCooldownMs: 10000,
        maxCooldownMs: 120000,
      });
      this.circuitBreakers.set(provider, cb);
    }
    return cb;
  }

  /**
   * Executes a video shot with end-to-end resilience:
   * Spec hash cache hit -> Resume polling check -> Atomic budget reservation -> Safe submit -> Polling -> Cost confirmation.
   */
  public async executeShot(
    seriesId: string,
    episodeNumber: number,
    spec: ShotExecutionSpec,
    options: {
      destinationPath?: string;
      modelName?: string;
      forceReRender?: boolean;
      budgetCapUsd?: number;
    } = {}
  ): Promise<ShotOrchestrationResult> {
    const provider = spec.backend || "mock";
    const modelName = options.modelName || (spec.metadata?.modelName as string) || "default";
    const destinationPath = options.destinationPath || spec.destinationLocalPath;

    // STEP 1: Compute full deterministic spec hash (Requirement 5)
    const specHash = computeVideoSpecHash({
      prompt: spec.prompt,
      negativePrompt: spec.metadata?.negativePrompt as string,
      provider,
      modelName,
      durationSec: spec.durationSec,
      aspectRatio: spec.aspectRatio,
      seed: spec.seed,
      referenceImagePath: spec.referenceImage,
      firstFrameConditionPath: spec.firstFrameCondition,
      loras: spec.loras,
      extraParameters: spec.metadata,
    });

    // STEP 2: Cache Hit Check (Requirement 5)
    if (!options.forceReRender) {
      const cachedJob = this.bible.findCompletedJobBySpecHash(specHash);
      if (cachedJob && cachedJob.output_local_path && existsSync(cachedJob.output_local_path)) {
        log.info(
          `[CACHE HIT: SPEC HASH] Shot [${spec.shotId}] khớp 100% hash (${specHash.slice(0, 10)}...). Tái sử dụng clip: ${cachedJob.output_local_path}`
        );
        return {
          jobId: cachedJob.id,
          providerJobId: cachedJob.provider_job_id,
          status: "cached",
          videoPath: cachedJob.output_local_path,
          videoUrl: cachedJob.output_url,
          costUsd: 0.0, // Cache hit incurs $0 additional compute
          specHash,
          isCacheHit: true,
          attemptsUsed: cachedJob.attempt_count,
        };
      }
    }

    // STEP 3: Existing In-Flight Job Check (Requirements 2 & 3: Resume after restart)
    const baseJobId = `pjob_${seriesId}_ep${episodeNumber}_${spec.shotId}`;
    let localJobId = baseJobId;
    const existingJob = this.bible.getProviderJob(baseJobId);
    if (existingJob) {
      if (existingJob.status === "uncertain_timeout") {
        throw new UncertainTimeoutError(
          existingJob.id,
          existingJob.provider,
          existingJob.spec_hash,
          "Job đang ở trạng thái 'uncertain_timeout'. Cần chạy lệnh đối soát (reconcile) trước khi submit lại."
        );
      }

      if (
        (existingJob.status === "submitted" || existingJob.status === "running") &&
        existingJob.provider_job_id
      ) {
        // Resume polling only if provider and spec_hash match!
        if (existingJob.provider === provider && existingJob.spec_hash === specHash) {
          log.info(
            `[RESUME POLLING] Phát hiện job [${existingJob.id}] đã submit lên provider '${existingJob.provider}' (Remote ID: ${existingJob.provider_job_id}). Tiếp tục polling, không gửi lại job mới.`
          );
          return await this.pollExistingJobToCompletion(existingJob, spec, destinationPath);
        } else {
          log.warn(
            `[IN-FLIGHT SPEC MISMATCH] Job cũ [${existingJob.id}] đang chạy trên provider '${existingJob.provider}' với specHash ${existingJob.spec_hash.slice(0, 8)}, nhưng yêu cầu mới dùng provider '${provider}' với specHash ${specHash.slice(0, 8)}. Giữ nguyên job cũ để đối soát và tạo phiên bản mới.`
          );
          // Version new job ID to preserve historical job identity and cost
          localJobId = `${baseJobId}_v${Date.now()}`;
        }
      }
    }

    // STEP 4: Resolve Pricing via Configurable Rate Cards (Requirement 10)
    const rateInfo = this.rateManager.resolveRate(provider, modelName);
    const estimatedCostUsd = Number((spec.durationSec * rateInfo.ratePerSecUsd).toFixed(4));

    // STEP 5: Atomic Budget Reservation (Requirements 8 & 9)
    const reservation = this.ledger.atomicReserveForJob(
      {
        id: localJobId,
        series_id: seriesId,
        episode_number: episodeNumber,
        shot_id: spec.shotId,
        provider,
        model_name: modelName,
        spec_hash: specHash,
        attempt_count: 1,
        max_attempts: this.maxAttempts,
        estimated_cost_usd: estimatedCostUsd,
        reserved_cost_usd: estimatedCostUsd,
        confirmed_cost_usd: 0.0,
        uncertain_cost_usd: 0.0,
        worker_id: this.workerId,
        is_retryable: true,
      },
      {
        budgetCapUsd: options.budgetCapUsd,
      }
    );

    if (!reservation.allowed) {
      throw new BudgetExceededError(
        reservation.totalCommittedUsd,
        options.budgetCapUsd !== undefined ? options.budgetCapUsd : this.bible.getSeriesBudget(seriesId).max_budget_usd,
        estimatedCostUsd
      );
    }

    // STEP 6: Execute with Retries, Circuit Breaker & Concurrency (Requirements 4, 7, 11)
    let currentAttempt = 1;
    while (currentAttempt <= this.maxAttempts) {
      try {
        return await this.executeSingleAttempt(
          localJobId,
          seriesId,
          episodeNumber,
          spec,
          specHash,
          provider,
          modelName,
          estimatedCostUsd,
          currentAttempt,
          destinationPath
        );
      } catch (err: any) {
        const classified = classifyProviderError(err);
        log.warn(
          `[SHOT ATTEMPT FAILED] Shot [${spec.shotId}] (Attempt ${currentAttempt}/${this.maxAttempts}) gặp lỗi [${classified.category}]: ${err.message}`
        );

        if (err instanceof UncertainTimeoutError || err instanceof BudgetExceededError) {
          // Do NOT retry on uncertain timeout or budget cap
          throw err;
        }

        if (!classified.isRetryable || currentAttempt >= this.maxAttempts) {
          // Final non-retryable failure
          this.ledger.markFailed(localJobId, {
            errorMessage: err.message,
            isBillableFailure: false,
            isRetryable: false,
          });
          throw err;
        }

        // Calculate backoff with jitter
        const backoffMs = calculateBackoffWithJitter(currentAttempt);
        log.info(`  Đang chờ ${backoffMs}ms trước khi thử lại...`);
        await new Promise((r) => setTimeout(r, backoffMs));
        currentAttempt++;

        // Update attempt count in DB
        const jobRecord = this.bible.getProviderJob(localJobId);
        if (jobRecord) {
          jobRecord.attempt_count = currentAttempt;
          this.bible.createOrUpdateProviderJob(jobRecord);
        }
      }
    }

    throw new Error(`Shot ${spec.shotId} failed after ${this.maxAttempts} attempts`);
  }

  /**
   * Dispatches a single submit-and-poll attempt with concurrency and circuit breaker protection.
   */
  private async executeSingleAttempt(
    localJobId: string,
    seriesId: string,
    episodeNumber: number,
    spec: ShotExecutionSpec,
    specHash: string,
    provider: BackendProvider,
    modelName: string,
    estimatedCostUsd: number,
    attempt: number,
    destinationPath?: string
  ): Promise<ShotOrchestrationResult> {
    const cb = this.getCircuitBreaker(provider);
    if (!cb.canExecute()) {
      throw new CircuitBreakerOpenError(provider);
    }

    const adapter = this.gateway.getAdapter(provider);
    if (!adapter) {
      throw new Error(`Provider adapter for '${provider}' is not registered`);
    }

    // Step 6a: Idempotency Key Handling (Requirement 4)
    let idempotencyKey: string | undefined = undefined;
    const caps = PROVIDER_CAPABILITY_REGISTRY[provider];
    if (caps?.supportsIdempotencyKey) {
      // Only generate idempotency key when provider officially supports it!
      idempotencyKey = `idem_${seriesId}_ep${episodeNumber}_${spec.shotId}_att${attempt}_${specHash.slice(0, 8)}`;
    }

    // Step 6b: Submit with concurrency limiting
    let remoteJobId: string;
    try {
      remoteJobId = await this.concurrencyLimiter.runWithConcurrency(provider, async () => {
        return await this.submitWithTimeout(adapter, spec, idempotencyKey);
      });
    } catch (submitErr: any) {
      cb.recordFailure(submitErr);
      const classified = classifyProviderError(submitErr);
      const lowerErrMsg = String(submitErr?.message || "").toLowerCase();

      if (
        classified.category === "network_drop" ||
        lowerErrMsg.includes("timeout") ||
        lowerErrMsg.includes("timed out") ||
        lowerErrMsg.includes("etimedout")
      ) {
        // UNCERTAIN TIMEOUT (Requirement 3): provider may have received the job!
        this.ledger.markUncertainTimeout(localJobId, submitErr.message);
        throw new UncertainTimeoutError(localJobId, provider, specHash, submitErr.message);
      }
      throw submitErr;
    }

    // Step 6c: IMMEDIATELY PERSIST REMOTE JOB ID (Requirement 1 & 2)
    this.ledger.markSubmitted(localJobId, remoteJobId, idempotencyKey);
    log.info(
      `[JOB SUBMITTED] Provider '${provider}' đã tiếp nhận task. Remote Job ID: ${remoteJobId} (Lưu bền vững vào SQLite)`
    );

    // Step 6d: Poll until completion
    const jobRecord = this.bible.getProviderJob(localJobId)!;
    return await this.pollExistingJobToCompletion(jobRecord, spec, destinationPath);
  }

  /**
   * Submits a job with a strict timeout boundary to catch indeterminate network hangs.
   */
  private async submitWithTimeout(
    adapter: VideoProviderAdapter,
    spec: ShotExecutionSpec,
    idempotencyKey?: string
  ): Promise<string> {
    const submitPromise = adapter.submitJob({
      ...spec,
      metadata: {
        ...spec.metadata,
        idempotencyKey,
      },
    });

    let timeoutTimer: NodeJS.Timeout;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutTimer = setTimeout(() => {
        reject(new Error(`Submit request to provider '${adapter.providerName}' timed out after ${this.submitTimeoutMs}ms`));
      }, this.submitTimeoutMs);
    });

    try {
      const res = await Promise.race([submitPromise, timeoutPromise]);
      clearTimeout(timeoutTimer!);
      return res.jobId;
    } catch (err) {
      clearTimeout(timeoutTimer!);
      throw err;
    }
  }

  /**
   * Resumes polling an already-submitted remote job until completion without re-submitting.
   */
  public async pollExistingJobToCompletion(
    jobRecord: ProviderJobRecord,
    spec: ShotExecutionSpec,
    destinationPath?: string
  ): Promise<ShotOrchestrationResult> {
    const provider = jobRecord.provider as BackendProvider;
    const adapter = this.gateway.getAdapter(provider);
    if (!adapter) {
      throw new Error(`Provider adapter '${provider}' not available to resume polling`);
    }

    const cb = this.getCircuitBreaker(provider);
    const remoteJobId = jobRecord.provider_job_id;
    if (!remoteJobId) {
      throw new Error(`Job '${jobRecord.id}' does not possess a provider_job_id to poll`);
    }

    const startTime = Date.now();
    let delay = this.pollIntervalMs;

    while (Date.now() - startTime < this.pollTimeoutMs) {
      let status: VideoJobStatus;
      try {
        status = await adapter.pollStatus(remoteJobId);
      } catch (pollErr: any) {
        cb.recordFailure(pollErr);
        throw pollErr;
      }

      if (status.status === "completed") {
        cb.recordSuccess();

        // Download video if remote URL provided
        const targetPath = destinationPath || jobRecord.output_local_path || spec.destinationLocalPath;
        let finalLocalPath = status.localPath;

        if (targetPath && status.videoUrl && (!finalLocalPath || !existsSync(finalLocalPath))) {
          try {
            await downloadVideoFromUrl(status.videoUrl, targetPath, provider !== "mock");
            finalLocalPath = targetPath;
          } catch (dlErr: any) {
            cb.recordFailure(dlErr);
            throw new Error(`Tải video hoàn thành thất bại: ${dlErr.message}`);
          }
        } else if (targetPath && finalLocalPath && finalLocalPath !== targetPath && existsSync(finalLocalPath)) {
          try {
            await copyFile(finalLocalPath, targetPath);
            finalLocalPath = targetPath;
          } catch (copyErr: any) {
            log.warn(`Không thể copy video sang destinationPath: ${copyErr.message}`);
          }
        }

        const actualCost = jobRecord.reserved_cost_usd || jobRecord.estimated_cost_usd;
        const updatedJob = this.ledger.markConfirmed(jobRecord.id, actualCost, {
          localPath: finalLocalPath,
          url: status.videoUrl,
        });

        log.info(
          `[SHOT COMPLETED] Shot [${spec.shotId}] hoàn thành thành công. File: ${finalLocalPath || status.videoUrl}. Chi phí xác nhận: $${actualCost.toFixed(4)}`
        );

        return {
          jobId: updatedJob.id,
          providerJobId: remoteJobId,
          status: "completed",
          videoPath: finalLocalPath,
          videoUrl: status.videoUrl,
          costUsd: actualCost,
          specHash: jobRecord.spec_hash,
          isCacheHit: false,
          attemptsUsed: jobRecord.attempt_count,
        };
      }

      if (status.status === "failed") {
        cb.recordFailure();
        this.ledger.markFailed(jobRecord.id, {
          errorMessage: status.error || "Provider reported job failure",
          isBillableFailure: false,
          isRetryable: false,
        });
        throw new Error(`Remote job ${remoteJobId} failed on provider ${provider}: ${status.error || "unknown"}`);
      }

      // Backoff sleep
      await new Promise((r) => setTimeout(r, delay));
      delay = Math.min(delay * 1.25, 6000);
    }

    cb.recordFailure();
    throw new Error(`Polling remote job ${remoteJobId} timed out after ${this.pollTimeoutMs}ms`);
  }

  /**
   * Scans and resumes all pending/running jobs for a series/episode (CLI series:resume).
   */
  public async resumePendingJobsForSeries(
    seriesId: string,
    episodeNumber?: number
  ): Promise<{
    resumedCount: number;
    completedCount: number;
    uncertainCount: number;
    failedCount: number;
  }> {
    const pendingJobs = this.bible.listPendingJobsForSeries(seriesId, episodeNumber);
    let resumedCount = 0;
    let completedCount = 0;
    let uncertainCount = 0;
    let failedCount = 0;

    for (const job of pendingJobs) {
      if (job.status === "uncertain_timeout") {
        uncertainCount++;
        log.warn(
          `[RESUME STATUS] Job '${job.id}' đang ở trạng thái 'uncertain_timeout' (Remote ID: ${job.provider_job_id || "none"}). Cần đối soát qua lệnh series:reconcile.`
        );
        continue;
      }

      if ((job.status === "submitted" || job.status === "running") && job.provider_job_id) {
        resumedCount++;
        try {
          const dummySpec: ShotExecutionSpec = {
            shotId: job.shot_id,
            backend: job.provider as BackendProvider,
            priority: "standard",
            durationSec: 5,
            prompt: "",
            destinationLocalPath: job.output_local_path,
          };
          await this.pollExistingJobToCompletion(job, dummySpec, job.output_local_path);
          completedCount++;
        } catch (err: any) {
          failedCount++;
          log.error(`Không thể hoàn thành resume cho job '${job.id}': ${err.message}`);
        }
      }
    }

    return {
      resumedCount,
      completedCount,
      uncertainCount,
      failedCount,
    };
  }
}
