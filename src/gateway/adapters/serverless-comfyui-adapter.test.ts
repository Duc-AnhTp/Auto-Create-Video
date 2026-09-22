import { describe, it, expect } from "vitest";
import { ServerlessComfyUIAdapter } from "./serverless-comfyui-adapter.js";
import type { ShotExecutionSpec } from "../video-gateway.js";

describe("ServerlessComfyUIAdapter", () => {
  it("submits job and returns completed status with mockFallback", async () => {
    const adapter = new ServerlessComfyUIAdapter({
      endpoint: "https://api.runpod.ai/v2/dummy-endpoint",
      mockFallback: true,
    });

    const spec: ShotExecutionSpec = {
      shotId: "shot_hero_01",
      backend: "serverless_comfyui",
      priority: "hero",
      durationSec: 4.0,
      prompt: "Hero standing on cliff at sunset",
    };

    const { jobId } = await adapter.submitJob(spec);
    expect(jobId).toContain("mock_serverless_shot_hero_01");

    const status = await adapter.pollStatus(jobId);
    expect(status.status).toBe("completed");
    expect(status.videoUrl).toBeDefined();
  });

  it("exposes valid provider capabilities registered in PROVIDER_CAPABILITY_REGISTRY", () => {
    const adapter = new ServerlessComfyUIAdapter({
      endpoint: "https://api.runpod.ai/v2/dummy-endpoint",
      mockFallback: true,
    });
    expect(adapter.capabilities).toBeDefined();
    expect(adapter.capabilities.providerName).toBe("serverless_comfyui");
    expect(adapter.capabilities.allowedDurationsSec).toBe("continuous");
    expect(adapter.capabilities.maxDurationSec).toBe(15);
  });
});
