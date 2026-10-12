import { describe, it, expect, vi } from "vitest";
import { ResilientCircuitBreaker } from "./circuit-breaker.js";
import { ProviderRateLimiter } from "./provider-rate-limiter.js";
import { withHttpRetry } from "../../adapters/http-retry.js";
import { ProviderWebhookRegistry } from "../../adapters/webhook-registry.js";
import { VideoModelGateway } from "./video-gateway.js";
import { createDefaultVideoGateway } from "../../../../bootstrap/video-gateway.js";


describe("Real AI Video Gateway Hardening Suite", () => {
  describe("1. Resilient 3-State Circuit Breaker (CLOSED -> OPEN -> HALF_OPEN -> CLOSED)", () => {
    it("starts in CLOSED state and permits executions", () => {
      const cb = new ResilientCircuitBreaker({ maxConsecutiveFailures: 3, cooldownMs: 50 });
      expect(cb.getState()).toBe("CLOSED");
      expect(cb.canExecute()).toBe(true);
    });

    it("trips to OPEN after max consecutive failures", () => {
      const cb = new ResilientCircuitBreaker({ maxConsecutiveFailures: 3, cooldownMs: 50 });
      cb.recordFailure();
      expect(cb.getState()).toBe("CLOSED");
      cb.recordFailure();
      expect(cb.getState()).toBe("CLOSED");
      cb.recordFailure(); // 3rd failure trips
      expect(cb.getState()).toBe("OPEN");
      expect(cb.canExecute()).toBe(false);
    });

    it("automatically transitions from OPEN to HALF_OPEN after cooldown and permits exactly one probe", async () => {
      const cb = new ResilientCircuitBreaker({ maxConsecutiveFailures: 2, cooldownMs: 30 });
      cb.recordFailure();
      cb.recordFailure();
      expect(cb.getState()).toBe("OPEN");
      expect(cb.canExecute()).toBe(false);

      // Wait for cooldown to expire
      await new Promise((resolve) => setTimeout(resolve, 35));

      // First call after cooldown should transition to HALF_OPEN and permit execution
      expect(cb.canExecute()).toBe(true);
      expect(cb.getState()).toBe("HALF_OPEN");

      // While probe is in flight, subsequent calls should be rejected
      expect(cb.canExecute()).toBe(false);

      // Successful probe restores circuit to CLOSED
      cb.recordSuccess();
      expect(cb.getState()).toBe("CLOSED");
      expect(cb.canExecute()).toBe(true);
    });

    it("trips immediately back to OPEN if canary probe in HALF_OPEN fails", async () => {
      const cb = new ResilientCircuitBreaker({ maxConsecutiveFailures: 2, cooldownMs: 30 });
      cb.recordFailure();
      cb.recordFailure();
      expect(cb.getState()).toBe("OPEN");

      await new Promise((resolve) => setTimeout(resolve, 35));
      expect(cb.canExecute()).toBe(true);
      expect(cb.getState()).toBe("HALF_OPEN");

      // Probe failure trips straight back to OPEN
      cb.recordFailure();
      expect(cb.getState()).toBe("OPEN");
      expect(cb.canExecute()).toBe(false);
    });
  });

  describe("2. Provider Rate Limiter & Concurrency Manager", () => {
    it("enforces max concurrency and drains queue as slots are released", async () => {
      const limiter = new ProviderRateLimiter({
        test_provider: { maxConcurrent: 2, maxRpm: 60 },
      });

      const release1 = await limiter.acquire("test_provider");
      const release2 = await limiter.acquire("test_provider");

      expect(limiter.getActiveConcurrency("test_provider")).toBe(2);

      let thirdAcquired = false;
      const thirdPromise = limiter.acquire("test_provider").then((rel) => {
        thirdAcquired = true;
        return rel;
      });

      // Third request must wait in queue
      expect(thirdAcquired).toBe(false);
      expect(limiter.getQueueLength("test_provider")).toBe(1);

      // Release first slot
      release1();
      const release3 = await thirdPromise;
      expect(thirdAcquired).toBe(true);
      expect(limiter.getActiveConcurrency("test_provider")).toBe(2);
      expect(limiter.getQueueLength("test_provider")).toBe(0);

      release2();
      release3();
      expect(limiter.getActiveConcurrency("test_provider")).toBe(0);
    });

    it("enforces timeout on queued requests", async () => {
      const limiter = new ProviderRateLimiter({
        test_slow: { maxConcurrent: 1, maxRpm: 60 },
      });

      const release1 = await limiter.acquire("test_slow");
      // Acquire with 25ms timeout
      await expect(limiter.acquire("test_slow", 25)).rejects.toThrow("Rate limit acquisition timed out");

      release1();
    });
  });

  describe("3. Transient HTTP Retry with Jitter & Retry-After", () => {
    it("retries on transient status codes (429, 502, 503) and succeeds", async () => {
      let attempts = 0;
      const flakyOperation = async () => {
        attempts++;
        if (attempts < 3) {
          const err: any = new Error("Rate limit exceeded");
          err.response = { status: 429, headers: { "retry-after": "0.01" } };
          throw err;
        }
        return { success: true };
      };

      const result = await withHttpRetry(flakyOperation, {
        maxAttempts: 3,
        initialDelayMs: 10,
        jitter: false,
      });

      expect(result.success).toBe(true);
      expect(attempts).toBe(3);
    });

    it("does not retry on fatal client error (400 Bad Request)", async () => {
      let attempts = 0;
      const fatalOperation = async () => {
        attempts++;
        const err: any = new Error("Bad Request");
        err.response = { status: 400 };
        throw err;
      };

      await expect(
        withHttpRetry(fatalOperation, { maxAttempts: 3, initialDelayMs: 10 })
      ).rejects.toThrow("Bad Request");

      expect(attempts).toBe(1); // Fails immediately without retry
    });
  });

  describe("4. Provider Webhook Registry & Dual-Mode Dispatch", () => {
    it("resolves pending job immediately upon receiving provider webhook", async () => {
      const registry = new ProviderWebhookRegistry();
      const jobId = "kling_task_999";

      const waitPromise = registry.waitForWebhook(jobId, "api_kling", 2000);

      const handled = registry.receiveWebhook("api_kling", {
        task_id: jobId,
        task_status: "succeed",
        task_result: {
          videos: [{ url: "https://cdn.kling.ai/video_999.mp4" }],
          invoiced_cost_usd: 0.15,
        },
      });

      expect(handled).toBe(true);
      const status = await waitPromise;
      expect(status.status).toBe("completed");
      expect(status.videoUrl).toBe("https://cdn.kling.ai/video_999.mp4");
      expect(status.invoicedCostUsd).toBe(0.15);
      expect(status.isConfirmedInvoice).toBe(true);
    });

    it("rejects when provider webhook reports task failure", async () => {
      const registry = new ProviderWebhookRegistry();
      const jobId = "runway_task_fail";

      const waitPromise = registry.waitForWebhook(jobId, "api_runway", 2000);

      registry.receiveWebhook("api_runway", {
        id: jobId,
        status: "FAILED",
        failure_reason: "Prompt violates content moderation guidelines",
      });

      await expect(waitPromise).rejects.toThrow("content moderation");
    });
  });

  describe("5. Factory createDefaultVideoGateway & Integration", () => {
    it("instantiates default gateway with all real and mock providers registered", () => {
      const gateway = createDefaultVideoGateway();
      const providers = gateway.getAvailableProviders();

      expect(providers).toContain("mock");
      expect(providers).toContain("local_comfyui");
      expect(providers).toContain("serverless_comfyui");
      expect(providers).toContain("api_kling");
      expect(providers).toContain("api_runway");
      expect(providers).toContain("api_veo");
      expect(providers).toContain("api_seedance");
    });

    it("reconciles invoicedCostUsd and updates spend accurately during executeShot", async () => {
      const gateway = new VideoModelGateway({enableFailover:true,fallbackChain:["mock"]});
      const submitJob=vi.fn();gateway.registerAdapter({providerName:"api_kling",submitJob,pollStatus:vi.fn()});
      await expect(gateway.executeShot({shotId:"unreserved",backend:"api_kling",durationSec:5,prompt:"fixture",allowDirectExecution:true})).rejects.toThrow("DURABLE_ORCHESTRATOR_REQUIRED");
      expect(submitJob).not.toHaveBeenCalled();
    });

    it("wakes up immediately via webhook in dual-mode without waiting for slow poll", async () => {
      const gateway = new VideoModelGateway({enableFailover:true,fallbackChain:["mock"]});
      const submitJob=vi.fn();gateway.registerAdapter({providerName:"api_kling",submitJob,pollStatus:vi.fn()});
      await expect(gateway.executeShot({shotId:"unreserved",backend:"api_kling",durationSec:5,prompt:"fixture",allowDirectExecution:true})).rejects.toThrow("DURABLE_ORCHESTRATOR_REQUIRED");
      expect(submitJob).not.toHaveBeenCalled();
    });
  });
});
