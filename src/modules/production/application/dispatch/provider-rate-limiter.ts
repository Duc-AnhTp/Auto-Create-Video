import type { BackendProvider } from "../../../../contracts/video.js";

export interface ProviderRateConfig {
  /** Maximum simultaneous in-flight requests to the provider */
  maxConcurrent: number;
  /** Maximum requests allowed per 60-second sliding window */
  maxRpm: number;
}

export const DEFAULT_PROVIDER_RATE_LIMITS: Record<BackendProvider | string, ProviderRateConfig> = {
  api_kling: { maxConcurrent: 2, maxRpm: 12 },
  api_runway: { maxConcurrent: 2, maxRpm: 10 },
  api_veo: { maxConcurrent: 3, maxRpm: 15 },
  api_seedance: { maxConcurrent: 5, maxRpm: 30 },
  api_wan: { maxConcurrent: 2, maxRpm: 15 },
  api_ltx: { maxConcurrent: 2, maxRpm: 15 },
  local_comfyui: { maxConcurrent: 1, maxRpm: 60 },
  serverless_comfyui: { maxConcurrent: 10, maxRpm: 120 },
  mock: { maxConcurrent: 50, maxRpm: 1000 },
};

interface QueuedRequest {
  resolve: (release: () => void) => void;
  reject: (err: Error) => void;
  timeoutTimer?: NodeJS.Timeout;
}

/**
 * Token-Bucket Rate Limiter & Concurrency Manager for AI Video Providers.
 * Prevents HTTP 429 errors and API account suspensions by enforcing:
 * 1. Strict concurrency caps on simultaneous jobs.
 * 2. Sliding-window Token Bucket rate limits (RPM).
 * 3. FIFO request queueing with configurable wait deadlines.
 */
export class ProviderRateLimiter {
  private activeConcurrency: Map<string, number> = new Map();
  private tokens: Map<string, number> = new Map();
  private lastRefillTime: Map<string, number> = new Map();
  private waitQueues: Map<string, QueuedRequest[]> = new Map();
  private customConfigs: Map<string, ProviderRateConfig> = new Map();

  constructor(customConfigs: Record<string, ProviderRateConfig> = {}) {
    for (const [k, v] of Object.entries(customConfigs)) {
      this.customConfigs.set(k, v);
    }
  }

  public configureProvider(
    provider: string,
    config: ProviderRateConfig & { initialTokens?: number }
  ): void {
    this.customConfigs.set(provider, config);
    if (config.initialTokens !== undefined) {
      this.tokens.set(provider, config.initialTokens);
    }
  }

  private getConfig(provider: string): ProviderRateConfig {
    return (
      this.customConfigs.get(provider) ||
      DEFAULT_PROVIDER_RATE_LIMITS[provider] || { maxConcurrent: 2, maxRpm: 10 }
    );
  }

  private refillTokens(provider: string): void {
    const config = this.getConfig(provider);
    const now = Date.now();
    const lastRefill = this.lastRefillTime.get(provider) || now;
    const elapsedSec = (now - lastRefill) / 1000;

    const currentTokens = this.tokens.get(provider) ?? config.maxRpm;
    const tokensToAdd = elapsedSec * (config.maxRpm / 60);
    const newTokens = Math.min(config.maxRpm, currentTokens + tokensToAdd);

    this.tokens.set(provider, newTokens);
    this.lastRefillTime.set(provider, now);
  }

  /**
   * Acquires a concurrency slot and rate-limit token for the specified provider.
   * If limits are saturated, queues the request until slots or tokens become available.
   * Returns a release function that MUST be invoked when the request completes.
   */
  public async acquire(provider: string, timeoutMs = 60000): Promise<() => void> {
    this.refillTokens(provider);
    const config = this.getConfig(provider);
    const inFlight = this.activeConcurrency.get(provider) || 0;
    const currentTokens = this.tokens.get(provider) || 0;

    // Fast-path: Slot and token available immediately
    if (inFlight < config.maxConcurrent && currentTokens >= 1) {
      this.activeConcurrency.set(provider, inFlight + 1);
      this.tokens.set(provider, currentTokens - 1);
      return this.createReleaseFn(provider);
    }

    // Slow-path: Queue request
    return new Promise<() => void>((resolve, reject) => {
      let queue = this.waitQueues.get(provider);
      if (!queue) {
        queue = [];
        this.waitQueues.set(provider, queue);
      }

      const item: QueuedRequest = {
        resolve,
        reject,
      };

      if (timeoutMs > 0) {
        item.timeoutTimer = setTimeout(() => {
          const q = this.waitQueues.get(provider);
          if (q) {
            const idx = q.indexOf(item);
            if (idx !== -1) {
              q.splice(idx, 1);
            }
          }
          reject(
            new Error(
              `Rate limit acquisition timed out after ${timeoutMs}ms for provider '${provider}'`
            )
          );
        }, timeoutMs);
        item.timeoutTimer.unref();
      }

      queue.push(item);
      this.scheduleQueueDrain(provider);
    });
  }

  private scheduleQueueDrain(provider: string): void {
    const queue = this.waitQueues.get(provider);
    if (!queue || queue.length === 0) return;

    this.refillTokens(provider);
    const config = this.getConfig(provider);

    // Drain as many queued requests as current concurrency and tokens permit
    while (queue.length > 0) {
      this.refillTokens(provider);
      const inFlight = this.activeConcurrency.get(provider) || 0;
      const currentTokens = this.tokens.get(provider) || 0;

      if (inFlight < config.maxConcurrent && currentTokens >= 1) {
        const next = queue.shift();
        if (next) {
          if (next.timeoutTimer) clearTimeout(next.timeoutTimer);
          this.activeConcurrency.set(provider, inFlight + 1);
          this.tokens.set(provider, currentTokens - 1);
          next.resolve(this.createReleaseFn(provider));
        }
      } else {
        break;
      }
    }

    // If items remain in queue after draining available capacity, re-schedule next drain check
    if (queue.length > 0) {
      const delay = Math.max(100, Math.ceil(((60 / config.maxRpm) * 1000) / 2));
      const timer = setTimeout(() => this.scheduleQueueDrain(provider), delay);
      timer.unref();
    }
  }

  private createReleaseFn(provider: string): () => void {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const current = this.activeConcurrency.get(provider) || 1;
      this.activeConcurrency.set(provider, Math.max(0, current - 1));
      this.scheduleQueueDrain(provider);
    };
  }

  public getActiveConcurrency(provider: string): number {
    return this.activeConcurrency.get(provider) || 0;
  }

  public getQueueLength(provider: string): number {
    return this.waitQueues.get(provider)?.length || 0;
  }

  /**
   * Returns current limiter metrics for telemetry and monitoring.
   */
  public getStats(provider: string): {
    inFlight: number;
    maxConcurrent: number;
    availableTokens: number;
    queued: number;
  } {
    this.refillTokens(provider);
    const config = this.getConfig(provider);
    return {
      inFlight: this.activeConcurrency.get(provider) || 0,
      maxConcurrent: config.maxConcurrent,
      availableTokens: Math.floor(this.tokens.get(provider) || 0),
      queued: this.waitQueues.get(provider)?.length || 0,
    };
  }
}
