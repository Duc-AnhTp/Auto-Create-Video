import { isOwnershipError } from '../../../../platform/workflow-error.js';
import { WorkflowError } from "../../../../platform/workflow-error.js";
import { randomUUID, createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir,rm } from "node:fs/promises";
import { dirname } from "node:path";
import type { ProviderJobRecord } from "../../../../contracts/story.js";
import type { JobOrchestratorStore } from "../../ports/job-orchestrator-store.js";
import { PROVIDER_CAPABILITY_REGISTRY } from "../../domain/provider-capabilities.js";
import type {DispatchCoordination} from '../../ports/runtime-services.js';
import { BudgetExceededError, CircuitBreakerOpenError, VideoModelGateway, downloadVideoFromUrl } from "./video-gateway.js";
import { type BackendProvider, type ShotExecutionSpec, type VideoProviderAdapter } from "../../../../contracts/video.js";
import { hashFile } from "../../../media/index.js";
import { assertMediaOwnership,publishMediaRename } from "../../../../platform/processes/media-process-runner.js";
import { probeVideoFile } from "../../../media/index.js";
import { log } from "../../../../platform/observability/logger.js";
import { BudgetLedger } from "./budget-ledger.js";
import {
ProviderConcurrencyLimiter,
ResilientCircuitBreaker,
calculateBackoffWithJitter,
classifyProviderError,
} from "./concurrency-and-retry.js";
import { executeDurableHedge,type CandidateQa } from "./durable-hedge.js";
import { DispatchUncertainError,ProviderDispatcher } from "./provider-dispatcher.js";
import { RateCardManager } from "./rate-card-manager.js";
import { computeVideoSpecHash } from "../../domain/spec-hasher.js";

/**
 * Uncertain Timeout Error (Requirement 3)
 */
export class UncertainTimeoutError extends Error {
  readonly code="UNCERTAIN_TIMEOUT";

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

/**
 * Worker Lock Conflict Error (Requirement 15)
 */
export class WorkerLockConflictError extends Error {
  readonly code="WORKER_LOCK_CONFLICT";

  public readonly reason?: string;

  constructor(reason?: string) {
    super(
      `[WORKER LOCK CONFLICT] Job đang bị khóa bởi worker khác: ${reason || "Worker lease active"}`
    );
    this.name = "WorkerLockConflictError";
    this.reason = reason;
  }
}

export interface OrchestratorOptions {
  fingerprintVideo?: (input: import("../../domain/spec-hasher.js").VideoSpecInput, signal?: AbortSignal) => Promise<string>;
  workerId?: string;
  dispatchStore?:DispatchCoordination;
  signal?:AbortSignal;
  parentJobId?:string;
  checkpoint?:()=>Promise<void>;
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
  isInvoiced?: boolean;
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
export class DurableShotOrchestrator {
  private bible: JobOrchestratorStore;
  readonly dispatcher:ProviderDispatcher;
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
  private signal?:AbortSignal;
  private checkpoint?:()=>Promise<void>;
  private parentJobId?:string;
  private fingerprintVideo: NonNullable<OrchestratorOptions["fingerprintVideo"]>;

