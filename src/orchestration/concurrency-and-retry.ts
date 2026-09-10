import { log } from "../utils/logger.js";

/**
 * Resilient Circuit Breaker & Concurrency Limiter (Requirements 7 & 11)
 *
 * Implements:
 * 1. 3-State FSM Circuit Breaker (CLOSED -> OPEN -> HALF_OPEN -> CLOSED)
 *    allowing controlled probe checks instead of permanent freeze.
 * 2. Per-provider Concurrency Limiting Queue.
 * 3. Error Classification (retryable 429/5xx/network drop vs non-retryable 400/401/403/422/budget cap).
 * 4. Exponential Backoff with randomized Jitter.
 */

export type CircuitBreakerState = "CLOSED" | "OPEN" | "HALF_OPEN";

export class ResilientCircuitBreaker {
  public readonly provider: string;
  private state: CircuitBreakerState = "CLOSED";
  private consecutiveFailures = 0;
  private maxConsecutiveFailures: number;
  private baseCooldownMs: number;
  private currentCooldownMs: number;
  private maxCooldownMs: number;
  private openedAt: number | null = null;
  private probeInFlight = false;

  constructor(
    provider: string,
    options: {
      maxConsecutiveFailures?: number;
      baseCooldownMs?: number;
      maxCooldownMs?: number;
    } = {}
  ) {
    this.provider = provider;
    this.maxConsecutiveFailures = options.maxConsecutiveFailures ?? 3;
    this.baseCooldownMs = options.baseCooldownMs ?? 5000; // 5s default
    this.currentCooldownMs = this.baseCooldownMs;
    this.maxCooldownMs = options.maxCooldownMs ?? 60000; // 60s max cooldown
  }

  public getState(): CircuitBreakerState {
    this.checkCooldownTransition();
    return this.state;
  }

  public canExecute(): boolean {
    this.checkCooldownTransition();

    if (this.state === "CLOSED") {
      return true;
    }

    if (this.state === "HALF_OPEN") {
      // In HALF_OPEN, permit exactly one single probe request
      if (!this.probeInFlight) {
        this.probeInFlight = true;
        log.info(
          `[CIRCUIT BREAKER: HALF_OPEN] Provider '${this.provider}' đang gửi probe request thăm dò để kiểm tra khôi phục...`
        );
        return true;
      }
      return false; // Other concurrent requests must wait
    }

    return false; // OPEN
  }

  public recordSuccess(): void {
    const prevState = this.state;
    this.consecutiveFailures = 0;
    this.currentCooldownMs = this.baseCooldownMs;
    this.openedAt = null;
    this.probeInFlight = false;
    this.state = "CLOSED";

    if (prevState === "HALF_OPEN") {
      log.info(
        `[CIRCUIT BREAKER: CLOSED] Provider '${this.provider}' đã vượt qua probe thành công! Mạch đóng lại, khôi phục lưu lượng bình thường.`
      );
    }
  }

  public recordFailure(error?: unknown): void {
    this.consecutiveFailures++;

    if (this.state === "HALF_OPEN") {
      // Probe failed: re-open circuit with doubled backoff cooldown
      this.state = "OPEN";
      this.openedAt = Date.now();
      this.currentCooldownMs = Math.min(this.maxCooldownMs, this.currentCooldownMs * 2);
      this.probeInFlight = false;
      log.warn(
        `[CIRCUIT BREAKER: OPEN] Probe request thất bại cho provider '${this.provider}'. Mở lại mạch với thời gian cooldown: ${this.currentCooldownMs}ms.`
      );
      return;
    }

    if (this.consecutiveFailures >= this.maxConsecutiveFailures) {
      this.state = "OPEN";
      this.openedAt = Date.now();
      this.probeInFlight = false;
      log.warn(
        `[CIRCUIT BREAKER: OPEN] Provider '${this.provider}' gặp ${this.consecutiveFailures} lỗi liên tiếp. Mở mạch trong ${this.currentCooldownMs}ms để ngăn chặn retry storm.`
      );
    }
  }

  public getCooldownRemainingMs(): number {
    if (this.state !== "OPEN" || !this.openedAt) return 0;
    const elapsed = Date.now() - this.openedAt;
    return Math.max(0, this.currentCooldownMs - elapsed);
  }

  public reset(): void {
    this.state = "CLOSED";
    this.consecutiveFailures = 0;
    this.currentCooldownMs = this.baseCooldownMs;
    this.openedAt = null;
    this.probeInFlight = false;
  }

  private checkCooldownTransition(): void {
    if (this.state === "OPEN" && this.openedAt) {
      const elapsed = Date.now() - this.openedAt;
      if (elapsed >= this.currentCooldownMs) {
        this.state = "HALF_OPEN";
        this.probeInFlight = false;
      }
    }
  }
}

/**
 * Error Classification
 */
