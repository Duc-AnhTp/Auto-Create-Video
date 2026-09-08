import { describe, it, expect, vi } from "vitest";
import {
  VideoModelGateway,
  BudgetExceededError,
  CircuitBreakerOpenError,
  type VideoProviderAdapter,
  type ShotExecutionSpec,
  type VideoJobStatus,
} from "./video-gateway.js";

describe("VideoModelGateway (Phân Hệ VI: Model API Gateway)", () => {
  it("executes shot successfully and tracks spend", async () => {
    const mockAdapter: VideoProviderAdapter = {
      providerName: "api_wan",
      submitJob: vi.fn().mockResolvedValue({ jobId: "job_123" }),
      pollStatus: vi
        .fn()
        .mockResolvedValueOnce({ jobId: "job_123", status: "running" })
        .mockResolvedValueOnce({
          jobId: "job_123",
          status: "completed",
          videoUrl: "https://cdn.example.com/shot_1.mp4",
        }),
    };

    const gateway = new VideoModelGateway({
      maxBudgetUsd: 10.0,
      pollIntervalMs: 10,
      pollTimeoutMs: 500,
    });
    gateway.registerAdapter(mockAdapter);

    const spec: ShotExecutionSpec = {
      shotId: "shot_01",
      backend: "api_wan",
      priority: "hero",
      durationSec: 5.0, // 5s * $0.08 = $0.40
      prompt: "detective walking under rain",
    };

    const res = await gateway.executeShot(spec);
    expect(res.status).toBe("completed");
    expect(res.videoUrl).toBe("https://cdn.example.com/shot_1.mp4");
    expect(gateway.getSpend()).toBeCloseTo(0.40);
  });

  it("throws BudgetExceededError when requested shot exceeds maxBudgetUsd", async () => {
    const mockAdapter: VideoProviderAdapter = {
      providerName: "api_ltx",
      submitJob: vi.fn().mockResolvedValue({ jobId: "job_ltx" }),
      pollStatus: vi.fn().mockResolvedValue({ jobId: "job_ltx", status: "completed" }),
    };

    const gateway = new VideoModelGateway({
      maxBudgetUsd: 1.0, // $1.0 cap
      pollIntervalMs: 10,
    });
    gateway.registerAdapter(mockAdapter);

    const heavySpec: ShotExecutionSpec = {
      shotId: "shot_heavy",
      backend: "api_ltx",
      priority: "hero",
      durationSec: 15.0, // 15s * $0.12 = $1.80 > $1.0
      prompt: "epic battle",
    };

    await expect(gateway.executeShot(heavySpec)).rejects.toThrow(BudgetExceededError);
    expect(mockAdapter.submitJob).not.toHaveBeenCalled();
  });

  it("trips Circuit Breaker after 3 consecutive failures to avoid retry storms", async () => {
    const mockFailAdapter: VideoProviderAdapter = {
      providerName: "api_kling",
      submitJob: vi.fn().mockRejectedValue(new Error("503 Service Unavailable")),
      pollStatus: vi.fn(),
    };

    const gateway = new VideoModelGateway({
      maxBudgetUsd: 50.0,
      pollIntervalMs: 10,
    });
    gateway.registerAdapter(mockFailAdapter);

    const spec: ShotExecutionSpec = {
      shotId: "shot_err",
      backend: "api_kling",
      priority: "hero",
      durationSec: 5.0,
      prompt: "test",
    };

    // 1st failure
    await expect(gateway.executeShot(spec)).rejects.toThrow("503 Service Unavailable");
    // 2nd failure
    await expect(gateway.executeShot(spec)).rejects.toThrow("503 Service Unavailable");
    // 3rd failure (trips circuit to OPEN)
    await expect(gateway.executeShot(spec)).rejects.toThrow("503 Service Unavailable");

    // 4th call should immediately reject with CircuitBreakerOpenError without calling submitJob
    await expect(gateway.executeShot(spec)).rejects.toThrow(CircuitBreakerOpenError);
    expect(mockFailAdapter.submitJob).toHaveBeenCalledTimes(3);
  });

  it("trips Circuit Breaker when pollStatus throws standard Error (network errors)", async () => {
    const mockPollFailAdapter: VideoProviderAdapter = {
      providerName: "api_wan",
      submitJob: vi.fn().mockResolvedValue({ jobId: "job_poll_fail" }),
      pollStatus: vi.fn().mockRejectedValue(new Error("Network timeout")),
    };

    const gateway = new VideoModelGateway({
      maxBudgetUsd: 50.0,
      pollIntervalMs: 10,
    });
    gateway.registerAdapter(mockPollFailAdapter);

    const spec: ShotExecutionSpec = {
      shotId: "shot_poll_err",
      backend: "api_wan",
      priority: "hero",
      durationSec: 5.0,
      prompt: "test poll fail",
    };

    // 3 polling failures
    await expect(gateway.executeShot(spec)).rejects.toThrow("Network timeout");
    await expect(gateway.executeShot(spec)).rejects.toThrow("Network timeout");
    await expect(gateway.executeShot(spec)).rejects.toThrow("Network timeout");

    // 4th call: circuit breaker is open
    await expect(gateway.executeShot(spec)).rejects.toThrow(CircuitBreakerOpenError);
    expect(mockPollFailAdapter.submitJob).toHaveBeenCalledTimes(3);
  });

  it("supports MockVideoAdapter for offline testing with zero compute cost", async () => {
    const { MockVideoAdapter } = await import("./adapters/mock-adapter.js");
    const mockAdapter = new MockVideoAdapter("output/test-mock-videos");
    const gateway = new VideoModelGateway();
    gateway.registerAdapter(mockAdapter);

    const spec: ShotExecutionSpec = {
      shotId: "mock_shot_01",
      backend: "mock",
      priority: "standard",
      durationSec: 4.0,
      prompt: "detective walking into bar",
      aspectRatio: "9:16",
    };

    const res = await gateway.executeShot(spec);
    expect(res.status).toBe("completed");
    expect(res.localPath).toContain("mock_shot_01.mp4");
    expect(gateway.getSpend()).toBe(0.0);
  });

  it("handles KlingAdapter error when API key is missing", async () => {
    const { KlingAdapter } = await import("./adapters/kling-adapter.js");
    const adapter = new KlingAdapter({ apiKey: "" });

    const spec: ShotExecutionSpec = {
      shotId: "kling_test",
      backend: "api_kling",
      priority: "hero",
      durationSec: 5.0,
      prompt: "test",
    };

    await expect(adapter.submitJob(spec)).rejects.toThrow("KLING_API_KEY is not configured");
  });

  it("handles RunwayAdapter error when API key is missing", async () => {
    const { RunwayAdapter } = await import("./adapters/runway-adapter.js");
    const adapter = new RunwayAdapter({ apiKey: "" });

    const spec: ShotExecutionSpec = {
      shotId: "runway_test",
      backend: "api_runway",
      priority: "hero",
      durationSec: 5.0,
      prompt: "test",
    };

    await expect(adapter.submitJob(spec)).rejects.toThrow("RUNWAY_API_KEY is not configured");
  });
});
