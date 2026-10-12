export type CircuitBreakerState = "CLOSED" | "OPEN" | "HALF_OPEN";

export interface CircuitBreakerConfig {
  /** Maximum consecutive failures before tripping to OPEN. Default: 3 */
  maxConsecutiveFailures?: number;
  /** Cooldown time in ms before transitioning from OPEN to HALF_OPEN. Default: 60000 (60s) */
  cooldownMs?: number;
}

export interface CircuitBreakerStats {
  state: CircuitBreakerState;
  failureCount: number;
  successCount: number;
  lastFailureTime?: number;
  lastSuccessTime?: number;
  totalTrips: number;
}

/**
 * Resilient 3-State Circuit Breaker (CLOSED -> OPEN -> HALF_OPEN -> CLOSED).
 * Protects downstream AI video providers from failure storms and runaway costs,
 * while automatically probing for recovery after a cooldown window.
 */
export class ResilientCircuitBreaker {
  private state: CircuitBreakerState = "CLOSED";
  private failureCount = 0;
  private successCount = 0;
  private totalTrips = 0;
  private lastFailureTime?: number;
  private lastSuccessTime?: number;
  private halfOpenProbeInFlight = false;

  private readonly maxConsecutiveFailures: number;
  private readonly cooldownMs: number;

  constructor(config: CircuitBreakerConfig | number = {}) {
    const cfg = typeof config === "number" ? { maxConsecutiveFailures: config } : config;
    this.maxConsecutiveFailures = cfg.maxConsecutiveFailures ?? 3;
    this.cooldownMs = cfg.cooldownMs ?? 60000;
  }

  /**
   * Determines if a request is permitted to proceed.
   * Handles automatic transition from OPEN -> HALF_OPEN when cooldown expires.
   */
  public canExecute(): boolean {
    if (this.state === "CLOSED") {
      return true;
    }

    const now = Date.now();

    if (this.state === "OPEN") {
      if (this.lastFailureTime && now - this.lastFailureTime >= this.cooldownMs) {
        // Cooldown passed: transition to HALF_OPEN to allow a single probe request
        this.state = "HALF_OPEN";
        this.halfOpenProbeInFlight = true;
        return true;
      }
      return false;
    }

    if (this.state === "HALF_OPEN") {
      // In HALF_OPEN, only allow 1 probe request in flight at a time
      if (!this.halfOpenProbeInFlight) {
        this.halfOpenProbeInFlight = true;
        return true;
      }
      return false;
    }

    return false;
  }

  /**
   * Records a successful execution.
   * If in HALF_OPEN, resets and restores circuit breaker to CLOSED.
   */
  public recordSuccess(): void {
    this.successCount++;
    this.failureCount = 0;
    this.lastSuccessTime = Date.now();
    this.halfOpenProbeInFlight = false;
    this.state = "CLOSED";
  }

  /**
   * Records a failure.
   * If failure threshold exceeded or if failing during HALF_OPEN probe, trips to OPEN.
   */
  public recordFailure(): void {
    this.failureCount++;
    this.lastFailureTime = Date.now();
    this.halfOpenProbeInFlight = false;

    if (this.state === "HALF_OPEN" || this.failureCount >= this.maxConsecutiveFailures) {
      if (this.state !== "OPEN") {
        this.totalTrips++;
      }
      this.state = "OPEN";
    }
  }

  /**
   * Manually resets the circuit breaker to closed state.
   */
  public reset(): void {
    this.state = "CLOSED";
    this.failureCount = 0;
    this.halfOpenProbeInFlight = false;
  }

  /**
   * Aborts an in-flight probe without recording success or failure
   * (e.g. when pre-flight validation throws before dispatching request).
   */
  public abortProbe(): void {
    if (this.halfOpenProbeInFlight) {
      this.halfOpenProbeInFlight = false;
    }
  }

  /**
   * Returns current state, accounting for expired cooldown.
   */
  public getState(): CircuitBreakerState {
    if (this.state === "OPEN" && this.lastFailureTime && Date.now() - this.lastFailureTime >= this.cooldownMs) {
      return "HALF_OPEN";
    }
    return this.state;
  }

  /**
   * Returns current telemetry and health stats.
   */
  public getStats(): CircuitBreakerStats {
    return {
      state: this.getState(),
      failureCount: this.failureCount,
      successCount: this.successCount,
      lastFailureTime: this.lastFailureTime,
      lastSuccessTime: this.lastSuccessTime,
      totalTrips: this.totalTrips,
    };
  }
}
