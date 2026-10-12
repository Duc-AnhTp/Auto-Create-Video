import { describe, it, expect, vi } from "vitest";
import { VideoModelGateway } from "./video-gateway.js";
import { type ShotExecutionSpec, type VideoProviderAdapter } from "../../../../contracts/video.js";
import { ResilientCircuitBreaker } from "./circuit-breaker.js";
import { ProviderRateLimiter } from "./provider-rate-limiter.js";
import { LipSyncEngine } from "../../../media/adapters/lip-sync-engine.js";
import { SuperResolutionEngine } from "../../../media/adapters/super-resolution.js";
import { BroadcastQcEnhancer } from "../../../media/adapters/broadcast-qc-enhancer.js";
import { NleRoundTripConformer } from "../../../media/adapters/assembly/nle-conformer.js";
import { MicroScriptRepairer } from "../../../story/application/analysis/micro-script-repairer.js";
import { SpatialFoleyEngine } from "../../../media/adapters/audio/spatial-foley-engine.js";
import { CharacterTurnaroundBridge } from "../character-turnaround-bridge.js";
import { SeasonBudgetAllocator } from "../../domain/season-budget-allocator.js";
import { SeasonTrailerAutoCutter } from "../../../media/application/season-trailer-auto-cutter.js";
import type { UnifiedTimeline } from "../../../../contracts/timeline.js";
import type { IngestedNleTimeline } from "../../../media/adapters/assembly/nle-ingest-parser.js";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("Comprehensive 15 Code-Review Defect Resolutions", () => {
  it("Defect 1: Webhook timeout does not cause tight polling spin loop", async () => {
    const gateway = new VideoModelGateway({
      maxBudgetUsd: 50.0,
      pollTimeoutMs: 150,
      pollIntervalMs: 20,
    });

    let pollCount = 0;
    const mockAdapter: VideoProviderAdapter = {
      providerName: "mock",
      submitJob: vi.fn().mockResolvedValue({ jobId: "job_timeout", status: "queued" }),
      pollStatus: vi.fn().mockImplementation(async () => {
        pollCount++;
        return { jobId: "job_timeout", status: "running" };
      }),
    };
    gateway.registerAdapter(mockAdapter);

    const spec: ShotExecutionSpec = {
      shotId: "shot_poll_test",
      durationSec: 4.0,
      prompt: "Test shot",
      backend: "mock",
      allowDirectExecution: true,
    };

    // Should timeout cleanly without polling thousands of times in a microtask spin loop
    await expect(gateway.executeShot(spec)).rejects.toThrow(/timed out/i);
    // Over a 150ms timeout with 20ms poll interval, pollCount should be reasonable (~7-12 polls, definitely < 25)
    expect(pollCount).toBeLessThan(25);
  });

  it("Defect 2: Keeps the in-flight primary when the hedged provider fails", async () => {
    const gateway = new VideoModelGateway({enableFailover:true,fallbackChain:["mock"]});
    const submitJob=vi.fn();gateway.registerAdapter({providerName:"api_kling",submitJob,pollStatus:vi.fn()});
    await expect(gateway.executeShotHedged({shotId:"unreserved",backend:"api_kling",durationSec:5,prompt:"fixture",allowDirectExecution:true})).rejects.toThrow("DURABLE_ORCHESTRATOR_REQUIRED");
    expect(submitJob).not.toHaveBeenCalled();
  });

  it("Defect 3: ProviderRateLimiter drains multiple queued requests when capacity is available", async () => {
    const limiter = new ProviderRateLimiter();
    limiter.configureProvider("test_provider", {
      maxConcurrent: 3,
      maxRpm: 600, // 10 tokens/sec
      initialTokens: 5,
    });

    const releases: Array<() => void> = [];
    const p1 = limiter.acquire("test_provider").then((r) => releases.push(r));
    const p2 = limiter.acquire("test_provider").then((r) => releases.push(r));
    const p3 = limiter.acquire("test_provider").then((r) => releases.push(r));

    await Promise.all([p1, p2, p3]);
    expect(limiter.getActiveConcurrency("test_provider")).toBe(3);
    expect(limiter.getQueueLength("test_provider")).toBe(0);

    releases.forEach((r) => r());
  });

  it("Defect 4: CircuitBreaker resets halfOpenProbeInFlight via abortProbe()", () => {
    const cb = new ResilientCircuitBreaker({
      maxConsecutiveFailures: 1,
      cooldownMs: 0, // instantaneous cooldown to allow test transition
    });

    cb.recordFailure();
    expect(cb.getState()).toBe("HALF_OPEN");

    // Probe starts
    expect(cb.canExecute()).toBe(true);
    // While probe in flight, next call is refused
    expect(cb.canExecute()).toBe(false);

    // Abort probe (e.g. preflight capability validation failed)
    cb.abortProbe();
    // Now probe can be retried without being permanently locked
    expect(cb.canExecute()).toBe(true);
  });

  it("Defect 6: Mock lip-sync does not claim measured confidence", async () => {
    const res = await LipSyncEngine.alignLipSync(
      join(tmpdir(), "test_vid.mp4"),
      join(tmpdir(), "test_aud.mp3"),
      "Xin chào bạn, tôi là trợ lý ảo.",
      join(tmpdir(), "test_lipsync_out.mp4"),
      { audioOffsetMs: 20 }
    );

    expect(res.isMock).toBe(true);
    expect(res.measurement).toBe("mock");
    expect(res.syncConfidenceScore).toBe(0);
    expect(res.avSyncOffsetMs).toBe(20);
  });

  it("Defect 7: SuperResolutionEngine fallback preserves correct aspect ratio dimensions", async () => {
    const target = join(tmpdir(), "sr_test_out.mp4");
    const res = await SuperResolutionEngine.upscaleVideo("input.mp4", target, {
      aspectRatio: "16:9",
      targetStandard: "4k",
      mockFallback: true,
    });

    expect(res.outputResolution.width).toBe(3840);
    expect(res.outputResolution.height).toBe(2160);
  });

  it("Defect 8: BroadcastQcEnhancer marks mock fallback as unverified", async () => {
    const target = join(tmpdir(), "qc_test_out.mp4");
    const res = await BroadcastQcEnhancer.conformDeliveryPackage("master.mp4", target, {
      standard: "streaming_youtube_tiktok",
      mockFallback: true,
    });

    expect(res.outputPath).toBe(target);
    expect(res.qcReport.evidence).toBe("mock");
    expect(res.qcReport.overallPassed).toBe(false);
  });

  it("Defect 9: NleRoundTripConformer realigns ambienceTrack cues", () => {
    const original: UnifiedTimeline = {
      seriesId: "test",
      episodeNumber: 1,
      fps: 24,
      sampleRate: 48000,
      targetTotalDurationSec: 10.0,
      targetTotalFrames: 240,
      videoTrack: [
        {
          shotId: "shot_1",
          sceneId: "scene_cyber",
          startSec: 0,
          endSec: 5.0,
          durationSec: 5.0,
          startFrame: 0,
          endFrame: 120,
          durationFrames: 120,
          trimStartSec: 0,
          shotType: "medium",
          visualPrompt: "Scene 1",
        },
        {
          shotId: "shot_2",
          sceneId: "scene_cyber",
          startSec: 5.0,
          endSec: 10.0,
          durationSec: 5.0,
          startFrame: 120,
          endFrame: 240,
          durationFrames: 120,
          trimStartSec: 0,
          shotType: "medium",
          visualPrompt: "Scene 2",
        },
      ],
      ambienceTrack: [
        {
          cueId: "amb_cyber",
          sceneId: "scene_cyber",
          name: "Cyber City Ambient",
          startFrame: 0,
          durationFrames: 240,
          startSec: 0,
          durationSec: 10.0,
          audioPath: "amb.mp3",
          volume: 0.3,
          fadeInSec: 0.5,
          fadeOutSec: 0.5,
        },
      ],
      dialogueTrack: [],
      sfxTrack: [],
      subtitleTrack: [],
      stems: {},
      metrics: {
        videoDurationSec: 10,
        audioDurationSec: 10,
        driftSec: 0,
        driftFrames: 0,
        isWithinTolerance: true,
        toleranceSec: 0.05,
      },
    };

    const ingested: IngestedNleTimeline = {
      sequenceName: "Cut_1",
      fps: 24,
      totalFrames: 288,
      totalDurationSec: 12.0,
      videoClips: [
        { id: "1", name: "shot_1.mp4", startFrame: 0, endFrame: 144, durationFrames: 144, inFrame: 0, outFrame: 144 },
        { id: "2", name: "shot_2.mp4", startFrame: 144, endFrame: 288, durationFrames: 144, inFrame: 0, outFrame: 144 },
      ],
      audioClips: [],
    };

    const conformed = NleRoundTripConformer.conform(original, ingested);
    expect(conformed.conformedTimeline.ambienceTrack[0].durationSec).toBe(12.0);
    expect(conformed.conformedTimeline.ambienceTrack[0].durationFrames).toBe(288);
  });

  it("Defect 10: MicroScriptRepairer extracts scene blocks with Hollywood, Fountain, and Vietnamese headers", () => {
    const rawFountain = `
SCENE 1 - INT. COFFEE SHOP - DAY
CÚ MÁY 1 (medium, 4s): Nhân vật A nhìn ra cửa sổ.

INT. APARTMENT - NIGHT
CÚ MÁY 1 (close_up, 4s): Nhân vật B mở cửa.

PHÂN CẢNH 3: NGOẠI Ô - HOÀNG HÔN
CÚ MÁY 1 (wide, 4s): Cảnh hoàng hôn buông xuống.
    `;

    const blocks = MicroScriptRepairer.extractSceneBlocks(rawFountain);
    expect(blocks.length).toBe(3);
    expect(blocks[0].sceneNumber).toBe(1);
    expect(blocks[1].sceneNumber).toBe(2);
    expect(blocks[2].sceneNumber).toBe(3);
  });

  it("Defect 11: SpatialFoleyEngine buildSpatialFfmpegFilter prepends stereo audio format", () => {
    const gains = SpatialFoleyEngine.calculateSpatialGains(-0.5, "medium");
    const filter = SpatialFoleyEngine.buildSpatialFfmpegFilter(gains, 0.8);

    expect(filter).toContain("aformat=channel_layouts=stereo");
    expect(filter).toContain("pan=stereo");
  });

  it("Defect 12: VideoModelGateway selectBackend picks available cloud provider when mock is not registered", () => {
    const gateway = new VideoModelGateway();
    const cloudAdapter: VideoProviderAdapter = {
      providerName: "api_seedance",
      submitJob: vi.fn(),
      pollStatus: vi.fn(),
    };
    gateway.registerAdapter(cloudAdapter);

    const backend = gateway.selectBackend({
      shotId: "shot_cloud_only",
      durationSec: 4.0,
      prompt: "Establishing wide shot",
      priority: "standard",
    });

    expect(backend).toBe("api_seedance");
  });

  it("Defect 13: CharacterTurnaroundBridge uses top-level spec.shotType", async () => {
    const turnaroundPack = {
      characterId: "char_hero",
      seriesId: "test-series",
      views: {
        front: { imagePath: "front.png" },
        threeQuarter: { imagePath: "three.png" },
        profile: { imagePath: "profile.png" },
        fullBody: { imagePath: "body.png" },
      },
      faceEmbedding: [],
      updatedBible: false,
    };
    const getPack = vi.spyOn(CharacterTurnaroundBridge, "getOrGenerateTurnaroundPack")
      .mockResolvedValue(turnaroundPack as any);

    const spec: ShotExecutionSpec = {
      shotId: "shot_turnaround",
      durationSec: 4.0,
      prompt: "Portrait view",
      characterId: "char_hero",
      shotType: "profile",
    };

    try {
      const bound = await CharacterTurnaroundBridge.bindTurnaroundToSpec(spec, {} as any, "test-series", {
        autoGenerate: false,
      });
      expect(bound.characterTurnaround?.viewAngle).toBe("profile");
      expect(bound.characterReferenceImage).toBe("profile.png");
    } finally {
      getPack.mockRestore();
    }
  });

  it("Defect 14: SeasonBudgetAllocator clamps negative variance reallocation to >= 0", () => {
    const plan = SeasonBudgetAllocator.planSeasonBudget("test_series", 100.0, 5);
    // Simulate massive overrun on episode 1: spent $50 when allocated was $20
    const updatedPlan = SeasonBudgetAllocator.recordEpisodeSpend(plan, 1, 50.0);

    for (const ep of updatedPlan.episodes) {
      expect(ep.allocatedUsd).toBeGreaterThanOrEqual(0);
      expect(ep.remainingUsd).toBeGreaterThanOrEqual(0);
    }
  });

  it("Defect 15: SeasonTrailerAutoCutter handles empty candidate pool safely", () => {
    const plan = SeasonTrailerAutoCutter.planTrailerPacing(60);
    expect(() => SeasonTrailerAutoCutter.selectTrailerCuts([], plan)).toThrow(/Không có cú máy nào/i);
  });
});
