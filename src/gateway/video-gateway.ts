import axios from "axios";
import { existsSync } from "node:fs";
import { mkdir, writeFile, copyFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { log } from "../utils/logger.js";
import { downloadVideoSafely, probeVideoFile, type VideoProbeInfo } from "../media/media-validator.js";
import {
  type ProviderCapabilities,
  type ImageInputProtocol,
  PROVIDER_CAPABILITY_REGISTRY,
  CapabilityMismatchError,
  validateSpecAgainstCapabilities,
} from "./provider-capabilities.js";

export {
  downloadVideoSafely,
  probeVideoFile,
  type VideoProbeInfo,
  type ProviderCapabilities,
  type ImageInputProtocol,
  PROVIDER_CAPABILITY_REGISTRY,
  CapabilityMismatchError,
  validateSpecAgainstCapabilities,
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

export type BackendProvider =
  | "local_comfyui"
  | "api_wan"
  | "api_ltx"
  | "api_kling"
  | "api_runway"
  | "api_seedance"
  | "api_veo"
  | "mock";

export interface ShotExecutionSpec {
  shotId: string;
  backend: BackendProvider;
  fallbackProviders?: BackendProvider[];
  priority: "hero" | "standard";
  durationSec: number;
  prompt: string;
  aspectRatio?: "9:16" | "16:9";
  loras?: Array<{ path: string; weight: number }>;
  referenceImage?: string;
  firstFrameCondition?: string; // used for autoregressive I2V extension
  seed?: number;
  metadata?: Record<string, unknown>;
  destinationLocalPath?: string;
}

export interface VideoJobStatus {
  jobId: string;
  status: "queued" | "running" | "completed" | "failed";
  videoUrl?: string;
  localPath?: string;
  durationSec?: number;
  progress?: number;
  error?: string;
}

export interface VideoProviderAdapter {
  providerName: BackendProvider;
  capabilities?: ProviderCapabilities;
  submitJob(spec: ShotExecutionSpec): Promise<{ jobId: string }>;
  pollStatus(jobId: string): Promise<VideoJobStatus>;
  cancelJob?(jobId: string): Promise<void>;
}

// ── Provider Pricing Table ($ per second of generated video) ─────────────────
export const PROVIDER_RATES_PER_SEC: Record<BackendProvider, number> = {
  local_comfyui: 0.0,    // Self-hosted, $0 compute cost
  mock: 0.0,             // Mock simulator, $0 cost
  api_wan: 0.08,         // Hosted Wan 2.2 API
  api_ltx: 0.12,         // Hosted LTX-2.5 (audio+video unified)
  api_kling: 0.12,       // Kling 1.5/2.0/3.0
  api_runway: 0.15,      // Runway Gen-3 Alpha Turbo
  api_seedance: 0.09,    // Seaweed / Seedance 2.0
  api_veo: 0.20,         // Google DeepMind Veo 3.1
};

export class CircuitBreakerOpenError extends Error {
  constructor(provider: string) {
    super(`Circuit breaker is OPEN for provider '${provider}' due to repeated failures. Requests halted.`);
    this.name = "CircuitBreakerOpenError";
  }
}

export class BudgetExceededError extends Error {
  constructor(currentSpend: number, maxBudget: number, requested: number) {
    super(
      `Budget cap exceeded! Current spend: $${currentSpend.toFixed(2)}, Max budget: $${maxBudget.toFixed(2)}, Attempted: $${requested.toFixed(2)}.`
    );
    this.name = "BudgetExceededError";
  }
}

/**
 * Circuit Breaker tracks provider failure streaks to avoid costly repeated crashes.
 */
export class CircuitBreaker {
  private failureCount = 0;
  private state: "CLOSED" | "OPEN" = "CLOSED";
  private maxConsecutiveFailures: number;

  constructor(maxConsecutiveFailures = 3) {
    this.maxConsecutiveFailures = maxConsecutiveFailures;
  }

  public canExecute(): boolean {
    return this.state === "CLOSED";
  }

  public recordSuccess(): void {
    this.failureCount = 0;
    this.state = "CLOSED";
  }

  public recordFailure(): void {
    this.failureCount++;
    if (this.failureCount >= this.maxConsecutiveFailures) {
      this.state = "OPEN";
    }
  }

  public reset(): void {
    this.failureCount = 0;
    this.state = "CLOSED";
  }

  public getState(): "CLOSED" | "OPEN" {
    return this.state;
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
}

export class VideoModelGateway {
  private adapters: Map<BackendProvider, VideoProviderAdapter> = new Map();
  private circuitBreakers: Map<BackendProvider, CircuitBreaker> = new Map();
  private currentSpendUsd = 0;
  private maxBudgetUsd: number;
  private pollIntervalMs: number;
  private pollTimeoutMs: number;
  private fallbackChain: BackendProvider[];
  private enableFailover: boolean;

  constructor(config: GatewayConfig = {}) {
    this.maxBudgetUsd = config.maxBudgetUsd ?? 25.0; // Default $25 cap per episode run
    this.pollIntervalMs = config.pollIntervalMs ?? 1500;
    this.pollTimeoutMs = config.pollTimeoutMs ?? 120000; // 2 min max per shot
    this.fallbackChain = config.fallbackChain || [];
    this.enableFailover = config.enableFailover ?? true;
  }

  public registerAdapter(adapter: VideoProviderAdapter): void {
    this.adapters.set(adapter.providerName, adapter);
    if (!this.circuitBreakers.has(adapter.providerName)) {
      this.circuitBreakers.set(adapter.providerName, new CircuitBreaker(3));
    }
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
   * - standard priority -> local_comfyui (or mock if local not registered)
   * - hero priority -> registered cloud API backend (api_runway or api_kling)
   */
  public selectBackend(spec: ShotExecutionSpec): BackendProvider {
    if (spec.backend) return spec.backend;
    if (spec.priority === "hero") {
      if (this.adapters.has("api_veo")) return "api_veo";
      if (this.adapters.has("api_kling")) return "api_kling";
      if (this.adapters.has("api_runway")) return "api_runway";
      if (this.adapters.has("api_seedance")) return "api_seedance";
    }
    return this.adapters.has("local_comfyui") ? "local_comfyui" : "mock";
  }

  /**
   * Executes a shot with automatic failover support across fallback providers.
   */
  public async executeShot(spec: ShotExecutionSpec, destinationPath?: string): Promise<VideoJobStatus> {
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

    // 3. Pre-flight Capability Validation (Rule 2, 3, 9)
    if (adapter.capabilities) {
      validateSpecAgainstCapabilities(spec, adapter.capabilities);
    }

    // 4. Submit Job
    let jobId: string;
    try {
      const res = await adapter.submitJob({ ...spec, backend });
      jobId = res.jobId;
    } catch (err: any) {
      cb.recordFailure();
      throw err;
    }

    // 4. Poll with timeout & exponential backoff
    const startTime = Date.now();
    let delay = this.pollIntervalMs;

    while (Date.now() - startTime < this.pollTimeoutMs) {
      let status: VideoJobStatus;
      try {
        status = await adapter.pollStatus(jobId);
      } catch (err: any) {
        cb.recordFailure();
        throw err;
      }

      if (status.status === "completed") {
        // Auto-download CDN video to localPath if destination is requested or needed
        const targetPath = destinationPath || spec.destinationLocalPath;
        if (targetPath && status.videoUrl && (!status.localPath || !existsSync(status.localPath))) {
          try {
            await downloadVideoFromUrl(status.videoUrl, targetPath, backend !== "mock");
            status.localPath = targetPath;
          } catch (dlErr: any) {
            if (backend !== "mock") {
              cb.recordFailure();
              throw new Error(`Tải video từ CDN thất bại cho provider '${backend}': ${dlErr.message}`);
            }
            log.warn(`Không thể tải video từ URL ${status.videoUrl}: ${dlErr.message}`);
          }
        }

        // Only record success and spend after asset is verified and safely acquired
        cb.recordSuccess();
        this.currentSpendUsd += estimatedCost;

        return status;
      }
      if (status.status === "failed") {
        cb.recordFailure();
        throw new Error(`Job ${jobId} failed on provider ${backend}: ${status.error || "unknown error"}`);
      }

      await new Promise((resolve) => setTimeout(resolve, delay));
      delay = Math.min(delay * 1.25, 8000); // capped exponential backoff
    }

    cb.recordFailure();
    throw new Error(`Shot ${spec.shotId} timed out on provider ${backend} after ${this.pollTimeoutMs}ms`);
  }
}

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
