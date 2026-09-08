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
  | "mock";

export interface ShotExecutionSpec {
  shotId: string;
  backend: BackendProvider;
  priority: "hero" | "standard";
  durationSec: number;
  prompt: string;
  aspectRatio?: "9:16" | "16:9";
  loras?: Array<{ path: string; weight: number }>;
  referenceImage?: string;
  firstFrameCondition?: string; // used for autoregressive I2V extension
  seed?: number;
  metadata?: Record<string, unknown>;
}

export interface VideoJobStatus {
  jobId: string;
  status: "queued" | "running" | "completed" | "failed";
  videoUrl?: string;
  localPath?: string;
  durationSec?: number;
  error?: string;
}

export interface VideoProviderAdapter {
  providerName: BackendProvider;
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
  api_kling: 0.10,       // Kling 1.5/2.0
  api_runway: 0.15,      // Runway Gen-3 Alpha Turbo
  api_seedance: 0.09,    // Seaweed / Seedance
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
}

export class VideoModelGateway {
  private adapters: Map<BackendProvider, VideoProviderAdapter> = new Map();
  private circuitBreakers: Map<BackendProvider, CircuitBreaker> = new Map();
  private currentSpendUsd = 0;
  private maxBudgetUsd: number;
  private pollIntervalMs: number;
  private pollTimeoutMs: number;

  constructor(config: GatewayConfig = {}) {
    this.maxBudgetUsd = config.maxBudgetUsd ?? 25.0; // Default $25 cap per episode run
    this.pollIntervalMs = config.pollIntervalMs ?? 1500;
    this.pollTimeoutMs = config.pollTimeoutMs ?? 120000; // 2 min max per shot
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

  /**
   * Routes a shot spec using the hybrid strategy:
   * - standard priority -> local_comfyui
   * - hero priority -> specified cloud API backend
   */
  public selectBackend(spec: ShotExecutionSpec): BackendProvider {
    if (spec.backend) return spec.backend;
    return spec.priority === "hero" ? "api_wan" : "local_comfyui";
  }

  /**
   * Executes a shot end-to-end:
   * 1. Check budget cap
   * 2. Check circuit breaker
   * 3. Submit job
   * 4. Poll until completed or failed
   * 5. Log cost and return result
   */
  public async executeShot(spec: ShotExecutionSpec): Promise<VideoJobStatus> {
    const backend = this.selectBackend(spec);
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

    // 3. Submit Job
    let jobId: string;
    try {
      const res = await adapter.submitJob(spec);
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
