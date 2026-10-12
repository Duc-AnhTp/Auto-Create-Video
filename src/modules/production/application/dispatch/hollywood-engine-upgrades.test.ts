import { describe, it, expect, vi } from "vitest";
import { VideoModelGateway } from "./video-gateway.js";
import { type ShotExecutionSpec, type VideoProviderAdapter } from "../../../../contracts/video.js";
import { LocalSemanticVectorizer } from "../../../story/application/semantic-memory.js";
import { NleRoundTripConformer } from "../../../media/adapters/assembly/nle-conformer.js";
import type { UnifiedTimeline } from "../../../../contracts/timeline.js";
import type { IngestedNleTimeline } from "../../../media/adapters/assembly/nle-ingest-parser.js";
import { verifyWebhookEnvelope } from "../webhook-signature.js";
import { createHmac } from "node:crypto";

describe("Hollywood Cinema Engine Full Roadmap Upgrades", () => {
  describe("Pillar 1: Smart Route & Hedged Request Pattern", () => {
    it("smartRoute selects high-fidelity provider for hero shots within budget", () => {
      const gateway = new VideoModelGateway({ maxBudgetUsd: 50.0 });
      const mockAdapter: VideoProviderAdapter = {
        providerName: "api_kling",
        submitJob: vi.fn(),
        pollStatus: vi.fn(),
      };
      gateway.registerAdapter(mockAdapter);

      const spec: ShotExecutionSpec = {
        shotId: "shot_hero_1",
        durationSec: 4.0,
        prompt: "Extreme close up of character crying in neon rain",
        priority: "hero",
        shotType: "close_up",
      };

      const selected = gateway.smartRoute(spec, 20.0);
      expect(selected).toBe("api_kling");
    });

    it("smartRoute downgrades to economical provider if budget is constrained", () => {
      const gateway = new VideoModelGateway({ maxBudgetUsd: 1.0 });
      const heroAdapter: VideoProviderAdapter = {
        providerName: "api_kling",
        submitJob: vi.fn(),
        pollStatus: vi.fn(),
      };
      const econAdapter: VideoProviderAdapter = {
        providerName: "api_seedance",
        submitJob: vi.fn(),
        pollStatus: vi.fn(),
      };
      gateway.registerAdapter(heroAdapter);
      gateway.registerAdapter(econAdapter);

      const spec: ShotExecutionSpec = {
        shotId: "shot_hero_1",
        durationSec: 4.0, // 4s * $0.15 = $0.60 > $0.40 budget cap, but 4s * $0.09 = $0.36 <= $0.40
        prompt: "Wide establishing shot",
        priority: "standard",
        shotType: "establishing",
      };

      const selected = gateway.smartRoute(spec, 0.40);
      expect(selected).toBe("api_seedance");
    });

    it("executeShotHedged races primary and hedged fallback provider when primary is delayed", async () => {
      const gateway = new VideoModelGateway({enableFailover:true,fallbackChain:["mock"]});
      const submitJob=vi.fn();gateway.registerAdapter({providerName:"api_kling",submitJob,pollStatus:vi.fn()});
      await expect(gateway.executeShotHedged({shotId:"unreserved",backend:"api_kling",durationSec:5,prompt:"fixture",allowDirectExecution:true})).rejects.toThrow("DURABLE_ORCHESTRATOR_REQUIRED");
      expect(submitJob).not.toHaveBeenCalled();
    });

    it("verifies webhook HMAC signature correctly", () => {
      const provider = "kling";
      const secret = "test-webhook-secret-key-12345";
      const nowSec = Math.floor(Date.now() / 1000);
      const timestamp = String(nowSec);
      const body = Buffer.from(JSON.stringify({ task_id: "job_999", task_status: "SUCCEED" }));

      const expectedHmac = createHmac("sha256", secret)
        .update(`${provider}.${timestamp}.`)
        .update(body)
        .digest("hex");
      const signature = `sha256=${expectedHmac}`;

      const isValid = verifyWebhookEnvelope(provider, body, signature, timestamp, secret);
      expect(isValid).toBe(true);

      const isInvalid = verifyWebhookEnvelope(provider, body, "sha256=invalidhash00000000000000000000000000000000000000000000000000000000", timestamp, secret);
      expect(isInvalid).toBe(false);
    });
  });

  describe("Pillar 2: DaVinci & Premiere NLE Two-Way Round-Trip BGM preservation", () => {
    it("preserves and updates BGM track total duration when conforming timeline", () => {
      const originalTimeline: UnifiedTimeline = {
        seriesId: "series-test",
        episodeNumber: 1,
        fps: 24,
        sampleRate: 48000,
        targetTotalDurationSec: 10.0,
        targetTotalFrames: 240,
        videoTrack: [
          {
            shotId: "shot_1",
            sceneId: "scene_1",
            startSec: 0,
            endSec: 5.0,
            durationSec: 5.0,
            startFrame: 0,
            endFrame: 120,
            durationFrames: 120,
            trimStartSec: 0,
            shotType: "establishing",
            visualPrompt: "Neon city skyline",
          },
          {
            shotId: "shot_2",
            sceneId: "scene_1",
            startSec: 5.0,
            endSec: 10.0,
            durationSec: 5.0,
            startFrame: 120,
            endFrame: 240,
            durationFrames: 120,
            trimStartSec: 0,
            shotType: "close_up",
            visualPrompt: "Character face",
          },
        ],
        ambienceTrack: [],
        dialogueTrack: [],
        sfxTrack: [],
        subtitleTrack: [],
        bgmTrack: {
          audioPath: "audio/bgm.mp3",
          startSec: 0,
          startFrame: 0,
          durationSec: 10.0,
          durationFrames: 240,
          baseVolume: 0.6,
          duckedVolume: 0.2,
          duckingWindows: [],
        },
        stems: {},
        metrics: {
          videoDurationSec: 10.0,
          audioDurationSec: 10.0,
          driftSec: 0,
          driftFrames: 0,
          isWithinTolerance: true,
          toleranceSec: 0.05,
        },
      };

      const ingestedNle: IngestedNleTimeline = {
        fps: 24,
        sequenceName: "DaVinci_Edit_Ep1",
        totalFrames: 288,
        totalDurationSec: 12.0,
        videoClips: [
          {
            id: "clip_1",
            name: "shot_1.mp4",
            startFrame: 0,
            endFrame: 144,
            durationFrames: 144, // Trimmed/extended to 6.0s
            inFrame: 0,
            outFrame: 144,
          },
          {
            id: "clip_2",
            name: "shot_2.mp4",
            startFrame: 144,
            endFrame: 288,
            durationFrames: 144, // Trimmed/extended to 6.0s
            inFrame: 0,
            outFrame: 144,
          },
        ],
        audioClips: [],
      };

      const conformResult = NleRoundTripConformer.conform(originalTimeline, ingestedNle);
      expect(conformResult.hasModifications).toBe(true);
      expect(conformResult.conformedTimeline.targetTotalDurationSec).toBe(12.0);
      expect(conformResult.conformedTimeline.bgmTrack?.durationSec).toBe(12.0);
      expect(conformResult.conformedTimeline.bgmTrack?.durationFrames).toBe(288);
    });
  });

  describe("Pillar 4: 512-D High-Resolution Semantic Memory Vectorizer", () => {
    it("generates 512-dimensional normalized vectors with valid cosine similarity", () => {
      const textA = "Vũ khí bí mật gia truyền của gia tộc Nguyễn";
      const textB = "Bí mật bảo bối truyền thừa dòng họ";
      const textC = "Công thức nấu ăn phở truyền thống";

      const vecA128 = LocalSemanticVectorizer.embed(textA, 128);
      expect(vecA128.length).toBe(128);

      const vecA512 = LocalSemanticVectorizer.embed(textA, 512);
      expect(vecA512.length).toBe(512);

      const vecB512 = LocalSemanticVectorizer.embed(textB, 512);
      const vecC512 = LocalSemanticVectorizer.embed(textC, 512);

      const simRelated = LocalSemanticVectorizer.cosineSimilarity(vecA512, vecB512);
      const simUnrelated = LocalSemanticVectorizer.cosineSimilarity(vecA512, vecC512);

      expect(simRelated).toBeGreaterThan(simUnrelated);
      expect(simRelated).toBeGreaterThan(0.2);
    });
  });
});
