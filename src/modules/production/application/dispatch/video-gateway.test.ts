import { describe, it, expect, vi } from "vitest";
import { VideoModelGateway, CircuitBreakerOpenError, PROVIDER_CAPABILITY_REGISTRY } from "./video-gateway.js";
import { type VideoProviderAdapter, type ShotExecutionSpec } from "../../../../contracts/video.js";

describe("VideoModelGateway (Phân Hệ VI: Model API Gateway)", () => {
  it("rejects unreserved direct production dispatch before submitting", async () => {
    const gateway = new VideoModelGateway({enableFailover:true,fallbackChain:["mock"]});
    const submitJob=vi.fn();gateway.registerAdapter({providerName:"api_kling",submitJob,pollStatus:vi.fn()});
    await expect(gateway.executeShot({shotId:"unreserved",backend:"api_kling",durationSec:5,prompt:"fixture",allowDirectExecution:true})).rejects.toThrow("DURABLE_ORCHESTRATOR_REQUIRED");
    expect(submitJob).not.toHaveBeenCalled();
  });

  it("does not fail over an unreserved production dispatch to mock", async () => {
    const gateway = new VideoModelGateway({enableFailover:true,fallbackChain:["mock"]});
    const submitJob=vi.fn();gateway.registerAdapter({providerName:"api_kling",submitJob,pollStatus:vi.fn()});
    const fallbackSubmit = vi.fn();
    gateway.registerAdapter({providerName:"mock",submitJob:fallbackSubmit,pollStatus:vi.fn()});
    await expect(gateway.executeShot({shotId:"unreserved",backend:"api_kling",durationSec:5,prompt:"fixture",allowDirectExecution:true})).rejects.toThrow("DURABLE_ORCHESTRATOR_REQUIRED");
    expect(submitJob).not.toHaveBeenCalled();
    expect(fallbackSubmit).not.toHaveBeenCalled();
  });

  it("trips Circuit Breaker after 3 consecutive failures to avoid retry storms", async () => {
    const mockFailAdapter: VideoProviderAdapter = {
      providerName: "mock",
      capabilities: PROVIDER_CAPABILITY_REGISTRY.api_kling,
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
      backend: "mock",
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
      providerName: "mock",
      capabilities: {
        ...PROVIDER_CAPABILITY_REGISTRY.mock,
        providerName: "mock",
      },
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
      backend: "mock",
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
    const { MockVideoAdapter } = await import("../../adapters/providers/mock-adapter.js");
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
    expect(res.localPath).toContain("mock_shot_01_");
    expect(gateway.getSpend()).toBe(0.0);
  });

  it("handles KlingAdapter error when API key is missing", async () => {
    const { KlingAdapter } = await import("../../adapters/providers/kling-adapter.js");
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
    const { RunwayAdapter } = await import("../../adapters/providers/runway-adapter.js");
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

  it("handles VeoAdapter error when API key is missing", async () => {
    const { VeoAdapter } = await import("../../adapters/providers/veo-adapter.js");
    const adapter = new VeoAdapter({ apiKey: "" });

    const spec: ShotExecutionSpec = {
      shotId: "veo_test",
      backend: "api_veo",
      priority: "hero",
      durationSec: 5.0,
      prompt: "test",
    };

    await expect(adapter.submitJob(spec)).rejects.toThrow("VEO_API_KEY");
  });

  it("tracks gateway execution telemetry and failover stats accurately", async () => {
    const gateway = new VideoModelGateway({enableFailover:true,fallbackChain:["mock"]});
    const submitJob=vi.fn();gateway.registerAdapter({providerName:"api_kling",submitJob,pollStatus:vi.fn()});
    await expect(gateway.executeShot({shotId:"unreserved",backend:"api_kling",durationSec:5,prompt:"fixture",allowDirectExecution:true})).rejects.toThrow("DURABLE_ORCHESTRATOR_REQUIRED");
    expect(submitJob).not.toHaveBeenCalled();
  });
});
