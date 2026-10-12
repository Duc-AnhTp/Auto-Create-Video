import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { EmotionalVoiceController } from "./audio/emotional-voice-controller.js";
import { VisemeAligner } from "./audio/viseme-aligner.js";
import { LipSyncEngine } from "./lip-sync-engine.js";
import { createValidMockMp4File } from "./assets/mock-media-generator.js";

describe("Option 1: Neural Emotional Dialogue & Lip-Sync Alignment", () => {
  const testOutputDir = join("data", "test_lipsync_output");

  beforeEach(async () => {
    // Clean directory
    if (existsSync(testOutputDir)) {
      await rm(testOutputDir, { recursive: true, force: true }).catch(() => {});
    }
  });

  afterEach(async () => {
    if (existsSync(testOutputDir)) {
      await rm(testOutputDir, { recursive: true, force: true }).catch(() => {});
    }
  });

  describe("1. EmotionalVoiceController: SSML & Voice Inflection", () => {
    it("should infer whisper emotion and generate breathy prosody settings", () => {
      const settings = EmotionalVoiceController.generateSettings(
        "Suỵt... cẩn thận, chúng ta không được để chúng phát hiện.",
        {
          characterName: "Lan",
          explicitActingInstruction: "Thì thầm nhỏ nhẹ",
          sceneTensionScore: 0.35,
        }
      );

      expect(settings.emotion).toBe("whisper");
      expect(settings.volumeDb).toBeLessThan(0);
      expect(settings.breathiness).toBeGreaterThanOrEqual(0.7);
      expect(settings.ssmlText).toContain("<prosody");
      expect(settings.ssmlText).toContain('volume="-6dB"');
      expect(settings.ssmlText).toContain("<break time=");
      expect(settings.actingPrompt).toContain("Thì thầm");
    });

    it("should infer furious shout for climax tension with exclamation", () => {
      const settings = EmotionalVoiceController.generateSettings(
        "TẤT CẢ TẤN CÔNG! CHÚNG TA KHÔNG BAO GIỜ ĐẦU HÀNG!",
        {
          characterName: "Minh",
          sceneTensionScore: 0.95,
        }
      );

      expect(settings.emotion).toBe("furious_shout");
      expect(settings.volumeDb).toBe(6.0);
      expect(settings.rate).toBeGreaterThan(1.1);
      expect(settings.pitch).toBeGreaterThan(0);
      expect(settings.elevenLabsSettings?.style).toBeGreaterThanOrEqual(0.85); // High style exaggeration
      expect(settings.ssmlText).toContain('volume="+6dB"');
    });

    it("should infer terrified emotion when character is panicked or explicitly marked", () => {
      const settings = EmotionalVoiceController.generateSettings(
        "Đừng lại gần... xin đừng làm tổn thương tôi...",
        {
          characterName: "Dân làng",
          explicitActingInstruction: "Sợ hãi run rẩy",
          sceneTensionScore: 0.8,
        }
      );

      expect(settings.emotion).toBe("terrified");
      expect(settings.tremorIntensity).toBeGreaterThan(0.5);
      expect(settings.elevenLabsSettings?.stability).toBeLessThan(0.5); // Low stability produces vocal trembling
    });
  });

  describe("2. VisemeAligner: MPEG-4 Phoneme-to-Viseme Sequence & Blendshapes", () => {
    it("should map Vietnamese characters to appropriate standard visemes", () => {
      expect(VisemeAligner.mapCharToViseme("a")).toBe("aa");
      expect(VisemeAligner.mapCharToViseme("ắ")).toBe("aa");
      expect(VisemeAligner.mapCharToViseme("e")).toBe("E");
      expect(VisemeAligner.mapCharToViseme("i")).toBe("I");
      expect(VisemeAligner.mapCharToViseme("o")).toBe("O");
      expect(VisemeAligner.mapCharToViseme("u")).toBe("U");

      expect(VisemeAligner.mapCharToViseme("p")).toBe("PP");
      expect(VisemeAligner.mapCharToViseme("b")).toBe("PP");
      expect(VisemeAligner.mapCharToViseme("m")).toBe("PP");
      expect(VisemeAligner.mapCharToViseme("f")).toBe("FF");
      expect(VisemeAligner.mapCharToViseme("t")).toBe("DD");
      expect(VisemeAligner.mapCharToViseme("d")).toBe("DD");
      expect(VisemeAligner.mapCharToViseme("k")).toBe("kk");
      expect(VisemeAligner.mapCharToViseme(" ")).toBe("sil");
    });

    it("should align dialogue text into timed keyframes and frame-by-frame blendshapes", () => {
      const text = "Tôi không tin điều đó.";
      const duration = 2.5;
      const fps = 24;

      const alignment = VisemeAligner.alignTextToDuration(text, duration, fps);
      expect(alignment.totalDurationSec).toBe(duration);
      expect(alignment.fps).toBe(fps);
      expect(alignment.totalFrames).toBe(60); // 2.5 * 24

      // Must have keyframes and frames
      expect(alignment.keyframes.length).toBeGreaterThan(0);
      expect(alignment.frames.length).toBe(60);

      // Verify first frame starts with silence / neutral
      const firstKf = alignment.keyframes[0];
      expect(firstKf.startSec).toBe(0);

      // Verify morph targets exist on frames
      const midFrame = alignment.frames[25];
      expect(midFrame.jawOpen).toBeGreaterThanOrEqual(0.0);
      expect(midFrame.jawOpen).toBeLessThanOrEqual(1.0);
      expect(midFrame.mouthClose).toBeGreaterThanOrEqual(0.0);
      expect(midFrame.mouthClose).toBeLessThanOrEqual(1.0);
    });
  });

  describe("3. LipSyncEngine: Automated Video-Audio Face Synchronization", () => {
  it("should generate a mock lip-sync artifact without claiming verified alignment", async () => {
      const inputVideo = join(testOutputDir, "raw_shot.mp4");
      const inputAudio = join(testOutputDir, "dialogue.wav");
      const outputVideo = join(testOutputDir, "lipsynced_shot.mp4");

      // Create dummy source video
      await createValidMockMp4File(inputVideo, 3);

      const dialogue = "Đây là trận chiến cuối cùng của chúng ta!";
      const result = await LipSyncEngine.alignLipSync(
        inputVideo,
        inputAudio,
        dialogue,
        outputVideo,
        {
          provider: "mock",
          fps: 24,
          featheringRadiusPx: 16,
          audioOffsetMs: 5.0,
        }
      );

      expect(result.success).toBe(true);
      expect(result.providerUsed).toBe("mock");
      expect(existsSync(outputVideo)).toBe(true);
      expect(existsSync(result.manifestPath)).toBe(true);

      // Verify A/V sync offset error is within broadcast standard (±40ms)
      expect(Math.abs(result.avSyncOffsetMs)).toBeLessThan(40.0);
      expect(result.isMock).toBe(true);
      expect(result.syncConfidenceScore).toBe(0);

      // Verify mouth ROI
      expect(result.mouthRoi.width).toBeGreaterThan(0.2);
      expect(result.mouthRoi.height).toBeGreaterThan(0.2);
      expect(result.mouthRoi.featherRadiusPx).toBe(16);

      // Verify viseme sequence generated
      expect(result.visemeAlignment.keyframes.length).toBeGreaterThan(0);
    });
  });
});
