import { describe, it, expect, beforeEach, afterEach } from "vitest";
import nock from "nock";
import { ComfyUiAdapter } from "./adapters/comfyui-adapter.js";
import { MockVideoAdapter } from "./adapters/mock-adapter.js";
import { VideoModelGateway, type ShotExecutionSpec } from "./video-gateway.js";

describe("ComfyUiAdapter & Video Gateway Auto-Failover", () => {
  const comfyHost = "http://127.0.0.1:8188";

  beforeEach(() => {
    nock.cleanAll();
  });

  afterEach(() => {
    nock.cleanAll();
  });

  describe("1. ComfyUI Workflow Graph Building", () => {
    it("generates correct node graph structure for 9:16 vertical video", () => {
      const adapter = new ComfyUiAdapter({ baseUrl: comfyHost });
      const spec: ShotExecutionSpec = {
        shotId: "sc1_sh1",
        backend: "local_comfyui",
        priority: "standard",
        durationSec: 4.0,
        prompt: "Toàn cảnh Hẻm 9 Sài Gòn ánh đèn neon",
        aspectRatio: "9:16",
      };

      const workflow = adapter.buildPromptWorkflow(spec) as any;

      expect(workflow["3"].class_type).toBe("KSampler");
      expect(workflow["4"].class_type).toBe("CheckpointLoaderSimple");
      expect(workflow["5"].class_type).toBe("WanVideoEmptyLatent");
      expect(workflow["5"].inputs.width).toBe(720);
      expect(workflow["5"].inputs.height).toBe(1280);
      expect(workflow["6"].inputs.text).toBe("Toàn cảnh Hẻm 9 Sài Gòn ánh đèn neon");
      expect(workflow["9"].class_type).toBe("VHS_VideoCombine");
      expect(workflow["9"].inputs.filename_prefix).toBe("series_sc1_sh1");
    });

    it("generates correct dimensions for 16:9 landscape video", () => {
      const adapter = new ComfyUiAdapter({ baseUrl: comfyHost });
      const spec: ShotExecutionSpec = {
        shotId: "sc2_sh1",
        backend: "local_comfyui",
        priority: "standard",
        durationSec: 5.0,
        prompt: "Đại lộ sông Sài Gòn",
        aspectRatio: "16:9",
      };

      const workflow = adapter.buildPromptWorkflow(spec) as any;
      expect(workflow["5"].inputs.width).toBe(1280);
      expect(workflow["5"].inputs.height).toBe(720);
    });
  });

  describe("2. ComfyUI API Execution & Polling", () => {
    it("successfully submits job and polls completed video output", async () => {
      const adapter = new ComfyUiAdapter({ baseUrl: comfyHost });

      // Mock POST /prompt
      nock(comfyHost)
        .post("/prompt")
        .reply(200, {
          prompt_id: "comfy_task_abc123",
          number: 1,
        });

      const spec: ShotExecutionSpec = {
        shotId: "sc1_sh1",
        backend: "local_comfyui",
        priority: "standard",
        durationSec: 3.0,
        prompt: "Minh bước vào quán bar",
      };

      const { jobId } = await adapter.submitJob(spec);
      expect(jobId).toBe("comfy_task_abc123");

      // Mock GET /history/comfy_task_abc123
      nock(comfyHost)
        .get("/history/comfy_task_abc123")
        .reply(200, {
          comfy_task_abc123: {
            status: { status_str: "success", completed: true },
            outputs: {
              "9": {
                videos: [
                  {
                    filename: "series_sc1_sh1_0001.mp4",
                    subfolder: "ep1",
                    type: "output",
                  },
                ],
              },
            },
          },
        });

      const status = await adapter.pollStatus(jobId);
      expect(status.status).toBe("completed");
      expect(status.videoUrl).toBe(
        "http://127.0.0.1:8188/view?filename=series_sc1_sh1_0001.mp4&subfolder=ep1&type=output"
      );
    });

    it("handles ComfyUI execution failure gracefully", async () => {
      const adapter = new ComfyUiAdapter({ baseUrl: comfyHost });

      nock(comfyHost)
        .get("/history/err_task")
        .reply(200, {
          err_task: {
            status: {
              status_str: "error",
              messages: "CUDA out of memory",
            },
          },
        });

      const status = await adapter.pollStatus("err_task");
      expect(status.status).toBe("failed");
      expect(status.error).toContain("CUDA out of memory");
    });

    it("throws helpful error message when ComfyUI server is offline (ECONNREFUSED)", async () => {
      const adapter = new ComfyUiAdapter({ baseUrl: "http://127.0.0.1:9999" });
      const netError = Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:9999"), {
        code: "ECONNREFUSED",
      });
      nock("http://127.0.0.1:9999")
        .post("/prompt")
        .replyWithError(netError);

      const spec: ShotExecutionSpec = {
        shotId: "sc1_sh1",
        backend: "local_comfyui",
        priority: "standard",
        durationSec: 3.0,
        prompt: "Minh test",
      };

      await expect(adapter.submitJob(spec)).rejects.toThrow("Cannot connect to ComfyUI server");
    });

    it("throws error when reference image does not exist for upload", async () => {
      const adapter = new ComfyUiAdapter({ baseUrl: comfyHost });
      await expect(adapter.uploadInputImage("assets/non_existent_file.jpg")).rejects.toThrow(
        "Reference image not found"
      );
    });
  });

  describe("3. Video Gateway Auto-Failover Strategy", () => {
    it("automatically fails over to fallback provider when primary provider encounters an error", async () => {
      const gateway = new VideoModelGateway({
        pollIntervalMs: 50,
        pollTimeoutMs: 1000,
        fallbackChain: ["mock"],
        enableFailover: true,
      });

      const comfyAdapter = new ComfyUiAdapter({ baseUrl: comfyHost });
      const mockAdapter = new MockVideoAdapter();

      gateway.registerAdapter(comfyAdapter);
      gateway.registerAdapter(mockAdapter);

      // Make ComfyUI fail on POST /prompt
      nock(comfyHost)
        .post("/prompt")
        .reply(500, { error: "Local GPU unavailable" });

      const spec: ShotExecutionSpec = {
        shotId: "sc1_sh1",
        backend: "local_comfyui",
        fallbackProviders: ["mock"],
        priority: "standard",
        durationSec: 4.0,
        prompt: "Thám tử Minh",
      };

      // Execute shot: ComfyUI fails -> Gateway automatically falls back to mock!
      const result = await gateway.executeShot(spec);
      expect(result.status).toBe("completed");
      expect(result.jobId).toContain("mock_sc1_sh1");
    });

    it("throws CircuitBreakerOpenError if a provider has too many consecutive failures without fallback", async () => {
      const gateway = new VideoModelGateway({
        pollIntervalMs: 50,
        pollTimeoutMs: 500,
        enableFailover: false, // Failover disabled
      });

      const comfyAdapter = new ComfyUiAdapter({ baseUrl: comfyHost });
      gateway.registerAdapter(comfyAdapter);

      // 3 consecutive failures
      nock(comfyHost).post("/prompt").times(3).reply(500, "Server Down");

      const spec: ShotExecutionSpec = {
        shotId: "sc1_sh2",
        backend: "local_comfyui",
        priority: "standard",
        durationSec: 2.0,
        prompt: "Shot test",
      };

      for (let i = 0; i < 3; i++) {
        try {
          await gateway.executeShot(spec);
        } catch {}
      }

      // 4th call should immediately trip circuit breaker
      await expect(gateway.executeShot(spec)).rejects.toThrow("Circuit breaker is OPEN");
    });
  });
});
