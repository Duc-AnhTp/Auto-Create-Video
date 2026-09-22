import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { generateFcp7Xml } from "../assembly/nle-exporter.js";
import { parseNleTimeline } from "../assembly/nle-ingest-parser.js";
import { exportToAss } from "../media/ass-subtitle-builder.js";
import { BibleManager } from "../bible/bible-manager.js";
import { AnalysisReviewQueue } from "../novel/analysis-review-queue.js";
import { ServerlessComfyUIAdapter } from "../gateway/adapters/serverless-comfyui-adapter.js";
import { ComfyUiAdapter } from "../gateway/adapters/comfyui-adapter.js";
import { F5TtsClient } from "../tts/f5tts-client.js";
import { ColorMatcher } from "../media/color-matcher.js";
import { parseRawScreenplay } from "../series/script-normalizer.js";
import type { UnifiedTimeline } from "../series/timeline-schema.js";
import { mkdtempSync, rmSync, existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("15 Code-Review Defect Resolutions and Upgrades Verification", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "audit-qa-"));
  });

  afterEach(() => {
    try {
      if (existsSync(tempDir)) {
        rmSync(tempDir, { recursive: true, force: true });
      }
    } catch {}
  });

  // 1. NLE Exporter audio descriptors
  it("Defect 1: generateFcp7Xml emits samplecharacteristics tags for audio media tracks", () => {
    const timeline: any = {
      seriesId: "series_test",
      episodeNumber: 1,
      targetTotalDurationSec: 10,
      fps: 24,
      videoTrack: [],
      dialogueTrack: [
        {
          dialogueId: "d1",
          speakerName: "Nam",
          audioPath: "dialogue_01.wav",
          startSec: 0,
          durationSec: 5,
        },
      ],
      sfxTrack: [],
      ambienceTrack: [],
      bgmTrack: [],
      subtitleCues: [],
      metadata: { createdAt: new Date().toISOString() },
    };

    const xml = generateFcp7Xml({ timeline });
    expect(xml).toContain("<samplecharacteristics>");
    expect(xml).toContain("<samplerate>48000</samplerate>");
    expect(xml).toContain("<depth>16</depth>");
    expect(xml).toContain("<channelcount>2</channelcount>");
  });

  // 2. NLE Ingest audio rate vs video fps
  it("Defect 2: parseNleTimeline does not let audio sample rate overwrite timeline video fps", () => {
    const otioWithAudioRate = JSON.stringify({
      OTIO_SCHEMA: "Timeline.1",
      tracks: {
        children: [
          {
            kind: "Audio",
            children: [
              {
                source_range: {
                  start_time: { value: 0, rate: 48000 },
                  duration: { value: 480000, rate: 48000 },
                },
                media_reference: { target_url: "audio.wav" },
              },
            ],
          },
          {
            kind: "Video",
            children: [
              {
                source_range: {
                  start_time: { value: 0, rate: 24 },
                  duration: { value: 240, rate: 24 },
                },
                media_reference: { target_url: "shot1.mp4" },
              },
            ],
          },
        ],
      },
    });

    const parsed = parseNleTimeline(otioWithAudioRate, "otio");
    expect(parsed.fps).toBe(24);
    expect(parsed.totalDurationSec).toBe(10);
  });

  // 3. ASS Subtitle Builder Karaoke typography retention
  it("Defect 3: exportToAss retains Karaoke style typography after speaker tag style reset", () => {
    const cues = [
      {
        subtitleId: "sub_1",
        shotId: "shot_1",
        dialogueId: "d1",
        startFrame: 24,
        endFrame: 72,
        startSec: 1.0,
        endSec: 3.0,
        durationSec: 2.0,
        speakerName: "Nam Chính",
        displayText: "Ta sẽ trở lại!",
      },
    ];

    const ass = exportToAss(cues, { style: "karaoke" });
    expect(ass).toContain("{\\rKaraoke}");
    expect(ass).toContain("{\\k");
    expect(ass).toContain("Style: Karaoke");
  });

  // 4. BibleManager seriesId isolation in narrative delta validation
  it("Defect 4: validateNarrativeDelta correctly isolates entity validation by seriesId", () => {
    const dbPath = join(tempDir, "bible.db");
    const bible = new BibleManager(dbPath);

    try {
      bible.upsertCharacter({
        id: "char_hero",
        series_id: "series_alpha",
        name: "Hero Alpha",
        status: "alive",
      });

      const validDelta = {
        characterStatusUpdates: [
          {
            id: "char_hero",
            status: "deceased",
          },
        ],
      };

      const resAlpha = bible.validateNarrativeDelta(validDelta, "series_alpha");
      expect(resAlpha.valid).toBe(true);

      const resBeta = bible.validateNarrativeDelta(validDelta, "series_beta");
      expect(resBeta.valid).toBe(false);
      expect(resBeta.errors[0]).toContain("non-existent character");
    } finally {
      bible.close();
    }
  });

  // 5. Chekhov gun dormancy calculation using last_active_episode
  it("Defect 5: listActiveChekhovGuns accurately calculates dormancy using last_active_episode", () => {
    const dbPath = join(tempDir, "bible.db");
    const bible = new BibleManager(dbPath);

    try {
      bible.plantChekhovGun({
        id: "gun_ancient_sword",
        series_id: "series_s1",
        name: "Thanh Cổ Kiếm",
        type: "prop",
        description: "Bảo kiếm trấn phái",
        planted_at_episode: 1,
        payoff_status: "planted",
      });

      bible.updateChekhovGunActivity("gun_ancient_sword", 3, "active");

      const gunsAtEp4 = bible.listActiveChekhovGuns("series_s1", 4);
      const sword = gunsAtEp4.find((g) => g.id === "gun_ancient_sword");
      expect(sword).toBeDefined();
      expect(sword?.dormant_episodes_count).toBe(1);
      expect(sword?.last_active_episode).toBe(3);
    } finally {
      bible.close();
    }
  });

  // 6. AnalysisReviewQueue seriesId propagation
  it("Defect 6: AnalysisReviewQueue propagates seriesId when auto-persisting approved entities", () => {
    const dbPath = join(tempDir, "bible.db");
    const bible = new BibleManager(dbPath);
    try {
      const queue = new AnalysisReviewQueue(bible);

      queue.enqueue("character", "series_gamma", {
        id: "char_monk",
        name: "Sư Phụ",
        status: "alive",
      }, { confidenceScore: 0.95, autoApproveThreshold: 0.8 });

      const char = bible.getCharacter("char_monk", "series_gamma");
      expect(char).toBeDefined();
      expect(char?.name).toBe("Sư Phụ");
    } finally {
      bible.close();
    }
  });

  // 7. ServerlessComfyUIAdapter retains durationSec and localPath on completion
  it("Defect 7: ServerlessComfyUIAdapter preserves execution spec localPath and durationSec", async () => {
    const adapter = new ServerlessComfyUIAdapter({
      endpoint: "https://api.runpod.ai/v2/mock-endpoint",
      mockFallback: true,
    });

    const mockDestPath = join(tempDir, "dest_shot.mp4");
    const { jobId } = await adapter.submitJob({
      backend: "serverless_comfyui",
      priority: "standard",
      shotId: "shot_101",
      prompt: "cinematic sunset",
      durationSec: 3.5,
      destinationLocalPath: mockDestPath,
    });

    const status = await adapter.pollStatus(jobId);
    expect(status.status).toBe("completed");
    expect(status.durationSec).toBe(3.5);
    expect(status.localPath).toBe(mockDestPath);
  });

  // 8. ComfyUiAdapter Wan 2.1 IP-Adapter node selection
  it("Defect 8: ComfyUiAdapter uses WanIPAdapterApply and WanIPAdapterModelLoader for Wan models", () => {
    const adapter = new ComfyUiAdapter();
    const workflow = adapter.buildPromptWorkflow(
      {
        backend: "local_comfyui",
        priority: "standard",
        shotId: "shot_wan",
        prompt: "A warrior walking in ancient temple",
        durationSec: 2.0,
      },
      undefined,
      "face_ref.png"
    );

    const ipLoaderNode = workflow["13"] as any;
    const ipApplyNode = workflow["14"] as any;
    expect(ipLoaderNode.class_type).toBe("WanIPAdapterModelLoader");
    expect(ipApplyNode.class_type).toBe("WanIPAdapterApply");
    expect(ipLoaderNode.inputs.ipadapter_file).toContain("wan2.1");
  });

  // 9. F5TtsClient custom voice profile resolution
  it("Defect 9: F5TtsClient supports custom voiceProfiles dictionary", async () => {
    const customRefAudio = join(tempDir, "custom_ref.wav");
    writeFileSync(customRefAudio, "RIFF_MOCK_AUDIO_DATA");

    const client = new F5TtsClient({
      endpoint: "http://localhost:50001",
      mockFallback: true,
      voiceProfiles: {
        "character_hero": {
          refAudio: customRefAudio,
          refText: "Ta là anh hùng cứu thế.",
        },
      },
    });

    const outPath = join(tempDir, "tts_hero.mp3");
    await client.generate("Xin chào!", outPath, undefined, {
      voiceProfileId: "character_hero",
    });

    expect(existsSync(outPath)).toBe(true);
  });

  // 10. Vietnamese phonetic normalization in script normalizer
  it("Defect 10: parseRawScreenplay parses acting instruction and leaves ttsText undefined for phonetic normalization", () => {
    const rawScreenplay = {
      title: "Tập 1",
      scenes: [
        {
          sceneNumber: 1,
          shots: [
            {
              shotId: "sc01_sh01",
              dialogues: [
                {
                  subtitleText: "[hồi hộp] Chúng ta có 100 ngày để hoàn thành dự án!",
                },
              ],
            },
          ],
        },
      ],
    };

    const normalized = parseRawScreenplay(JSON.stringify(rawScreenplay));
    const dlg = normalized.scenes[0].shots[0].dialogues[0];
    expect(dlg.actingInstruction).toBe("hồi hộp");
    expect(dlg.text).toBe("Chúng ta có 100 ngày để hoàn thành dự án!");
    expect(dlg.subtitleText).toBe("Chúng ta có 100 ngày để hoàn thành dự án!");
    expect(dlg.ttsText).toBeUndefined(); // Allows enrichWithBibleContext to apply phonetic normalization
  });

  // 11. ColorMatcher built-in LUT curves
  it("Defect 11: ColorMatcher recognizes built-in cinematic filter curves", () => {
    const filterKodak = ColorMatcher.buildShotColorFilter("sh1", "sc1", 0, {
      lutPreset: "kodak_2383",
    });
    expect(filterKodak).toContain("colorbalance=");
    expect(filterKodak).toContain("rs=0.08");

    const filterTeal = ColorMatcher.buildShotColorFilter("sh1", "sc1", 0, {
      lutPreset: "teal_orange",
    });
    expect(filterTeal).toContain("colorbalance=");
    expect(filterTeal).toContain("bs=-0.15");
  });
});