export interface ErrorClassification {
  isRetryable: boolean;
  category: "rate_limit" | "server_error" | "network_drop" | "client_error" | "auth_error" | "budget_cap" | "circuit_open" | "unknown";
  statusCode?: number;
  message: string;
}

export function classifyProviderError(err: any): ErrorClassification {
  if (!err) {
    return { isRetryable: false, category: "unknown", message: "Unknown empty error" };
  }

  const message = String(err.message || err);
  const status = err.status || err.statusCode || err.response?.status;
  const code = err.code;
  const name = err.name;

  // 1. Budget Cap check
  if (name === "BudgetExceededError" || message.includes("Budget cap exceeded")) {
    return { isRetryable: false, category: "budget_cap", message };
  }

  // 2. Circuit Breaker Open
  if (name === "CircuitBreakerOpenError" || message.includes("Circuit breaker is OPEN")) {
    return { isRetryable: false, category: "circuit_open", message };
  }

  // 3. HTTP Status classification
  if (typeof status === "number") {
    if (status === 429) {
      return { isRetryable: true, category: "rate_limit", statusCode: 429, message };
    }
    if (status === 401 || status === 403) {
      return { isRetryable: false, category: "auth_error", statusCode: status, message };
    }
    if (status === 400 || status === 422) {
      return { isRetryable: false, category: "client_error", statusCode: status, message };
    }
    if (status >= 500 && status <= 599) {
      return { isRetryable: true, category: "server_error", statusCode: status, message };
    }
  }

  // 4. Network and Timeout errors
  const networkCodes = ["ECONNRESET", "ETIMEDOUT", "ENOTFOUND", "ECONNREFUSED", "EAI_AGAIN", "UND_ERR_CONNECT_TIMEOUT"];
  if (code && networkCodes.includes(code)) {
    return { isRetryable: true, category: "network_drop", message };
  }

  const lowerMsg = message.toLowerCase();
  if (
    lowerMsg.includes("timeout") ||
    lowerMsg.includes("timed out") ||
    lowerMsg.includes("etimedout") ||
    lowerMsg.includes("network error") ||
    lowerMsg.includes("socket hang up")
  ) {
    return { isRetryable: true, category: "network_drop", message };
  }

  // Default to non-retryable if unclassified client fault
  return { isRetryable: false, category: "unknown", message };
}

/**
 * Calculates exponential backoff with randomized jitter.
 */
export function calculateBackoffWithJitter(
  attempt: number,
  options: {
    baseDelayMs?: number;
    factor?: number;
    maxDelayMs?: number;
    jitterMs?: number;
  } = {}
): number {
  const base = options.baseDelayMs ?? 1000;
  const factor = options.factor ?? 2;
  const max = options.maxDelayMs ?? 15000;
  const jitter = options.jitterMs ?? 500;

  const exponential = base * Math.pow(factor, Math.max(0, attempt - 1));
  const randomizedJitter = Math.floor(Math.random() * jitter);
  return Math.min(max, exponential + randomizedJitter);
}

/**
 * Provider-Specific Concurrency Queue
 */
export class ProviderConcurrencyLimiter {
  private limits: Map<string, number> = new Map([
    ["local_comfyui", 1], // Single local GPU instance
    ["api_kling", 3],     // Kling concurrency tier
    ["api_runway", 2],    // Runway concurrency limit
    ["api_veo", 2],       // Veo concurrency limit
    ["api_seedance", 2],
    ["api_wan", 3],
    ["mock", 10],         // High concurrency for simulation
  ]);

  private activeCounts: Map<string, number> = new Map();
  private waitQueues: Map<string, Array<() => void>> = new Map();

  public setLimit(provider: string, maxConcurrent: number): void {
    this.limits.set(provider, Math.max(1, maxConcurrent));
  }

  public getLimit(provider: string): number {
    return this.limits.get(provider) ?? 2;
  }

  public getActiveCount(provider: string): number {
    return this.activeCounts.get(provider) ?? 0;
  }

  public async acquire(provider: string): Promise<void> {
    const limit = this.getLimit(provider);
    const current = this.getActiveCount(provider);

    if (current < limit) {
      this.activeCounts.set(provider, current + 1);
      return;
    }

    // Wait in queue for available slot
    return new Promise<void>((resolve) => {
      let queue = this.waitQueues.get(provider);
      if (!queue) {
        queue = [];
        this.waitQueues.set(provider, queue);
      }
      queue.push(() => {
        const active = this.getActiveCount(provider);
        this.activeCounts.set(provider, active + 1);
        resolve();
      });
    });
  }

  public release(provider: string): void {
    const current = this.getActiveCount(provider);
    this.activeCounts.set(provider, Math.max(0, current - 1));

    const queue = this.waitQueues.get(provider);
    if (queue && queue.length > 0) {
      const next = queue.shift();
      if (next) next();
    }
  }

  public async runWithConcurrency<T>(provider: string, fn: () => Promise<T>): Promise<T> {
    await this.acquire(provider);
    try {
      return await fn();
    } finally {
      this.release(provider);
    }
  }
}