  constructor(
    bible: JobOrchestratorStore,
    gateway: VideoModelGateway,
    options: OrchestratorOptions & {dispatchStore:DispatchCoordination}
  ) {
    this.bible = bible;
    this.gateway = gateway;
    this.ledger = new BudgetLedger(bible);
    this.rateManager = new RateCardManager(bible);
    this.rateManager.seedDefaultRatesIfEmpty();
    this.concurrencyLimiter = new ProviderConcurrencyLimiter();

    this.fingerprintVideo = options.fingerprintVideo ?? (async input => computeVideoSpecHash(input));
    this.workerId = options.workerId || `worker_${process.pid}_${Math.random().toString(36).slice(2, 7)}`;
    this.maxAttempts = options.maxAttempts || 3;
    this.pollIntervalMs = options.pollIntervalMs || 1500;
    this.pollTimeoutMs = options.pollTimeoutMs || 120000; // 2 min
    this.submitTimeoutMs = options.submitTimeoutMs ?? 30000;
    this.signal=options.signal;this.checkpoint=options.checkpoint;this.parentJobId=options.parentJobId;
    const store=options.dispatchStore;
    this.dispatcher=new ProviderDispatcher(bible,this.gateway,store,{workerId:this.workerId,pollIntervalMs:this.pollIntervalMs,pollTimeoutMs:this.pollTimeoutMs,submitTimeoutMs:this.submitTimeoutMs,signal:options.signal,checkpoint:options.checkpoint,parentJobId:options.parentJobId});
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
   * Pre-normalizes execution parameters (duration, model) through provider adapter and capability registry
   * before computing cache hash, calculating rates, and reserving budget.
   */
  public resolveEffectiveExecutionParams(
    provider: BackendProvider,
    spec: ShotExecutionSpec,
    overrideModelName?: string
  ): {
    modelName: string;
    effectiveDurationSec: number;
  } {
    // 1. Resolve Model Name
    let modelName =
      overrideModelName ||
      (spec.metadata?.modelName as string) ||
      (spec.metadata?.model as string);

    if (!modelName || modelName === "default") {
      const adapter = this.gateway.getAdapter(provider);
      const adapterDefaultModel = (adapter as any)?.defaultModel || (adapter as any)?.model;
      if (adapterDefaultModel) {
        modelName = adapterDefaultModel;
      } else {
        switch (provider) {
          case "api_kling":
            modelName = process.env.KLING_MODEL || "kling-v3";
            break;
          case "api_runway":
            modelName = "gen3a_turbo";
            break;
          case "api_veo":
            modelName = "veo-3.1";
            break;
          case "api_seedance":
            modelName = "seedance-2.0";
            break;
          case "api_wan":
            modelName = "wan-2.2";
            break;
          case "local_comfyui":
          case "serverless_comfyui":
            modelName = (spec.metadata?.model as string) || "wan2.2_local";
            break;
          case "mock":
            modelName = "simulator";
            break;
          default:
            modelName = "default";
        }
      }
    }

    // 2. Resolve Effective Duration (Normalizing for discrete provider limits)
    let effectiveDurationSec = spec.durationSec;
    const caps = PROVIDER_CAPABILITY_REGISTRY[provider];
    if (caps && Array.isArray(caps.allowedDurationsSec) && caps.allowedDurationsSec.length > 0) {
      if (provider === "api_kling" || provider === "api_runway" || provider === "api_veo" || provider === "api_seedance") {
        effectiveDurationSec = spec.durationSec >= 8 ? 10 : 5;
      } else {
        const sorted = [...caps.allowedDurationsSec].sort((a, b) => a - b);
        const match = sorted.find((d) => d >= spec.durationSec) ?? sorted[sorted.length - 1];
        effectiveDurationSec = match;
      }
    }

    return { modelName, effectiveDurationSec };
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
      /** Separates an intentional new take from retries of the same operation. */
      cacheScope?: string;
      maxReRolls?:number;
      budgetCapUsd?: number;
      adapter?: VideoProviderAdapter;
      specHashOverride?: string;
      validateCandidate?:CandidateQa;
    } = {}
  ): Promise<ShotOrchestrationResult> {
    if(spec.fallbackProviders?.length&&!spec.enableHedge){
      const providers=[...new Set([spec.backend??"mock",...spec.fallbackProviders])];
      if(providers[0]!=="mock"&&providers.includes("mock"))throw new WorkflowError("PRODUCTION_FAILOVER_MOCK_FORBIDDEN", "PRODUCTION_FAILOVER_MOCK_FORBIDDEN", "failed");
      for(const candidate of providers)if(!this.gateway.getAdapter(candidate))throw new WorkflowError("FAILOVER_PROVIDER_UNAVAILABLE", "FAILOVER_PROVIDER_UNAVAILABLE", "needs_review");
      let lastError:unknown;
      for(const candidate of providers){try{return await this.executeShot(seriesId,episodeNumber,{...spec,backend:candidate,fallbackProviders:undefined},options);}catch(error){lastError=error;if(error instanceof UncertainTimeoutError||error instanceof DispatchUncertainError||error instanceof BudgetExceededError||this.ledger.getLedgerSummary(seriesId).uncertainAttemptCount>0||isOwnershipError(error))throw error;}}
      throw lastError;
    }
    if (options.adapter) {
      this.gateway.registerAdapter(options.adapter);
    }
    const provider = spec.backend || "mock";
    const { modelName, effectiveDurationSec } = this.resolveEffectiveExecutionParams(
      provider,
      spec,
      options.modelName
    );
    const destinationPath = options.destinationPath || spec.destinationLocalPath;

    // STEP 1: Compute full deterministic spec hash (Requirement 5)
    const baseSpecHash =
      options.specHashOverride ||
      await this.fingerprintVideo({
        prompt: spec.prompt,
        negativePrompt: spec.negativePrompt || (spec.metadata?.negativePrompt as string),
        provider,
        modelName,
        durationSec: effectiveDurationSec,
        aspectRatio: spec.aspectRatio,
        seed: spec.seed,
        referenceImagePath: spec.referenceImage,
        firstFrameConditionPath: spec.firstFrameCondition,
        characterReferenceImagePath: spec.characterReferenceImage,
        characterTurnaround: spec.characterTurnaround,
        secondaryCharacterReferenceImagePath: spec.secondaryCharacterReferenceImage,
        secondaryCharacterTurnaround: spec.secondaryCharacterTurnaround,
        regionalConditioning: spec.regionalConditioning,
        faceEmbedding: spec.faceEmbedding,
        ipAdapterWeight: spec.ipAdapterWeight,
        applyFaceConsistency: spec.applyFaceConsistency,
        loras: spec.loras,
        extraParameters: spec.metadata,
      });
    const specHash = options.cacheScope
      ? createHash("sha256").update(JSON.stringify([baseSpecHash, options.cacheScope])).digest("hex")
      : baseSpecHash;

    if(spec.enableHedge)return executeDurableHedge({bible:this.bible,gateway:this.gateway,store:this.dispatcher.store,options:{workerId:this.workerId,pollIntervalMs:this.pollIntervalMs,pollTimeoutMs:this.pollTimeoutMs,submitTimeoutMs:this.submitTimeoutMs,signal:this.signal,checkpoint:this.checkpoint,parentJobId:this.parentJobId},estimate:(backend,input)=>{const effective=this.resolveEffectiveExecutionParams(backend,input);return {cost:backend==="mock"?0:Number((effective.effectiveDurationSec*this.rateManager.resolveRate(backend,effective.modelName).ratePerSecUsd).toFixed(4)),model:effective.modelName,duration:effective.effectiveDurationSec};}},seriesId,episodeNumber,spec,specHash,{...options,destinationPath});

    // STEP 2: Cache Hit Check (Requirement 5)
    if (!options.forceReRender) {
      const cachedJob = this.bible.findCompletedJobBySpecHash(specHash);
      const cachedMetadata=cachedJob?JSON.parse(cachedJob.metadata_json||"{}"):{};
      if(cachedJob?.output_url&&cachedJob.output_local_path&&(!existsSync(cachedJob.output_local_path)||!(await probeVideoFile(cachedJob.output_local_path)).isValid||cachedMetadata.asset_sha256&&await hashFile(cachedJob.output_local_path)!==cachedMetadata.asset_sha256)){
        const temporary=cachedJob.output_local_path+"."+randomUUID()+".restore.mp4";
        try{await mkdir(dirname(temporary),{recursive:true});await downloadVideoFromUrl(cachedJob.output_url,temporary,provider!=="mock");
          if((await probeVideoFile(temporary)).isValid&&(!cachedMetadata.asset_sha256||await hashFile(temporary)===cachedMetadata.asset_sha256)){this.signal?.throwIfAborted();assertMediaOwnership();publishMediaRename(temporary,cachedJob.output_local_path);}
        }catch{log.warn("[CACHE RESTORE] Existing provider output could not be restored");}finally{await rm(temporary,{force:true});}
      }
      if (cachedJob && cachedJob.output_local_path && existsSync(cachedJob.output_local_path) && (await probeVideoFile(cachedJob.output_local_path)).isValid && (!cachedMetadata.asset_sha256 || await hashFile(cachedJob.output_local_path)===cachedMetadata.asset_sha256)) {
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

    const shotJobs = this.bible.getProviderJobsForShot(seriesId, episodeNumber, spec.shotId);

    const uncertainJob = shotJobs.find((j) => j.status === "uncertain_timeout");
    const submittingJob=shotJobs.find(j=>j.status==="submitting"&&!j.provider_job_id);
    if(submittingJob)throw new UncertainTimeoutError(submittingJob.id,submittingJob.provider,submittingJob.spec_hash,"Previous submission outcome must be reconciled");
    if (uncertainJob) {
      throw new UncertainTimeoutError(
        uncertainJob.id,
        uncertainJob.provider,
        uncertainJob.spec_hash,
        "Job đang ở trạng thái 'uncertain_timeout'. Cần chạy lệnh đối soát (reconcile) trước khi submit lại."
      );
    }

    const matchingInFlight = shotJobs.find(
      (j) =>
        (j.status === "submitted" || j.status === "running") &&
        Boolean(j.provider_job_id) &&
        j.provider === provider &&
        j.spec_hash === specHash
    );

    if (matchingInFlight) {
      log.info(
        `[RESUME POLLING] Phát hiện job [${matchingInFlight.id}] đã submit lên provider '${matchingInFlight.provider}' (Remote ID: ${matchingInFlight.provider_job_id}) khớp spec hash. Tiếp tục polling, không gửi lại job mới.`
      );
      return await this.pollExistingJobToCompletion(matchingInFlight, spec, destinationPath);
    }

    const baseJob = shotJobs.find((j) => j.id === baseJobId) || this.bible.getProviderJob(baseJobId);
    if (baseJob) {
      if (
        (baseJob.status === "submitted" || baseJob.status === "running") &&
        (baseJob.provider !== provider || baseJob.spec_hash !== specHash)
      ) {
        log.warn(
          `[IN-FLIGHT SPEC MISMATCH] Job cũ [${baseJob.id}] đang chạy trên provider '${baseJob.provider}' với specHash ${baseJob.spec_hash.slice(0, 8)}, nhưng yêu cầu mới dùng provider '${provider}' với specHash ${specHash.slice(0, 8)}. Giữ nguyên job cũ để đối soát và tạo phiên bản mới.`
        );
        localJobId = `${baseJobId}_v${Date.now()}`;
      } else if (baseJob.status === "completed" || baseJob.status === "failed") {
        localJobId = `${baseJobId}_v${Date.now()}`;
      }
    }

    // STEP 4: Resolve Pricing via Configurable Rate Cards (Requirement 10)
    const rateInfo = this.rateManager.resolveRate(provider, modelName);
    const estimatedCostUsd = provider==="mock"?0:Number((effectiveDurationSec * rateInfo.ratePerSecUsd).toFixed(4));

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
        metadata_json:JSON.stringify({attempt_group_id:localJobId+"_group",attempt_role:"primary",execution_spec:spec,parent_job_id:this.parentJobId,rate_card:{ratePerSecUsd:rateInfo.ratePerSecUsd,effectiveDate:rateInfo.effectiveDate,source:rateInfo.sourceDocUrl,verification:"unverified"}}),
      },
      {
        budgetCapUsd: options.budgetCapUsd,
      }
    );

    if (!reservation.allowed) {
      if (reservation.reason?.includes("locked by worker")) {
        throw new WorkerLockConflictError(reservation.reason);
      }
      throw new BudgetExceededError(
        reservation.totalCommittedUsd,
        options.budgetCapUsd !== undefined ? options.budgetCapUsd : this.bible.getSeriesBudget(seriesId).max_budget_usd,
        estimatedCostUsd
      );
    }

    // STEP 6: Execute with Retries, Circuit Breaker & Concurrency (Requirements 4, 7, 11)
    const effectiveSpec: ShotExecutionSpec = {
      ...spec,
      durationSec: effectiveDurationSec,
      metadata: { ...spec.metadata, modelName },
    };

    let currentAttempt = 1;
    while (currentAttempt <= this.maxAttempts) {
      try {
        return await this.executeSingleAttempt(
          localJobId,
          seriesId,
          episodeNumber,
          effectiveSpec,
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

        const latest=this.bible.getProviderJob(localJobId);
        if (err instanceof UncertainTimeoutError || err instanceof BudgetExceededError || isOwnershipError(err) || latest?.provider_job_id) {
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

        // A definitive rejection may retry with a fresh, atomically reserved attempt.
        const jobRecord=this.bible.getProviderJob(localJobId);
        if(!jobRecord||jobRecord.status!=="failed")throw err;
        localJobId=baseJobId+"_retry"+currentAttempt+"_"+Date.now();
        const metadata=JSON.parse(jobRecord.metadata_json??"{}");
        const retryReservation=this.ledger.atomicReserveForJob({...jobRecord,id:localJobId,status:"reserved",provider_job_id:undefined,idempotency_key:undefined,attempt_count:currentAttempt,reserved_cost_usd:estimatedCostUsd,confirmed_cost_usd:0,uncertain_cost_usd:0,metadata_json:JSON.stringify({...metadata,attempt_group_id:localJobId+"_group",retry_of:jobRecord.id})},{budgetCapUsd:options.budgetCapUsd});
        if(!retryReservation.allowed)throw new BudgetExceededError(retryReservation.totalCommittedUsd,options.budgetCapUsd??this.bible.getSeriesBudget(seriesId).max_budget_usd,estimatedCostUsd);
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
    const cb=this.getCircuitBreaker(provider);if(!cb.canExecute())throw new CircuitBreakerOpenError(provider);
    try {const result=await this.dispatcher.execute(this.bible.getProviderJob(localJobId)!,spec,destinationPath);cb.recordSuccess();return result;}
    catch(error){cb.recordFailure(error);if(error instanceof DispatchUncertainError)throw new UncertainTimeoutError(error.jobId,error.provider,error.specHash,error.message);throw error;}
  }

  public async pollExistingJobToCompletion(jobRecord:ProviderJobRecord,spec:ShotExecutionSpec,destinationPath?:string):Promise<ShotOrchestrationResult> {
    try {return await this.dispatcher.execute(jobRecord,spec,destinationPath);}
    catch(error){if(error instanceof DispatchUncertainError)throw new UncertainTimeoutError(error.jobId,error.provider,error.specHash,error.message);throw error;}
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
          let spec: ShotExecutionSpec;
          try {
            const meta = JSON.parse(job.metadata_json || "{}");
            if (meta.execution_spec) {
              spec = {
                ...meta.execution_spec,
                destinationLocalPath: job.output_local_path || meta.execution_spec.destinationLocalPath,
              };
            } else {
              throw new Error("No persisted execution_spec");
            }
          } catch {
            spec = {
              shotId: job.shot_id,
              backend: job.provider as BackendProvider,
              priority: "standard",
              durationSec: 5,
              prompt: "",
              destinationLocalPath: job.output_local_path,
            };
          }
          await this.pollExistingJobToCompletion(job, spec, job.output_local_path);
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

  /**
   * Recovers and completes a shot when previous worker crashed or when resuming with an explicit adapter/specHash.
   */
  public async executeShotWithRecovery(options: {
    seriesId: string;
    episodeNumber: number;
    shotId: string;
    spec: ShotExecutionSpec;
    specHash?: string;
    adapter?: VideoProviderAdapter;
    destinationPath?: string;
    modelName?: string;
    budgetCapUsd?: number;
    forceReRender?: boolean;
  }): Promise<ShotOrchestrationResult> {
    return await this.executeShot(
      options.seriesId,
      options.episodeNumber,
      options.spec,
      {
        destinationPath: options.destinationPath,
        modelName: options.modelName,
        forceReRender: options.forceReRender,
        budgetCapUsd: options.budgetCapUsd,
        adapter: options.adapter,
        specHashOverride: options.specHash,
      }
    );
  }
}
