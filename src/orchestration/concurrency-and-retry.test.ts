import { describe, it, expect, vi } from "vitest";
import {
  ResilientCircuitBreaker,
  ProviderConcurrencyLimiter,
  classifyProviderError,
  calculateBackoffWithJitter,
} from "./concurrency-and-retry.js";

describe("Concurrency Pool, Retry Backoff Jitter & Half-Open Circuit Breaker (Requirements 7 & 11)", () => {
  it("Circuit Breaker transitions CLOSED -> OPEN -> HALF_OPEN -> CLOSED on successful probe", async () => {
    const cb = new ResilientCircuitBreaker("api_kling", {
      maxConsecutiveFailures: 3,
      baseCooldownMs: 100, // Short cooldown for test
      maxCooldownMs: 500,
    });

    expect(cb.getState()).toBe("CLOSED");
    expect(cb.canExecute()).toBe(true);

    // 1st failure
    cb.recordFailure(new Error("Fail 1"));
    expect(cb.getState()).toBe("CLOSED");
    expect(cb.canExecute()).toBe(true);

    // 2nd failure
    cb.recordFailure(new Error("Fail 2"));
    expect(cb.getState()).toBe("CLOSED");

    // 3rd failure -> Opens Circuit!
    cb.recordFailure(new Error("Fail 3"));
    expect(cb.getState()).toBe("OPEN");
    expect(cb.canExecute()).toBe(false);

    // Wait for cooldown (100ms)
    await new Promise((r) => setTimeout(r, 120));

    // After cooldown, should transition to HALF_OPEN
    expect(cb.getState()).toBe("HALF_OPEN");

    // First call is granted probe execution permission
    expect(cb.canExecute()).toBe(true);

    // Concurrent second call while probe is in flight is DENIED
    expect(cb.canExecute()).toBe(false);

    // Probe succeeds!
    cb.recordSuccess();
    expect(cb.getState()).toBe("CLOSED");
    expect(cb.canExecute()).toBe(true);
  });

  it("Circuit Breaker transitions HALF_OPEN -> OPEN with doubled cooldown on failed probe", async () => {
    const cb = new ResilientCircuitBreaker("api_runway", {
      maxConsecutiveFailures: 2,
      baseCooldownMs: 100,
      maxCooldownMs: 1000,
    });

    cb.recordFailure();
    cb.recordFailure();
    expect(cb.getState()).toBe("OPEN");

    await new Promise((r) => setTimeout(r, 120));
    expect(cb.getState()).toBe("HALF_OPEN");
    expect(cb.canExecute()).toBe(true);

    // Probe FAILS!
    cb.recordFailure(new Error("Probe crashed"));
    expect(cb.getState()).toBe("OPEN");
    expect(cb.getCooldownRemainingMs()).toBeGreaterThan(150); // Doubled cooldown ~200ms
  });

  it("Classifies retryable vs non-retryable errors accurately", () => {
    // Retryable
    const rateLimit = classifyProviderError({ status: 429, message: "Rate limit exceeded" });
    expect(rateLimit.isRetryable).toBe(true);
    expect(rateLimit.category).toBe("rate_limit");

    const serverErr = classifyProviderError({ status: 503, message: "Service Unavailable" });
    expect(serverErr.isRetryable).toBe(true);
    expect(serverErr.category).toBe("server_error");

    const networkDrop = classifyProviderError({ code: "ECONNRESET", message: "socket hang up" });
    expect(networkDrop.isRetryable).toBe(true);
    expect(networkDrop.category).toBe("network_drop");

    // Non-retryable
    const badRequest = classifyProviderError({ status: 400, message: "Invalid parameter: prompt too long" });
    expect(badRequest.isRetryable).toBe(false);
    expect(badRequest.category).toBe("client_error");

    const authFail = classifyProviderError({ status: 401, message: "Unauthorized API key" });
    expect(authFail.isRetryable).toBe(false);
    expect(authFail.category).toBe("auth_error");

    const budgetCap = classifyProviderError(new Error("Budget cap exceeded! Current spend: $25.00"));
    expect(budgetCap.isRetryable).toBe(false);
    expect(budgetCap.category).toBe("budget_cap");
  });

  it("Limits concurrent task execution per provider without starvation", async () => {
    const limiter = new ProviderConcurrencyLimiter();
    limiter.setLimit("test_provider", 2);

    let activeWorkers = 0;
    let maxObservedConcurrency = 0;
    const completedTasks: number[] = [];

    const runTask = async (id: number, durationMs: number) => {
      return limiter.runWithConcurrency("test_provider", async () => {
        activeWorkers++;
        maxObservedConcurrency = Math.max(maxObservedConcurrency, activeWorkers);
        await new Promise((r) => setTimeout(r, durationMs));
        activeWorkers--;
        completedTasks.push(id);
      });
    };

    // Spawn 5 tasks concurrently
    const promises = [
      runTask(1, 60),
      runTask(2, 60),
      runTask(3, 40),
      runTask(4, 40),
      runTask(5, 20),
    ];

    await Promise.all(promises);

    expect(completedTasks.length).toBe(5);
    // Concurrency NEVER exceeded the limit of 2!
    expect(maxObservedConcurrency).toBe(2);
  });

  it("Generates exponential backoff with randomized jitter", () => {
    const d1 = calculateBackoffWithJitter(1, { baseDelayMs: 1000, jitterMs: 200 });
    const d2 = calculateBackoffWithJitter(2, { baseDelayMs: 1000, jitterMs: 200 });
    const d3 = calculateBackoffWithJitter(3, { baseDelayMs: 1000, jitterMs: 200 });

    expect(d1).toBeGreaterThanOrEqual(1000);
    expect(d1).toBeLessThanOrEqual(1200);

    expect(d2).toBeGreaterThanOrEqual(2000);
    expect(d2).toBeLessThanOrEqual(2200);

    expect(d3).toBeGreaterThanOrEqual(4000);
    expect(d3).toBeLessThanOrEqual(4200);
  });
});
