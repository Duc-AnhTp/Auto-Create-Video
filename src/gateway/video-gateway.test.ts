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
});
