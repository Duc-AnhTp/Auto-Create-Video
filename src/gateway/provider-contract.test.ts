import { describe, it, expect, beforeEach, afterEach } from "vitest";
import nock from "nock";
import { writeFile, mkdir, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { KlingAdapter } from "./adapters/kling-adapter.js";
import { RunwayAdapter } from "./adapters/runway-adapter.js";
import { ComfyUiAdapter } from "./adapters/comfyui-adapter.js";
import { VeoAdapter } from "./adapters/veo-adapter.js";
import { SeedanceAdapter } from "./adapters/seedance-adapter.js";
import { MockVideoAdapter } from "./adapters/mock-adapter.js";
import {
  PROVIDER_CAPABILITY_REGISTRY,
  CapabilityMismatchError,
  validateSpecAgainstCapabilities,
} from "./provider-capabilities.js";
import { resolveImageToDataUriOrUrl, categorizeImageProtocol } from "./asset-resolver.js";
import {
  decomposeShotDuration,
  extractLastFrame,
  buildCrossfadeStitchFilter,
  stitchPassClips,
} from "../pipeline/shot-chaining.js";
import { createValidMockMp4File } from "../assets/mock-media-generator.js";
import { probeVideoFile } from "../media/media-validator.js";

describe("Provider Contracts & Video Stitching Engine (Phân Hệ VI & IV)", () => {
  const testOutputDir = "output/test-provider-contracts";

  beforeEach(async () => {
    nock.cleanAll();
    await mkdir(testOutputDir, { recursive: true });
  });

  afterEach(() => {
    nock.cleanAll();
  });

  // ── 1. KLING AI OFFICIAL CONTRACT TESTS ────────────────────────────────────
  describe("1. Kling AI Official API Contract", () => {
    const klingHost = "https://api.klingai.com";
    const apiKey = "test_kling_key_12345";

    it("constructs official image2video payload with Base64 Data URI and discrete 5s duration", async () => {
      const adapter = new KlingAdapter({ baseUrl: klingHost, apiKey });

      // Create a temporary test image file on disk
      const testImgPath = join(testOutputDir, "character_test.jpg");
      await writeFile(testImgPath, Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]));

      let interceptedPayload: any = null;
      let interceptedHeaders: any = null;

      nock(klingHost)
        .post("/v1/videos/image2video", (body) => {
          interceptedPayload = body;
          return true;
        })
        .matchHeader("authorization", `Bearer ${apiKey}`)
        .reply(200, {
          code: 0,
          message: "SUCCEED",
          data: { task_id: "kling_task_987" },
        });

      const spec = {
        shotId: "shot_kling_01",
        backend: "api_kling" as const,
        priority: "hero" as const,
        durationSec: 5.0,
        prompt: "Minh đứng dưới mưa neon",
        aspectRatio: "9:16" as const,
        referenceImage: testImgPath,
      };

      const { jobId } = await adapter.submitJob(spec);
      expect(jobId).toBe("kling_task_987");

      // Verify official request payload structure
      expect(interceptedPayload.prompt).toBe("Minh đứng dưới mưa neon");
      expect(interceptedPayload.duration).toBe("5"); // Discrete string duration
      expect(interceptedPayload.aspect_ratio).toBe("9:16");
      expect(interceptedPayload.image).toMatch(/^data:image\/jpeg;base64,/); // Safely resolved to base64 Data URI
    });

    it("polls task status correctly for 'succeed' and 'failed'", async () => {
      const adapter = new KlingAdapter({ baseUrl: klingHost, apiKey });

      // 1. Success poll
      nock(klingHost)
        .get("/v1/videos/tasks/kling_task_success")
        .reply(200, {
          code: 0,
          data: {
            task_status: "succeed",
            task_result: {
              videos: [
                {
                  id: "vid_1",
                  url: "https://cdn.klingai.com/rendered_shot.mp4",
                  duration: "5.0",
                },
              ],
            },
          },
        });

      const successStatus = await adapter.pollStatus("kling_task_success");
      expect(successStatus.status).toBe("completed");
      expect(successStatus.videoUrl).toBe("https://cdn.klingai.com/rendered_shot.mp4");
      expect(successStatus.durationSec).toBe(5.0);

      // 2. Failure poll
      nock(klingHost)
        .get("/v1/videos/tasks/kling_task_fail")
        .reply(200, {
          code: 0,
          data: {
            task_status: "failed",
            task_status_msg: "Prompt content policy violation",
          },
        });

      const failStatus = await adapter.pollStatus("kling_task_fail");
      expect(failStatus.status).toBe("failed");
      expect(failStatus.error).toBe("Prompt content policy violation");
    });

    it("constructs Kling 3.0 payload with model_name='kling-v3', seed, and camera control", async () => {
      const adapter = new KlingAdapter({ baseUrl: klingHost, apiKey, defaultModel: "kling-v3" });

      let capturedPayload: any = null;
      nock(klingHost)
        .post("/v1/videos/text2video", (body) => {
          capturedPayload = body;
          return true;
        })
        .matchHeader("authorization", `Bearer ${apiKey}`)
        .reply(200, {
          code: 0,
          data: { task_id: "kling_v3_task_123" },
        });

      const spec = {
        shotId: "shot_kling3_01",
        backend: "api_kling" as const,
        priority: "hero" as const,
        durationSec: 10.0,
        prompt: "Cinematic drone shot of floating neon city",
        aspectRatio: "16:9" as const,
        seed: 777888,
        metadata: {
          camera_control: { type: "zoom_in", value: 5 },
        },
      };

      const { jobId } = await adapter.submitJob(spec);
      expect(jobId).toBe("kling_v3_task_123");
      expect(capturedPayload.model_name).toBe("kling-v3");
      expect(capturedPayload.duration).toBe("10");
      expect(capturedPayload.seed).toBe(777888);
      expect(capturedPayload.aspect_ratio).toBe("16:9");
      expect(capturedPayload.camera_control).toEqual({ type: "zoom_in", value: 5 });
    });
  });

  // ── 2. GOOGLE DEEPMIND VEO 3.1 CONTRACT TESTS ─────────────────────────────
  describe("2. Google DeepMind Veo 3.1 Official API Contract", () => {
    const veoHost = "https://generativelanguage.googleapis.com/v1beta";
    const apiKey = "google_gemini_veo_key_999";

    it("constructs official predictLongRunning payload with instances, parameters, seed and 9:16 ratio", async () => {
      const adapter = new VeoAdapter({ baseUrl: veoHost, apiKey });

      let capturedPayload: any = null;
      nock(veoHost)
        .post("/models/veo-3.1:predictLongRunning", (body) => {
          capturedPayload = body;
          return true;
        })
        .matchHeader("x-goog-api-key", apiKey)
        .reply(200, {
          name: "operations/veo_op_555",
        });

      const spec = {
        shotId: "shot_veo_01",
        backend: "api_veo" as const,
        priority: "hero" as const,
        durationSec: 5.0,
        prompt: "A cyborg detective walking down a wet asphalt street in rain",
        aspectRatio: "9:16" as const,
        seed: 334455,
      };

      const { jobId } = await adapter.submitJob(spec);
      expect(jobId).toBe("operations/veo_op_555");
      expect(capturedPayload.instances[0].prompt).toBe(spec.prompt);
      expect(capturedPayload.parameters.durationSeconds).toBe(5);
      expect(capturedPayload.parameters.aspectRatio).toBe("9:16");
      expect(capturedPayload.parameters.seed).toBe(334455);
    });

    it("polls Google Veo operation status until done and extracts video URI", async () => {
      const adapter = new VeoAdapter({ baseUrl: veoHost, apiKey });

      nock(veoHost)
        .get("/operations/veo_op_done")
        .matchHeader("x-goog-api-key", apiKey)
        .reply(200, {
          name: "operations/veo_op_done",
          done: true,
          response: {
            generatedSamples: [
              {
                video: {
                  uri: "https://storage.googleapis.com/veo-videos/render_01.mp4",
                  duration: "5.0s",
                },
              },
            ],
          },
        });

      const status = await adapter.pollStatus("operations/veo_op_done");
      expect(status.status).toBe("completed");
      expect(status.videoUrl).toBe("https://storage.googleapis.com/veo-videos/render_01.mp4");
      expect(status.durationSec).toBe(5.0);
    });

    it("handles Veo operation failure correctly", async () => {
      const adapter = new VeoAdapter({ baseUrl: veoHost, apiKey });

      nock(veoHost)
        .get("/operations/veo_op_failed")
        .matchHeader("x-goog-api-key", apiKey)
        .reply(200, {
          name: "operations/veo_op_failed",
          done: true,
          error: {
            code: 400,
            message: "Safety filter triggered for input prompt",
          },
        });

      const status = await adapter.pollStatus("operations/veo_op_failed");
      expect(status.status).toBe("failed");
      expect(status.error).toContain("Safety filter triggered");
    });
  });

  // ── 3. BYTEDANCE SEEDANCE 2.0 CONTRACT TESTS ───────────────────────────────
  describe("3. ByteDance Seedance 2.0 Official API Contract", () => {
    const seedanceHost = "https://ark.cn-beijing.volces.com/api/v3";
    const apiKey = "volc_ark_seedance_key_888";

    it("constructs official task payload with model='seedance-2.0', content array, seed and ratio", async () => {
      const adapter = new SeedanceAdapter({ baseUrl: seedanceHost, apiKey });

      let capturedPayload: any = null;
      nock(seedanceHost)
        .post("/contents/generations/tasks", (body) => {
          capturedPayload = body;
          return true;
        })
        .matchHeader("authorization", `Bearer ${apiKey}`)
        .reply(200, {
          id: "task_seedance_777",
        });

      const spec = {
        shotId: "shot_seedance_01",
        backend: "api_seedance" as const,
        priority: "hero" as const,
        durationSec: 10.0,
        prompt: "Samurai sword duel on a misty mountain bridge",
        aspectRatio: "16:9" as const,
        seed: 999111,
      };

      const { jobId } = await adapter.submitJob(spec);
      expect(jobId).toBe("task_seedance_777");
      expect(capturedPayload.model).toBe("seedance-2.0");
      expect(capturedPayload.content).toEqual([{ type: "text", text: spec.prompt }]);
      expect(capturedPayload.duration).toBe(10);
      expect(capturedPayload.ratio).toBe("16:9");
      expect(capturedPayload.seed).toBe(999111);
    });

    it("polls ByteDance Seedance task status and extracts video URL", async () => {
      const adapter = new SeedanceAdapter({ baseUrl: seedanceHost, apiKey });

      nock(seedanceHost)
        .get("/contents/generations/tasks/task_seedance_777")
        .matchHeader("authorization", `Bearer ${apiKey}`)
        .reply(200, {
          id: "task_seedance_777",
          status: "SUCCEEDED",
          content: {
            video_url: "https://ark-cdn.volces.com/rendered_clip_777.mp4",
            duration: 10.0,
          },
        });

      const status = await adapter.pollStatus("task_seedance_777");
      expect(status.status).toBe("completed");
      expect(status.videoUrl).toBe("https://ark-cdn.volces.com/rendered_clip_777.mp4");
      expect(status.durationSec).toBe(10.0);
    });
  });

  // ── 2. RUNWAY GEN-3 OFFICIAL CONTRACT TESTS ───────────────────────────────
  describe("2. Runway Gen-3 Alpha Turbo Official API Contract", () => {
    const runwayHost = "https://api.dev.runwayml.com";
    const apiKey = "runway_key_67890";

    it("constructs official image_to_video payload with X-Runway-Version, seed, and 768:1280 ratio", async () => {
      const adapter = new RunwayAdapter({ baseUrl: runwayHost, apiKey });

      let capturedPayload: any = null;

      nock(runwayHost)
        .post("/v1/image_to_video", (body) => {
          capturedPayload = body;
          return true;
        })
        .matchHeader("authorization", `Bearer ${apiKey}`)
        .matchHeader("x-runway-version", "2024-09-13")
        .reply(200, {
          id: "runway_task_abc",
        });

      const spec = {
        shotId: "shot_runway_01",
        backend: "api_runway" as const,
        priority: "hero" as const,
        durationSec: 10.0,
        prompt: "Cyberpunk alleyway car chase",
        aspectRatio: "9:16" as const,
        seed: 424242,
        firstFrameCondition: "https://example.com/start_frame.jpg",
      };

      const { jobId } = await adapter.submitJob(spec);
      expect(jobId).toBe("runway_task_abc");

      // Verify official Runway payload
      expect(capturedPayload.promptText).toBe("Cyberpunk alleyway car chase");
      expect(capturedPayload.model).toBe("gen3a_turbo");
      expect(capturedPayload.duration).toBe(10);
      expect(capturedPayload.ratio).toBe("768:1280"); // 9:16 format in Runway Gen-3
      expect(capturedPayload.seed).toBe(424242);
      expect(capturedPayload.promptImage).toBe("https://example.com/start_frame.jpg");
    });

    it("polls Runway task status correctly", async () => {
      const adapter = new RunwayAdapter({ baseUrl: runwayHost, apiKey });

      nock(runwayHost)
        .get("/v1/tasks/task_runway_done")
        .matchHeader("x-runway-version", "2024-09-13")
        .reply(200, {
          id: "task_runway_done",
          status: "SUCCEEDED",
          output: ["https://cdn.runwayml.com/final_clip.mp4"],
          duration: 10.0,
        });

      const status = await adapter.pollStatus("task_runway_done");
      expect(status.status).toBe("completed");
      expect(status.videoUrl).toBe("https://cdn.runwayml.com/final_clip.mp4");
      expect(status.durationSec).toBe(10.0);
    });
  });

  // ── 3. PRE-FLIGHT CAPABILITY VALIDATION TESTS ─────────────────────────────
  describe("3. Pre-flight Capability Validation (Rule 2, 3, 9)", () => {
    it("rejects non-discrete duration on Kling AI before calling API", () => {
      const spec = {
        shotId: "sc1_sh1",
        backend: "api_kling" as const,
        priority: "standard" as const,
        durationSec: 7.5, // Not in [5, 10]
        prompt: "test",
      };

      expect(() =>
        validateSpecAgainstCapabilities(spec, PROVIDER_CAPABILITY_REGISTRY.api_kling)
      ).toThrow(CapabilityMismatchError);
    });

    it("rejects unsupported aspect ratio (1:1) on Runway Gen-3 before calling API", () => {
      const spec = {
        shotId: "sc1_sh1",
        backend: "api_runway" as const,
        priority: "standard" as const,
        durationSec: 5.0,
        aspectRatio: "1:1" as const, // Runway Gen-3 only supports 16:9 and 9:16
        prompt: "test",
      };

      expect(() =>
        validateSpecAgainstCapabilities(spec, PROVIDER_CAPABILITY_REGISTRY.api_runway)
      ).toThrow(CapabilityMismatchError);
    });

    it("rejects unsupported aspect ratio (1:1) on Google Veo 3.1 before calling API", () => {
      const spec = {
        shotId: "sc1_sh_veo",
        backend: "api_veo" as const,
        priority: "hero" as const,
        durationSec: 5.0,
        aspectRatio: "1:1" as const, // Veo 3.1 only supports 16:9 and 9:16
        prompt: "test",
      };

      expect(() =>
        validateSpecAgainstCapabilities(spec, PROVIDER_CAPABILITY_REGISTRY.api_veo)
      ).toThrow(CapabilityMismatchError);
    });

    it("rejects non-discrete duration (7.0s) on ByteDance Seedance 2.0 before calling API", () => {
      const spec = {
        shotId: "sc1_sh_seedance",
        backend: "api_seedance" as const,
        priority: "hero" as const,
        durationSec: 7.0, // Seedance discrete [5, 10]
        prompt: "test",
      };

      expect(() =>
        validateSpecAgainstCapabilities(spec, PROVIDER_CAPABILITY_REGISTRY.api_seedance)
      ).toThrow(CapabilityMismatchError);
    });

    it("strictly rejects passing raw local filesystem paths to remote cloud APIs without encoding", () => {
      const spec = {
        shotId: "sc1_sh1",
        backend: "api_kling" as const,
        priority: "standard" as const,
        durationSec: 5.0,
        referenceImage: "C:\\Users\\local\\secret_image.jpg", // raw local path
        prompt: "test",
      };

      expect(() =>
        validateSpecAgainstCapabilities(spec, PROVIDER_CAPABILITY_REGISTRY.api_kling)
      ).toThrow(CapabilityMismatchError);
    });

    it("throws clear error when local reference image does not exist on disk", async () => {
      await expect(resolveImageToDataUriOrUrl("assets/missing_character_face.jpg")).rejects.toThrow(
        "File ảnh cục bộ không tồn tại"
      );
    });

    it("correctly identifies image protocol categories", () => {
      expect(categorizeImageProtocol("https://cdn.example.com/face.jpg")).toBe("public_url");
      expect(categorizeImageProtocol("http://cdn.example.com/face.jpg")).toBe("public_url");
      expect(categorizeImageProtocol("data:image/png;base64,iVBORw0KGgoAAA==")).toBe("base64_data_uri");
      expect(categorizeImageProtocol("assets/characters/minh.jpg")).toBe("local_path");
    });
  });

  // ── 4. SHOT CHAINING & MEDIA FIXTURE TESTS ────────────────────────────────
  describe("4. Shot Chaining, Last-frame Extraction & Multi-segment Stitching", () => {
    it("decomposes duration taking crossfade overlap into account", () => {
      // Continuous chunking (ComfyUI / Mock)
      // For 8.0s with 5.0s chunks and 0.3s crossfade:
      // Pass 1: 5.0s (delivers 5.0s)
      // Pass 2: remainingNeeded (3.0s) + crossfade (0.3s) = 3.3s
      // Net delivered = 5.0 + 3.3 - 0.3 = 8.0s!
      const decomp = decomposeShotDuration("sc1_sh1", 8.0, { maxChunkSec: 5.0, crossfadeSec: 0.3 });
      expect(decomp.requiresExtension).toBe(true);
      expect(decomp.passes.length).toBe(2);
      expect(decomp.passes[0].durationSec).toBe(5.0);
      expect(decomp.passes[1].durationSec).toBe(3.3);
      expect(decomp.passes[1].conditionFromPass).toBe(1);
    });

    it("decomposes duration for discrete providers (e.g. Kling [5, 10])", () => {
      const decomp = decomposeShotDuration("sc1_sh2", 8.0, {
        allowedDiscreteDurations: [5, 10],
        crossfadeSec: 0.3,
      });

      // Needs at least 8.0s. Pass 1 = 5s (delivers 5s), Pass 2 = 5s (net gain 4.7s) -> Total 9.7s >= 8.0s
      expect(decomp.requiresExtension).toBe(true);
      expect(decomp.passes.length).toBe(2);
      expect(decomp.passes[0].durationSec).toBe(5);
      expect(decomp.passes[1].durationSec).toBe(5);
    });

    it("generates normalized FFmpeg complex filter with scaling, fps, yuv420p and setpts", () => {
      const clipPaths = ["clip1.mp4", "clip2.mp4", "clip3.mp4"];
      const clipDurations = [5.0, 5.0, 5.0];

      const { filterComplex, totalOutputDuration } = buildCrossfadeStitchFilter(clipPaths, clipDurations, {
        crossfadeSec: 0.3,
        targetDurationSec: 14.4,
        fps: 30,
        aspectRatio: "9:16",
      });

      // Check normalization stage
      expect(filterComplex).toContain("scale=720:1280:force_original_aspect_ratio=decrease");
      expect(filterComplex).toContain("fps=30");
      expect(filterComplex).toContain("format=yuv420p");
      expect(filterComplex).toContain("setpts=PTS-STARTPTS");

      // Check crossfade chaining
      expect(filterComplex).toContain("xfade=transition=fade:duration=0.300:offset=4.700");
      expect(filterComplex).toContain("trim=duration=14.400");
      expect(totalOutputDuration).toBe(14.4);
    });

    it("extracts real last frame from an MP4 file and verifies image integrity", async () => {
      const sourceVideo = join(testOutputDir, "source_clip.mp4");
      const outLastFrame = join(testOutputDir, "source_clip_lastframe.jpg");

      // Create a valid binary MP4 file
      await createValidMockMp4File(sourceVideo, 2.0);

      const extractedPath = await extractLastFrame(sourceVideo, outLastFrame);
      expect(existsSync(extractedPath)).toBe(true);
      expect(extractedPath).toBe(outLastFrame);
    });

    it("stitches multi-segment video passes and trims accurately to target duration", async () => {
      const clip1 = join(testOutputDir, "stitch_p1.mp4");
      const clip2 = join(testOutputDir, "stitch_p2.mp4");
      const stitchedOut = join(testOutputDir, "stitched_final.mp4");

      // Create 2 valid binary clips
      await createValidMockMp4File(clip1, 3.0);
      await createValidMockMp4File(clip2, 3.0);

      const actualDurations = [3.0, 3.0];
      const targetDuration = 5.6; // 3.0 + 3.0 - 0.3 = 5.7, trimmed to 5.6

      const result = await stitchPassClips([clip1, clip2], actualDurations, stitchedOut, {
        crossfadeSec: 0.3,
        targetDurationSec: targetDuration,
        fps: 30,
        aspectRatio: "9:16",
      });

      expect(existsSync(result.outputPath)).toBe(true);
      const probe = await probeVideoFile(result.outputPath);
      expect(probe.isValid).toBe(true);
      expect(probe.hasVideo).toBe(true);
      // Tolerance within 0.1s of target duration
      expect(Math.abs(probe.durationSec - targetDuration)).toBeLessThanOrEqual(0.1);
    });

    it("strictly throws error when stitching fails rather than silently taking first segment (Rule 8)", async () => {
      const nonExistentClip = join(testOutputDir, "does_not_exist_clip.mp4");
      const outPath = join(testOutputDir, "fail_output.mp4");

      await expect(
        stitchPassClips([nonExistentClip], [3.0], outPath)
      ).rejects.toThrow("File clip phân đoạn không tồn tại");
    });
  });
});
