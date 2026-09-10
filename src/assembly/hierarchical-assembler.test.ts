import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, unlinkSync } from "node:fs";
import { rm, mkdir, writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  HierarchicalFilmAssembler,
  computeSceneContentHash,
  buildSceneStitchFilter,
  type SceneAssemblyInput,
} from "./hierarchical-assembler.js";
import {
  generateFcp7Xml,
  generateOtioJson,
  exportNleTimelines,
} from "./nle-exporter.js";
import {
  verifyAssemblyQa,
  parseBlackdetectStderr,
} from "./qa-verifier.js";
import { AssemblyManifestSchema } from "./manifest-schema.js";
import {
  createValidMockMp4File,
  createValidMockMp3File,
} from "../assets/mock-media-generator.js";
import type {
  TimelineDialogueCue,
  TimelineSfxCue,
  TimelineAmbienceCue,
  TimelineBgmCue,
  TimelineSubtitleCue,
  UnifiedTimeline,
} from "../series/timeline-schema.js";

describe("Hierarchical Film Assembler & Delivery Package Acceptance Tests", () => {
  const testDir = join("output", "test-assembly-engine");
  const testClipsDir = join(testDir, "test-clips");

  beforeEach(async () => {
    if (existsSync(testDir)) {
      try {
        await rm(testDir, { recursive: true, force: true });
      } catch {}
    }
    await mkdir(testClipsDir, { recursive: true });
  });

  afterEach(async () => {
    if (existsSync(testDir)) {
      try {
        await rm(testDir, { recursive: true, force: true });
      } catch {}
    }
  });

  describe("1. Phân biệt Rõ Ràng Cut vs. Transition & Trim Khung Hình", () => {
    it("builds clean direct-cut concat filter when no transitions are specified, preventing accidental crossfades", () => {
      const shots = [
        {
          shotId: "sc1_sh1",
          sceneId: "scene_1",
          takeId: "sc1_sh1_take1",
          sourceClipPath: "clip1.mp4",
          trimStartSec: 0,
        },
        {
          shotId: "sc1_sh2",
          sceneId: "scene_1",
          takeId: "sc1_sh2_take1",
          sourceClipPath: "clip2.mp4",
          trimStartSec: 1.0,
          trimEndSec: 3.5,
        },
      ];

      const filter = buildSceneStitchFilter(shots, [4.0, 4.0], {
        width: 720,
        height: 1280,
        fps: 30,
      });

      // Must use direct concat filter, NEVER xfade!
      expect(filter.filterComplex).toContain("concat=n=2:v=1:a=0[vout]");
      expect(filter.filterComplex).not.toContain("xfade");

      // Shot 2 must have trim filter applied
      expect(filter.filterComplex).toContain("trim=start=1.000:end=3.500");
    });

    it("applies crossfade transition ONLY when explicitly requested with durationSec > 0", () => {
      const shots = [
        {
          shotId: "sc1_sh1",
          sceneId: "scene_1",
          takeId: "sc1_sh1_take1",
          sourceClipPath: "clip1.mp4",
          transitionOut: { type: "crossfade" as const, durationSec: 0.5 },
        },
        {
          shotId: "sc1_sh2",
          sceneId: "scene_1",
          takeId: "sc1_sh2_take1",
          sourceClipPath: "clip2.mp4",
        },
      ];

      const filter = buildSceneStitchFilter(shots, [4.0, 4.0], {
        width: 720,
        height: 1280,
        fps: 30,
      });

      expect(filter.filterComplex).toContain("xfade=transition=fade:duration=0.500");
    });
  });

  describe("2. Dựng Phân Cấp (Hierarchical Assembly) & Scene Content Hash Caching", () => {
    it("computes deterministic SHA-256 scene content hash and invalidates when takeId or trim changes", () => {
      const sceneA: SceneAssemblyInput = {
        sceneNumber: 1,
        sceneId: "sc01",
        shots: [
          {
            shotId: "sc1_sh1",
            sceneId: "sc01",
            takeId: "take_01",
            sourceClipPath: "shots/sc1_sh1_v1.mp4",
            trimStartSec: 0,
          },
        ],
      };

      const hash1 = computeSceneContentHash(sceneA);
      const hash2 = computeSceneContentHash(sceneA);
      expect(hash1).toBe(hash2);
      expect(hash1).toHaveLength(64); // SHA-256 hex length

      // Invalidate by changing approved take ID
      const sceneB: SceneAssemblyInput = {
        ...sceneA,
        shots: [
          {
            ...sceneA.shots[0],
            takeId: "take_02_rerolled",
          },
        ],
      };
      const hashB = computeSceneContentHash(sceneB);
      expect(hashB).not.toBe(hash1);

      // Invalidate by changing trim
      const sceneC: SceneAssemblyInput = {
        ...sceneA,
        shots: [
          {
            ...sceneA.shots[0],
            trimStartSec: 0.5,
          },
        ],
      };
      const hashC = computeSceneContentHash(sceneC);
      expect(hashC).not.toBe(hash1);
    });

    it("assembles scenes hierarchically and reuses cached scenes on subsequent runs", async () => {
      // 1. Create valid mock MP4 files for 3 shots across 2 scenes
      const clip1 = join(testClipsDir, "sc1_sh1_take1.mp4");
      const clip2 = join(testClipsDir, "sc1_sh2_take1.mp4");
      const clip3 = join(testClipsDir, "sc2_sh1_take1.mp4");

      await createValidMockMp4File(clip1, 3.0);
      await createValidMockMp4File(clip2, 3.0);
      await createValidMockMp4File(clip3, 4.0);

      const scenes: SceneAssemblyInput[] = [
        {
          sceneNumber: 1,
          sceneId: "scene_01",
          shots: [
            {
              shotId: "sc1_sh1",
              sceneId: "scene_01",
              takeId: "sc1_sh1_take1",
              sourceClipPath: clip1,
              rawDurationSec: 3.0,
            },
            {
              shotId: "sc1_sh2",
              sceneId: "scene_01",
              takeId: "sc1_sh2_take1",
              sourceClipPath: clip2,
              rawDurationSec: 3.0,
            },
          ],
        },
        {
          sceneNumber: 2,
          sceneId: "scene_02",
          shots: [
            {
              shotId: "sc2_sh1",
              sceneId: "scene_02",
              takeId: "sc2_sh1_take1",
              sourceClipPath: clip3,
              rawDurationSec: 4.0,
            },
          ],
        },
      ];

      const assembler1 = new HierarchicalFilmAssembler({
        seriesId: "test_series",
        episodeNumber: 1,
        title: "Tập 1: Thành Phố Ngầm",
        scenes,
        outputDir: join(testDir, "ep-01-run1"),
      });

      // Run 1: initial assembly
      const manifest1 = await assembler1.assemble();
      expect(manifest1.scenes).toHaveLength(2);
      expect(manifest1.scenes[0].isCacheHit).toBe(false);
      expect(manifest1.scenes[1].isCacheHit).toBe(false);
      expect(existsSync(manifest1.masterOutputs.masterVideoPath)).toBe(true);
      expect(existsSync(manifest1.scenes[0].renderedScenePath)).toBe(true);
      expect(existsSync(manifest1.scenes[1].renderedScenePath)).toBe(true);

      // Run 2: re-running on the same output directory MUST trigger Cache Hit for both scenes!
      const assembler2 = new HierarchicalFilmAssembler({
        seriesId: "test_series",
        episodeNumber: 1,
        title: "Tập 1: Thành Phố Ngầm",
        scenes,
        outputDir: join(testDir, "ep-01-run1"), // Same output directory
      });

      const manifest2 = await assembler2.assemble();
      expect(manifest2.scenes[0].isCacheHit).toBe(true);
      expect(manifest2.scenes[1].isCacheHit).toBe(true);
    });
  });

  describe("3. Xuất Bản Đầy Đủ: Master, Subtitles, 4 Stems & 1:1 Manifest", () => {
    it("generates 4 isolated audio stems, master audio, subtitles, and a validated manifest", async () => {
      const clip1 = join(testClipsDir, "clip_sh1.mp4");
      const clip2 = join(testClipsDir, "clip_sh2.mp4");
      await createValidMockMp4File(clip1, 4.0);
      await createValidMockMp4File(clip2, 4.0);

      const diaAudio1 = join(testClipsDir, "dia_01.mp3");
      const diaAudio2 = join(testClipsDir, "dia_02.mp3");
      const sfxAudio = join(testClipsDir, "sfx_beep.mp3");
      const bgmAudio = join(testClipsDir, "bgm.mp3");
      await createValidMockMp3File(diaAudio1, 2.0);
      await createValidMockMp3File(diaAudio2, 2.5);
      await createValidMockMp3File(sfxAudio, 1.0);
      await createValidMockMp3File(bgmAudio, 10.0);

      const dialogueCues: TimelineDialogueCue[] = [
        {
          dialogueId: "dia_01",
          shotId: "sc1_sh1",
          characterId: "minh",
          speakerName: "Minh",
          rawText: "Đây là dữ liệu tối mật.",
          subtitleText: "Đây là dữ liệu tối mật.",
          ttsText: "Đây là dữ liệu tối mật.",
          startFrame: 0,
          endFrame: 60,
          durationFrames: 60,
          startSec: 0.5,
          endSec: 2.5,
          durationSec: 2.0,
          audioPath: diaAudio1,
          type: "speech",
          isOffScreen: false,
          volume: 1.0,
        },
        {
          dialogueId: "dia_02",
          shotId: "sc1_sh2",
          characterId: "an",
          speakerName: "An",
          rawText: "Tôi sẽ giữ an toàn cho nó.",
          subtitleText: "Tôi sẽ giữ an toàn cho nó.",
          ttsText: "Tôi sẽ giữ an toàn cho nó.",
          startFrame: 120,
          endFrame: 195,
          durationFrames: 75,
          startSec: 4.5,
          endSec: 7.0,
          durationSec: 2.5,
          audioPath: diaAudio2,
          type: "speech",
          isOffScreen: false,
          volume: 1.0,
        },
      ];

      const sfxCues: TimelineSfxCue[] = [
        {
          cueId: "sfx_01",
          shotId: "sc1_sh1",
          name: "Terminal Beep",
          startFrame: 30,
          durationFrames: 30,
          startSec: 1.0,
          durationSec: 1.0,
          audioPath: sfxAudio,
          volume: 0.8,
        },
      ];

      const subtitleCues: TimelineSubtitleCue[] = [
        {
          subtitleId: "sub_01",
          shotId: "sc1_sh1",
          dialogueId: "dia_01",
          speakerName: "Minh",
          displayText: "Đây là dữ liệu tối mật.",
          startFrame: 15,
          endFrame: 75,
          startSec: 0.5,
          endSec: 2.5,
          durationSec: 2.0,
        },
        {
          subtitleId: "sub_02",
          shotId: "sc1_sh2",
          dialogueId: "dia_02",
          speakerName: "An",
          displayText: "Tôi sẽ giữ an toàn cho nó.",
          startFrame: 135,
          endFrame: 210,
          startSec: 4.5,
          endSec: 7.0,
          durationSec: 2.5,
        },
      ];

      const bgmTrack: TimelineBgmCue = {
        audioPath: bgmAudio,
        durationFrames: 240,
        durationSec: 8.0,
        baseVolume: 0.3,
        duckedVolume: 0.08,
        duckingWindows: [
          { startSec: 0.5, endSec: 2.5, startFrame: 15, endFrame: 75 },
          { startSec: 4.5, endSec: 7.0, startFrame: 135, endFrame: 210 },
        ],
      };

      const outDir = join(testDir, "ep-01-full-delivery");
      const assembler = new HierarchicalFilmAssembler({
        seriesId: "series_cyber_delivery",
        episodeNumber: 1,
        title: "Tập 1: Bàn Giao Tuyệt Mật",
        scenes: [
          {
            sceneNumber: 1,
            sceneId: "scene_01",
            shots: [
              {
                shotId: "sc1_sh1",
                sceneId: "scene_01",
                takeId: "take_01_approved",
                sourceClipPath: clip1,
                rawDurationSec: 4.0,
              },
              {
                shotId: "sc1_sh2",
                sceneId: "scene_01",
                takeId: "take_02_approved",
                sourceClipPath: clip2,
                rawDurationSec: 4.0,
              },
            ],
          },
        ],
        dialogueCues,
        sfxCues,
        bgmTrack,
        subtitleCues,
        outputDir: outDir,
      });

      const manifest = await assembler.assemble();

      // 1. Check Master outputs
      expect(existsSync(manifest.masterOutputs.masterVideoPath)).toBe(true);
      expect(existsSync(manifest.masterOutputs.masterAudioPath)).toBe(true);

      // 2. Check 4 Audio Stems
      expect(manifest.masterOutputs.stems.dialogue).toBeDefined();
      expect(existsSync(manifest.masterOutputs.stems.dialogue!)).toBe(true);
      expect(existsSync(manifest.masterOutputs.stems.sfx!)).toBe(true);
      expect(existsSync(manifest.masterOutputs.stems.ambience!)).toBe(true);
      expect(existsSync(manifest.masterOutputs.stems.bgm!)).toBe(true);

      // 3. Check Subtitles
      expect(existsSync(manifest.masterOutputs.subtitlesSrtPath!)).toBe(true);
      expect(existsSync(manifest.masterOutputs.subtitlesVttPath!)).toBe(true);
      const srtText = await readFile(manifest.masterOutputs.subtitlesSrtPath!, "utf-8");
      expect(srtText).toContain("Minh: Đây là dữ liệu tối mật.");
      expect(srtText).toContain("An: Tôi sẽ giữ an toàn cho nó.");

      // 4. Validate Manifest against Zod schema
      const parseResult = AssemblyManifestSchema.safeParse(manifest);
      expect(parseResult.success).toBe(true);

      // 5. Check NLE Interchange paths exist
      expect(existsSync(manifest.masterOutputs.nleInterchange.fcp7XmlPath!)).toBe(true);
      expect(existsSync(manifest.masterOutputs.nleInterchange.otioJsonPath!)).toBe(true);
      expect(manifest.masterOutputs.nleInterchange.verificationNote).toContain(
        "chưa kiểm tra trực tiếp trên GUI DaVinci Resolve hoặc Premiere Pro"
      );
    });
  });

  describe("4. Định Dạng Trao Đổi NLE Chuẩn (FCP7 XML & OpenTimelineIO)", () => {
    it("generates well-formed FCP7 XML (xmeml v4) and valid OpenTimelineIO JSON structure", async () => {
      const timeline: UnifiedTimeline = {
        seriesId: "series_nle_test",
        episodeNumber: 1,
        fps: 30,
        sampleRate: 48000,
        targetTotalFrames: 240,
        targetTotalDurationSec: 8.0,
        videoTrack: [
          {
            shotId: "sc1_sh1",
            sceneId: "scene_1",
            startFrame: 0,
            endFrame: 120,
            durationFrames: 120,
            startSec: 0,
            endSec: 4.0,
            durationSec: 4.0,
            shotType: "wide",
            visualPrompt: "Saigon cyber alleyway",
            approvedClipPath: "output/shots/sc1_sh1.mp4",
            trimStartSec: 0,
          },
          {
            shotId: "sc1_sh2",
            sceneId: "scene_1",
            startFrame: 120,
            endFrame: 240,
            durationFrames: 120,
            startSec: 4.0,
            endSec: 8.0,
            durationSec: 4.0,
            shotType: "close_up",
            visualPrompt: "An checking chip in palm",
            approvedClipPath: "output/shots/sc1_sh2.mp4",
            trimStartSec: 0.5,
          },
        ],
        dialogueTrack: [
          {
            dialogueId: "dia_01",
            shotId: "sc1_sh2",
            characterId: "an",
            speakerName: "An",
            rawText: "Chip này là của Minh.",
            subtitleText: "Chip này là của Minh.",
            ttsText: "Chip này là của Minh.",
            startFrame: 135,
            endFrame: 195,
            durationFrames: 60,
            startSec: 4.5,
            endSec: 6.5,
            durationSec: 2.0,
            audioPath: "output/audio/dia_01.mp3",
            type: "speech",
            isOffScreen: false,
            volume: 1.0,
          },
        ],
        sfxTrack: [],
        ambienceTrack: [],
        subtitleTrack: [],
        stems: {},
        metrics: {
          videoDurationSec: 8.0,
          audioDurationSec: 8.0,
          driftSec: 0,
          driftFrames: 0,
          isWithinTolerance: true,
          toleranceSec: 0.05,
        },
      };

      const outXml = join(testDir, "timeline.xml");
      const outOtio = join(testDir, "timeline.otio");

      const result = await exportNleTimelines({
        timeline,
        outXmlPath: outXml,
        outOtioPath: outOtio,
        sequenceName: "Test_Sequence",
      });

      // 1. Verify FCP7 XML
      expect(existsSync(outXml)).toBe(true);
      const xmlContent = await readFile(outXml, "utf-8");
      expect(xmlContent).toContain('<?xml version="1.0" encoding="UTF-8"?>');
      expect(xmlContent).toContain('<xmeml version="4">');
      expect(xmlContent).toContain("<name>Test_Sequence</name>");
      expect(xmlContent).toContain("<timebase>30</timebase>");
      expect(xmlContent).toContain("<name>sc1_sh1</name>");
      expect(xmlContent).toContain("<name>sc1_sh2</name>");
      expect(xmlContent).toContain("<in>15</in>"); // trimStartSec 0.5s * 30fps = 15 inFrame

      // 2. Verify OTIO JSON
      expect(existsSync(outOtio)).toBe(true);
      const otioContent = await readFile(outOtio, "utf-8");
      const otioObj = JSON.parse(otioContent);
      expect(otioObj.OTIO_SCHEMA).toBe("Timeline.1");
      expect(otioObj.tracks.OTIO_SCHEMA).toBe("Stack.1");
      expect(otioObj.tracks.children).toHaveLength(5); // Video, Dialogue, SFX, Ambience, BGM
      expect(otioObj.tracks.children[0].name).toBe("Video Track (V1)");
      expect(otioObj.tracks.children[0].children).toHaveLength(2);
      expect(otioObj.tracks.children[0].children[0].name).toBe("sc1_sh1");

      // 3. Verification note
      expect(result.verificationNote).toContain(
        "chưa kiểm tra trực tiếp trên GUI DaVinci Resolve hoặc Premiere Pro"
      );
    });
  });

  describe("5. Bộ Kiểm Định QA Bản Dựng (QA Verifier)", () => {
    it("parses blackdetect stderr output correctly", () => {
      const sampleStderr = `
[blackdetect @ 0000021c172] black_start:1.200000 black_end:1.800000 black_duration:0.600000
[blackdetect @ 0000021c172] black_start:4.500000 black_end:5.200000 black_duration:0.700000
      `;
      const segments = parseBlackdetectStderr(sampleStderr);
      expect(segments).toHaveLength(2);
      expect(segments[0].startSec).toBe(1.2);
      expect(segments[0].endSec).toBe(1.8);
      expect(segments[0].durationSec).toBe(0.6);
      expect(segments[1].startSec).toBe(4.5);
      expect(segments[1].durationSec).toBe(0.7);
    });

    it("verifies clean assembly and flags missing or corrupt clips", async () => {
      const validVideo = join(testClipsDir, "qa_valid.mp4");
      const validAudio = join(testClipsDir, "qa_audio.mp3");
      await createValidMockMp4File(validVideo, 5.0);
      await createValidMockMp3File(validAudio, 5.0);

      // 1. Clean verification
      const cleanReport = await verifyAssemblyQa({
        masterVideoPath: validVideo,
        masterAudioPath: validAudio,
        expectedDurationSec: 5.0,
        shotClipPaths: [validVideo],
        detectBlackFrames: false,
      });

      expect(cleanReport.isValid).toBe(true);
      expect(cleanReport.missingFiles).toHaveLength(0);
      expect(cleanReport.errors).toHaveLength(0);

      // 2. Missing clip detection
      const dirtyReport = await verifyAssemblyQa({
        masterVideoPath: validVideo,
        masterAudioPath: validAudio,
        shotClipPaths: [validVideo, join(testClipsDir, "non_existent_clip.mp4")],
        detectBlackFrames: false,
      });

      expect(dirtyReport.isValid).toBe(false);
      expect(dirtyReport.missingFiles).toContain(join(testClipsDir, "non_existent_clip.mp4"));
    });
  });
});
