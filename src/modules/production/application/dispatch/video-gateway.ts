import { WorkflowError } from "../../../../platform/workflow-error.js";
import type { BackendProvider, CharacterTurnaroundAngle, CharacterTurnaroundSpec, ShotExecutionSpec, VideoJobStatus, VideoProviderAdapter } from "../../../../contracts/video.js";
import { resolveCharacterConditioningImage, mapShotToTurnaroundViewAngle } from "../../domain/conditioning.js";
export type { BackendProvider, CharacterTurnaroundAngle, CharacterTurnaroundSpec, ShotExecutionSpec, VideoJobStatus, VideoProviderAdapter } from "../../../../contracts/video.js";
export { resolveCharacterConditioningImage, mapShotToTurnaroundViewAngle } from "../../domain/conditioning.js";
import axios from "axios";
import { existsSync } from "node:fs";
import { mkdir, copyFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { log } from "../../../../platform/observability/logger.js";
import { downloadVideoSafely, probeVideoFile, type VideoProbeInfo } from "../../../media/index.js";
import { createValidMockMp4File } from "../../../media/index.js";
import { type ProviderCapabilities, type ImageInputProtocol } from "../../../../contracts/video.js";
import { PROVIDER_CAPABILITY_REGISTRY, CapabilityMismatchError, validateSpecAgainstCapabilities } from "../../domain/provider-capabilities.js";
import {
  ResilientCircuitBreaker,
  type CircuitBreakerState,
  type CircuitBreakerConfig,
} from "./circuit-breaker.js";
import {
  ProviderRateLimiter,
  DEFAULT_PROVIDER_RATE_LIMITS,
  type ProviderRateConfig,
} from "./provider-rate-limiter.js";
import { ProviderWebhookRegistry, defaultWebhookRegistry } from "../../adapters/webhook-registry.js";
import { withHttpRetry, type HttpRetryOptions } from "../../adapters/http-retry.js";

import { PromptOptimizer } from "../../../story/index.js";

export {
  downloadVideoSafely,
  probeVideoFile,
  type VideoProbeInfo,
  type ProviderCapabilities,
  type ImageInputProtocol,
  PROVIDER_CAPABILITY_REGISTRY,
  CapabilityMismatchError,
  validateSpecAgainstCapabilities,
  ResilientCircuitBreaker,
  ResilientCircuitBreaker as CircuitBreaker,
  type CircuitBreakerState,
  type CircuitBreakerConfig,
  ProviderRateLimiter,
  DEFAULT_PROVIDER_RATE_LIMITS,
  type ProviderRateConfig,
  ProviderWebhookRegistry,
  defaultWebhookRegistry,
  withHttpRetry,
  type HttpRetryOptions,

};

/**
 * Model API Gateway (Phân Hệ VI)
 *
 * Provides a resilient, provider-agnostic abstraction for video generation:
 * - Unified VideoProviderAdapter interface (local ComfyUI + cloud hosted APIs)
 * - Async polling queue with rate-limiting & timeout
 * - Real-time Cost Tracker & hard Budget Cap protection
 * - Circuit Breaker to prevent infinite retry storms & runaway costs
 * - Hybrid routing (local Wan 2.2 for standard shots, cloud for hero shots)
 */

/**
 * Resolves the optimal reference image for character visual conditioning.
 * Inspects turnaround pack views (front, 3/4, profile, fullBody) according to shot angle/type,
 * falling back to characterReferenceImage, referenceImage, or firstFrameCondition.
 */

/**
 * Deterministically maps shot type, camera angle, and prompt intent to a canonical turnaround view angle.
 */

// ── Provider Pricing Table ($ per second of generated video) ─────────────────
export const PROVIDER_RATES_PER_SEC: Record<BackendProvider, number> = {
  local_comfyui: 0.0,    // Self-hosted, $0 compute cost
  serverless_comfyui: 0.04, // Cloud Serverless ComfyUI (Modal/RunPod GPU)
  mock: 0.0,             // Mock simulator, $0 cost
  api_wan: 0.08,         // Hosted Wan 2.2 API
  api_ltx: 0.12,         // Hosted LTX-2.5 (audio+video unified)
  api_kling: 0.12,       // Kling 1.5/2.0/3.0
  api_runway: 0.15,      // Runway Gen-3 Alpha Turbo
  api_seedance: 0.09,    // Seaweed / Seedance 2.0
  api_veo: 0.20,         // Google DeepMind Veo 3.1
};

export class CircuitBreakerOpenError extends Error {
  readonly code="PROVIDER_CIRCUIT_OPEN";

  constructor(provider: string) {
    super(`Circuit breaker is OPEN for provider '${provider}' due to repeated failures. Requests halted.`);
    this.name = "CircuitBreakerOpenError";
  }
}

export class BudgetExceededError extends Error {
  readonly code="BUDGET_EXCEEDED";

  constructor(currentSpend: number, maxBudget: number, requested: number) {
    super(
      `Budget cap exceeded! Current spend: $${currentSpend.toFixed(2)}, Max budget: $${maxBudget.toFixed(2)}, Attempted: $${requested.toFixed(2)}.`
    );
    this.name = "BudgetExceededError";
  }
}

export interface GatewayConfig {
  maxBudgetUsd?: number;
  defaultLocalBackend?: BackendProvider;
  defaultHeroBackend?: BackendProvider;
  pollIntervalMs?: number;
  pollTimeoutMs?: number;
  fallbackChain?: BackendProvider[];
  enableFailover?: boolean;
  rateLimiter?: ProviderRateLimiter;
  webhookRegistry?: ProviderWebhookRegistry;
  circuitBreakerCooldownMs?: number;
  circuitBreakerMaxFailures?: number;
}

export interface GatewayTelemetry {
  totalShots: number;
  shotsByProvider: Record<string, number>;
  failoversTriggered: number;
  totalSpendUsd: number;
  maxBudgetUsd: number;
  budgetUtilizationPct: number;
  circuitBreakers: Record<string, CircuitBreakerState>;
}

export class VideoModelGateway {
  private adapters: Map<BackendProvider, VideoProviderAdapter> = new Map();
  private circuitBreakers: Map<BackendProvider, ResilientCircuitBreaker> = new Map();
  private rateLimiter: ProviderRateLimiter;
  private webhookRegistry?: ProviderWebhookRegistry;
  private circuitBreakerCooldownMs: number;
  private circuitBreakerMaxFailures: number;
  private currentSpendUsd = 0;
  private maxBudgetUsd: number;
  private defaultLocalBackend?: BackendProvider;
  private defaultHeroBackend?: BackendProvider;
  private pollIntervalMs: number;
  private pollTimeoutMs: number;
  private fallbackChain: BackendProvider[];
  private enableFailover: boolean;
  private totalShots = 0;
  private shotsByProvider: Map<BackendProvider, number> = new Map();
  private failoversTriggered = 0;

  constructor(config: GatewayConfig = {}) {
    this.maxBudgetUsd = config.maxBudgetUsd ?? 25.0; // Default $25 cap per episode run
    this.defaultLocalBackend = config.defaultLocalBackend;
    this.defaultHeroBackend = config.defaultHeroBackend;
    this.pollIntervalMs = config.pollIntervalMs ?? 1500;
    this.pollTimeoutMs = config.pollTimeoutMs ?? 120000; // 2 min max per shot
    this.fallbackChain = config.fallbackChain || [];
    this.enableFailover = config.enableFailover ?? true;
    this.rateLimiter = config.rateLimiter || new ProviderRateLimiter();
    this.webhookRegistry = config.webhookRegistry;
    this.circuitBreakerCooldownMs = config.circuitBreakerCooldownMs ?? 60000;
    this.circuitBreakerMaxFailures = config.circuitBreakerMaxFailures ?? 3;
  }

  public registerAdapter(adapter: VideoProviderAdapter): void {
    this.adapters.set(adapter.providerName, adapter);
    if (!this.circuitBreakers.has(adapter.providerName)) {
      this.circuitBreakers.set(
        adapter.providerName,
        new ResilientCircuitBreaker({
          maxConsecutiveFailures: this.circuitBreakerMaxFailures,
          cooldownMs: this.circuitBreakerCooldownMs,
        })
      );
    }
  }

  public getRateLimiter(): ProviderRateLimiter {
    return this.rateLimiter;
  }

  public getWebhookRegistry(): ProviderWebhookRegistry | undefined {
    return this.webhookRegistry;
  }

  public setWebhookRegistry(registry: ProviderWebhookRegistry): void {
    this.webhookRegistry = registry;
  }

  public getCircuitBreaker(provider: BackendProvider): ResilientCircuitBreaker | undefined {
    return this.circuitBreakers.get(provider);
  }

  public getTelemetry(): GatewayTelemetry {
    const cbMap: Record<string, CircuitBreakerState> = {};
    for (const [p, cb] of this.circuitBreakers.entries()) {
      cbMap[p] = cb.getState();
    }
    const shotsMap: Record<string, number> = {};
    for (const [p, c] of this.shotsByProvider.entries()) {
      shotsMap[p] = c;
    }
    return {
      totalShots: this.totalShots,
      shotsByProvider: shotsMap,
      failoversTriggered: this.failoversTriggered,
      totalSpendUsd: this.currentSpendUsd,
      maxBudgetUsd: this.maxBudgetUsd,
      budgetUtilizationPct: this.maxBudgetUsd > 0 ? (this.currentSpendUsd / this.maxBudgetUsd) * 100 : 0,
      circuitBreakers: cbMap,
    };
  }

  public getSpend(): number {
    return this.currentSpendUsd;
  }

  public resetSpend(): void {
    this.currentSpendUsd = 0;
  }

  public getAvailableProviders(): BackendProvider[] {
    return Array.from(this.adapters.keys());
  }

  public getAdapter(provider: BackendProvider): VideoProviderAdapter | undefined {
    return this.adapters.get(provider);
  }

  /**
   * Routes a shot spec using the hybrid strategy:
   * - standard priority -> local_comfyui (or serverless_comfyui, or mock if none registered)
   * - hero priority -> registered cloud API backend (api_veo, api_kling, api_runway, etc.)
   */
  public selectBackend(spec: ShotExecutionSpec): BackendProvider {
    if (spec.backend) return spec.backend;
    if (spec.priority === "hero") {
      if (this.defaultHeroBackend && this.adapters.has(this.defaultHeroBackend)) {
        return this.defaultHeroBackend;
      }
      if (this.adapters.has("api_veo")) return "api_veo";
      if (this.adapters.has("api_kling")) return "api_kling";
      if (this.adapters.has("api_runway")) return "api_runway";
      if (this.adapters.has("api_seedance")) return "api_seedance";
      if (this.adapters.has("serverless_comfyui")) return "serverless_comfyui";
    }
    if (this.defaultLocalBackend && this.adapters.has(this.defaultLocalBackend)) {
      return this.defaultLocalBackend;
    }
    if (this.adapters.has("local_comfyui")) return "local_comfyui";
    if (this.adapters.has("serverless_comfyui")) return "serverless_comfyui";
    if (this.adapters.has("mock")) return "mock";
    // If only cloud adapters are registered, route standard priority to economical cloud provider or first available
    if (this.adapters.has("api_seedance")) return "api_seedance";
    const available = this.getAvailableProviders();
    if (available.length > 0) return available[0];
    return "mock";
  }

  /**
   * Smart micro-bidding & routing based on shot importance, dramatic tension, and budget.
   * - Hero shots (close-up, high tension dialogue) are routed to high-fidelity models (kling, veo, runway).
   * - Establishing/wide shots are routed to economical models (seedance, comfyui, wan).
   * - Automatically downgrades to cheaper models if budget would be exceeded.
   */
  public smartRoute(spec: ShotExecutionSpec, budgetCapUsd?: number): BackendProvider {
    const available = this.getAvailableProviders();
    const effectiveCap = budgetCapUsd ?? (this.maxBudgetUsd - this.currentSpendUsd);

    const isHero =
      spec.priority === "hero" ||
      spec.shotType === "close_up" ||
      spec.shotType === "ots_a_b" ||
      spec.shotType === "ots_b_a";
    const duration = spec.durationSec || 4.0;

    if (isHero) {
      const heroCandidates: BackendProvider[] = ["api_kling", "api_runway", "api_veo", "serverless_comfyui"];
      for (const candidate of heroCandidates) {
        if (available.includes(candidate)) {
          const rate = PROVIDER_RATES_PER_SEC[candidate] ?? 0.15;
          if (duration * rate <= effectiveCap) {
            return candidate;
          }
        }
      }
    }

    // Economical candidates for non-hero or budget-constrained shots
    const econCandidates: BackendProvider[] = ["api_seedance", "local_comfyui", "serverless_comfyui", "mock"];
    for (const candidate of econCandidates) {
      if (available.includes(candidate)) {
        const rate = PROVIDER_RATES_PER_SEC[candidate] ?? 0.05;
        if (duration * rate <= effectiveCap || candidate === "mock") {
          return candidate;
        }
      }
    }

    return this.selectBackend(spec);
  }

  /**
   * Executes a shot with automatic failover support across fallback providers.
   * Automatically dispatches to executeShotHedged if spec.enableHedge is active.
   */
  private assertDirectDispatch(provider: BackendProvider): void {
    if (provider !== "mock") {
      throw new WorkflowError("DURABLE_ORCHESTRATOR_REQUIRED", "DURABLE_ORCHESTRATOR_REQUIRED: Paid jobs must be tracked by ResilientJobOrchestrator", "failed");
    }
  }

  public async executeShot(spec: ShotExecutionSpec, destinationPath?: string): Promise<VideoJobStatus> {
    this.assertDirectDispatch(this.selectBackend(spec));
    if (spec.enableHedge) {
      return this.executeShotHedged(spec, destinationPath, spec.hedgeDelayMs);
    }
    const primaryBackend = this.selectBackend(spec);
    const candidateBackends: BackendProvider[] = [primaryBackend];

    if (this.enableFailover) {
      const extraFallbacks = spec.fallbackProviders || this.fallbackChain;
      for (const fb of extraFallbacks) {
        if (!candidateBackends.includes(fb) && this.adapters.has(fb)) {
          candidateBackends.push(fb);
        }
      }
    }

    let lastError: Error | null = null;

    for (let i = 0; i < candidateBackends.length; i++) {
      const backend = candidateBackends[i];
      this.assertDirectDispatch(backend);
      const hasNext = i < candidateBackends.length - 1;

      try {
        return await this.executeOnSingleBackend(backend, spec, destinationPath);
      } catch (err: any) {
        lastError = err;
        // Budget cap exceeded must fail immediately across all providers
        if (err instanceof BudgetExceededError) {
          throw err;
        }

        if (hasNext) {
          this.failoversTriggered++;
          const nextBackend = candidateBackends[i + 1];
          log.warn(
            `[GATEWAY FAILOVER] Provider '${backend}' thất bại cho shot [${spec.shotId}]: ${err.message}. Đang tự động chuyển đổi sang provider dự phòng '${nextBackend}'...`
          );
        }
      }
    }

    throw lastError || new Error(`All candidate video providers failed for shot ${spec.shotId}`);
  }

  /**
   * Hedged Request Pattern:
   * Starts executing primary provider. If the primary provider job is still running/queued after
   * hedgeDelayMs (default 45s), spawns a concurrent hedged job on a fast/economical fallback provider.
   * Whichever finishes first is accepted and returned, mitigating provider queue latency spikes.
   */
  public async executeShotHedged(
    spec: ShotExecutionSpec,
    destinationPath?: string,
    hedgeDelayMs: number = 45000
  ): Promise<VideoJobStatus> {
    const primaryBackend = this.selectBackend(spec);
    this.assertDirectDispatch(primaryBackend);
    const fallbackCandidates = (spec.fallbackProviders || this.fallbackChain).filter(
      (b) => b !== primaryBackend && this.adapters.has(b)
    );

    if (fallbackCandidates.length === 0 || !this.enableFailover) {
      const { enableHedge, ...plainSpec } = spec;
      return this.executeShot(plainSpec, destinationPath);
    }

    const hedgeBackend = spec.hedgeFallbackProvider || fallbackCandidates[0];
    this.assertDirectDispatch(hedgeBackend);
    let primaryCompleted = false;
    let hedgeStarted = false;
    let hedgeTimer: ReturnType<typeof setTimeout> | undefined;

    // Each provider writes to its own path. Only the winning artifact is copied to the requested path.
    const attemptPath = (label: string): string | undefined => {
      if (!destinationPath) return undefined;
      const separatorIndex = Math.max(destinationPath.lastIndexOf("/"), destinationPath.lastIndexOf("\\"));
      const extensionIndex = destinationPath.lastIndexOf(".");
      if (extensionIndex <= separatorIndex) return `${destinationPath}_${label}`;
      return `${destinationPath.slice(0, extensionIndex)}_${label}${destinationPath.slice(extensionIndex)}`;
    };
    const primaryDest = attemptPath(`primary_${primaryBackend}`);
    const hedgedDest = attemptPath(`hedge_${hedgeBackend}`);

    type HedgedAttempt = { result: VideoJobStatus; outputPath?: string };
    let resolveHedge!: (attempt: HedgedAttempt) => void;
    let rejectHedge!: (reason?: unknown) => void;
    const hedgedPromise = new Promise<HedgedAttempt>((resolve, reject) => {
      resolveHedge = resolve;
      rejectHedge = reject;
    });

    const startHedge = (): void => {
      if (hedgeStarted) return;
      hedgeStarted = true;
      if (primaryCompleted) {
        rejectHedge(new Error("Primary provider completed before the hedge started"));
        return;
      }

      log.warn(
        `[GATEWAY HEDGE] Primary provider '${primaryBackend}' chưa hoàn thành sau ${hedgeDelayMs}ms cho shot [${spec.shotId}]. Khởi chạy hedged request song song trên '${hedgeBackend}'...`
      );
      void this.executeOnSingleBackend(
        hedgeBackend,
        { ...spec, backend: hedgeBackend, enableHedge: false },
        hedgedDest
      ).then(
        (result) => resolveHedge({ result, outputPath: hedgedDest }),
        (error: unknown) => {
          const message = error instanceof Error ? error.message : String(error);
          log.warn(`[GATEWAY HEDGE] Hedged provider '${hedgeBackend}' thất bại: ${message}`);
          rejectHedge(error);
        }
      );
    };

    hedgeTimer = setTimeout(startHedge, Math.max(0, hedgeDelayMs));

    const primaryPromise = this.executeOnSingleBackend(primaryBackend, spec, primaryDest).then(
      (result): HedgedAttempt => {
        primaryCompleted = true;
        if (hedgeTimer) clearTimeout(hedgeTimer);
        return { result, outputPath: primaryDest };
      },
      (error: unknown) => {
        // If primary fails before the delay expires, start the fallback immediately.
        if (hedgeTimer) clearTimeout(hedgeTimer);
        startHedge();
        throw error;
      }
    );

    try {
      const winner = await Promise.any([primaryPromise, hedgedPromise]);
      if (hedgeTimer) clearTimeout(hedgeTimer);

      if (
        destinationPath &&
        winner.outputPath &&
        winner.outputPath !== destinationPath &&
        existsSync(winner.outputPath)
      ) {
        try {
          await mkdir(dirname(destinationPath), { recursive: true });
          await copyFile(winner.outputPath, destinationPath);
          winner.result.localPath = destinationPath;
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          log.warn(`[GATEWAY HEDGE] Không thể xuất bản take thắng tới '${destinationPath}': ${message}`);
          winner.result.localPath = winner.outputPath;
        }
      }

      return winner.result;
    } finally {
      if (hedgeTimer) clearTimeout(hedgeTimer);
    }
  }

  /**
   * Executes a shot on a single specified backend provider.
   */
  private async executeOnSingleBackend(
    backend: BackendProvider,
    spec: ShotExecutionSpec,
    destinationPath?: string
  ): Promise<VideoJobStatus> {
    const adapter = this.adapters.get(backend);
    if (!adapter) {
      throw new Error(`No adapter registered for provider '${backend}'`);
    }

    // 1. Budget Cap check
    const costRate = PROVIDER_RATES_PER_SEC[backend] ?? 0.10;
    const estimatedCost = spec.durationSec * costRate;
    if (this.currentSpendUsd + estimatedCost > this.maxBudgetUsd) {
      throw new BudgetExceededError(this.currentSpendUsd, this.maxBudgetUsd, estimatedCost);
    }

    // 2. Circuit Breaker check
    const cb = this.circuitBreakers.get(backend)!;
    if (!cb.canExecute()) {
      throw new CircuitBreakerOpenError(backend);
    }

    let releaseRateLimit: (() => void) | undefined;
    try {
      // 3. Pre-flight Capability Validation (Rule 2, 3, 9)
      if (adapter.capabilities) {
        validateSpecAgainstCapabilities(spec, adapter.capabilities);
      }

      // 4. Rate Limiter Acquisition (concurrency slot & token bucket)
      releaseRateLimit = await this.rateLimiter.acquire(backend);
    } catch (preFlightErr) {
      cb.abortProbe();
      throw preFlightErr;
    }

    try {
      // 5. Submit Job
      let jobId: string;
      try {
        const effectiveSpec = { ...spec, backend };
        if (effectiveSpec.aspectRatio === "9:16" && effectiveSpec.prompt) {
          effectiveSpec.prompt = PromptOptimizer.injectVerticalPromptModifiers(
            effectiveSpec.prompt,
            effectiveSpec.shotType
          );
        }
        const res = await adapter.submitJob(effectiveSpec);
        jobId = res.jobId;
      } catch (err: any) {
        cb.recordFailure();
        throw err;
      }

      // 6. Dual-Mode: Webhook listener + Polling fallback
      let webhookStatus: VideoJobStatus | null = null;
      let webhookPromise: Promise<VideoJobStatus | null> | null = null;
      if (this.webhookRegistry) {
        webhookPromise = this.webhookRegistry
          .waitForWebhook(jobId, backend, this.pollTimeoutMs)
          .then(status => { webhookStatus = status; return status; })
          .catch(() => null);
      }

      const startTime = Date.now();
      let delay = this.pollIntervalMs;

      while (Date.now() - startTime < this.pollTimeoutMs) {
        let status: VideoJobStatus | undefined;

        if (webhookStatus) status = webhookStatus;

        if (!status) {
          try {
            status = await adapter.pollStatus(jobId);
          } catch (err: any) {
            if (this.webhookRegistry) this.webhookRegistry.cancel(jobId, backend);
            cb.recordFailure();
            throw err;
          }
        }

        if (status.status === "completed") {
          if (this.webhookRegistry) this.webhookRegistry.cancel(jobId, backend);

          // Auto-download CDN video to localPath if destination is requested or needed
          const targetPath = destinationPath || spec.destinationLocalPath;
          if (targetPath && status.videoUrl && (!status.localPath || !existsSync(status.localPath))) {
            const isMockUrl = status.videoUrl.startsWith("http://mock.") || status.videoUrl.startsWith("file://");
            try {
              await downloadVideoFromUrl(status.videoUrl, targetPath, backend !== "mock" && !isMockUrl);
              status.localPath = targetPath;
            } catch (dlErr: any) {
              if (backend === "mock" || isMockUrl) {
                await createValidMockMp4File(targetPath, spec.durationSec || 4.0);
                status.localPath = targetPath;
              } else {
                cb.recordFailure();
                throw new Error(`Tải video từ CDN thất bại cho provider '${backend}': ${dlErr.message}`);
              }
            }
          }

          // Use actual invoiced cost if available, else rate-card estimated cost
          const billedCost =
            status.invoicedCostUsd !== undefined ? status.invoicedCostUsd : estimatedCost;
          status.costUsd = billedCost;

          // Only record success and spend after asset is verified and safely acquired
          cb.recordSuccess();
          this.currentSpendUsd += billedCost;
          this.totalShots++;
          this.shotsByProvider.set(backend, (this.shotsByProvider.get(backend) || 0) + 1);

          return status;
        }

        if (status.status === "failed") {
          if (this.webhookRegistry) this.webhookRegistry.cancel(jobId, backend);
          cb.recordFailure();
          throw new Error(`Job ${jobId} failed on provider ${backend}: ${status.error || "unknown error"}`);
        }

        // Wait before next poll attempt, but wake up early if webhook arrives
        if (webhookPromise) {
          const webhookWin = await Promise.race([
            webhookPromise.then((s) => ({ source: "webhook", s })),
            new Promise<{ source: string; s?: VideoJobStatus | null }>((resolve) =>
              setTimeout(() => resolve({ source: "timeout" }), delay)
            ),
          ]);
          if (webhookWin.source === "webhook") {
            if (webhookWin.s) {
              webhookStatus = webhookWin.s;
              continue;
            } else {
              // Webhook resolved to null (timeout/error) - clear promise to prevent zero-delay spin loop
              webhookPromise = null;
              await new Promise((resolve) => setTimeout(resolve, delay));
            }
          }
        } else {
          await new Promise((resolve) => setTimeout(resolve, delay));
        }

        delay = Math.min(delay * 1.25, 8000); // capped exponential backoff
      }

      if (this.webhookRegistry) this.webhookRegistry.cancel(jobId, backend);
      cb.recordFailure();
      throw new Error(`Shot ${spec.shotId} timed out on provider ${backend} after ${this.pollTimeoutMs}ms`);
    } finally {
      if (releaseRateLimit) {
        releaseRateLimit();
      }
    }
  }
}

/**
 * Factory function creating a fully-configured VideoModelGateway with all supported
 * production and test video providers registered:
 * - Mock (offline testing & simulation)
 * - Local ComfyUI (Wan 2.1 / HunyuanVideo self-hosted GPU)
 * - Serverless ComfyUI (Modal / RunPod cloud GPU auto-scaling)
 * - Kling AI (Kling 1.5, 2.0, 3.0)
 * - Runway (Gen-3 Alpha Turbo)
 * - Google Cloud (Veo 3.1)
 * - ByteDance (Seedance 2.0 / Seaweed)
 */

/**
 * Downloads a video asset from an HTTP/HTTPS CDN URL, Data URI, or local file into a local destination path.
 * Delegates to downloadVideoSafely with atomic temp-file write and ffprobe validation.
 */
export async function downloadVideoFromUrl(
  url: string,
  destinationPath: string,
  validateWithProbe = false
): Promise<string> {
  return downloadVideoSafely(url, destinationPath, { validateWithProbe });
}
