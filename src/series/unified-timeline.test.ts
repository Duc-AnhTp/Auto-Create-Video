import { describe, it, expect, beforeEach } from "vitest";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { BibleManager } from "../bible/bible-manager.js";
import type { EpisodicScript } from "./series-schema.js";
import {
  secToFrame,
  frameToSec,
  getFrameToleranceSec,
  CODEC_PADDING_TOLERANCE_SEC,
  DialogueOverflowError,
  exportToSrt,
  exportToVtt,
} from "./timeline-schema.js";
import { TimelineScheduler } from "./timeline-scheduler.js";
import { AudioAssembler } from "./audio-assembler.js";

describe("Unified Timeline Engine & Frame-Locked Multi-Track Scheduling", () => {
  let bible: BibleManager;

  beforeEach(() => {
    bible = new BibleManager(":memory:");

    bible.upsertSeriesMetadata({
      id: "cyber-saigon",
      title: "Sài Gòn 2088",
      genre: "Cyberpunk Noir",
      visualStyle: "Cinematic 35mm, gritty cyberpunk, neon lights",
      aspectRatio: "9:16",
      fps: 30,
      created_at: new Date().toISOString(),
    });

    bible.upsertCharacter({
      id: "char_minh",
      name: "Minh",
      role: "protagonist",
      visual_summary: "30 tuổi, thám tử tư",
      voice_profile_id: "elevenlabs:voice_minh_123",
      status: "alive",
    });

    bible.upsertCharacter({
      id: "char_an",
      name: "An",
      role: "supporting",
      visual_summary: "24 tuổi, nữ hacker",
      voice_profile_id: "lucylab:voice_an_456",
      status: "alive",
    });
  });

  // ── Criterion 1: Non-dialogue shots, multi-turn dialogue, silence gaps & SFX ──
  it("schedules non-dialogue shots, multi-turn dialogues, silence gaps, and SFX at exact frame boundaries", () => {
    const script: EpisodicScript = {
      schemaVersion: "3.0",
      version: "3.0",
      seriesId: "cyber-saigon",
      episodeNumber: 1,
      title: "Khởi Đầu",
      logline: "Thám tử Minh gặp An",
      fps: 30,
      aspectRatio: "9:16",
      bgm: "cyber_ambient",
      scenes: [
        {
          sceneId: "sc01",
          sceneNumber: 1,
          locationId: "loc_bar",
          locationName: "Quán Bar Hẻm 9",
          timeOfDay: "night",
          charactersPresent: [{ characterId: "char_minh" }, { characterId: "char_an" }],
          propsPresent: [],
          shots: [
            // Shot 1: 4.0s (120 frames), no dialogue, with SFX at 0.5s offset
            {
              shotId: "sc01_sh01",
              shotType: "establishing",
              durationSec: 4.0,
              visualPrompt: "Quán bar dưới mưa neon",
              dialogues: [],
              sfxCue: {
                name: "neon_hum",
                offsetSec: 0.5,
                volume: 0.8,
              },
            },
            // Shot 2: 5.0s (150 frames), two dialogue turns
            {
              shotId: "sc01_sh02",
              shotType: "medium",
              durationSec: 5.0,
              visualPrompt: "Minh và An ngồi đối diện",
              dialogues: [
                {
                  dialogueId: "sc01_sh02_d01",
                  characterId: "char_minh",
                  speakerName: "Minh",
                  text: "Cầm lấy con chip này.",
                  subtitleText: "Cầm lấy con chip này.",
                  ttsText: "Cầm lấy con chip này.",
                  type: "speech",
                },
                {
                  dialogueId: "sc01_sh02_d02",
                  characterId: "char_an",
                  speakerName: "An",
                  text: "Có bẫy không?",
                  subtitleText: "Có bẫy không?",
                  ttsText: "Có bẫy không?",
                  type: "speech",
                },
              ],
            },
          ],
        },
      ],
    };

    const measuredTts = {
      sc01_sh02_d01: 1.8, // Minh nói 1.8s (54 frames)
      sc01_sh02_d02: 1.2, // An nói 1.2s (36 frames)
    };

    const timeline = TimelineScheduler.schedule(script, measuredTts, {
      fps: 30,
      turnGapSec: 0.2, // 6 frames gap between turns
    });

    // Verify Timebase: All frames are integers
    expect(Number.isInteger(timeline.targetTotalFrames)).toBe(true);
    expect(timeline.videoTrack.length).toBe(2);

    // Shot 1 check:
    const vShot1 = timeline.videoTrack[0];
    expect(vShot1.startFrame).toBe(0);
    expect(vShot1.durationFrames).toBe(120); // 4.0s * 30fps
    expect(vShot1.endFrame).toBe(120);
    expect(vShot1.startSec).toBe(0.0);
    expect(vShot1.durationSec).toBe(4.0);

    // SFX in Shot 1 check:
    expect(timeline.sfxTrack.length).toBe(1);
    const sfx1 = timeline.sfxTrack[0];
    expect(sfx1.name).toBe("neon_hum");
    expect(sfx1.startFrame).toBe(15); // 0.5s * 30fps = 15 frames
    expect(sfx1.startSec).toBe(0.5);

    // Shot 2 check:
    const vShot2 = timeline.videoTrack[1];
    expect(vShot2.startFrame).toBe(120); // Starts right after Shot 1
    expect(vShot2.durationFrames).toBe(150); // 5.0s * 30fps
    expect(vShot2.endFrame).toBe(270);
    expect(vShot2.startSec).toBe(4.0);
    expect(vShot2.durationSec).toBe(5.0);

    // Dialogue Track check:
    // Shot 1 has NO dialogue cues (silence preserved)
    const shot1Dialogues = timeline.dialogueTrack.filter((d) => d.shotId === "sc01_sh01");
    expect(shot1Dialogues.length).toBe(0);

    // Shot 2 has 2 turns:
    const shot2Dialogues = timeline.dialogueTrack.filter((d) => d.shotId === "sc01_sh02");
    expect(shot2Dialogues.length).toBe(2);

    // Turn 1 (Minh): starts at shot start (frame 120 = 4.0s)
    const turn1 = shot2Dialogues[0];
    expect(turn1.speakerName).toBe("Minh");
    expect(turn1.startFrame).toBe(120);
    expect(turn1.durationFrames).toBe(54); // 1.8s * 30fps
    expect(turn1.endFrame).toBe(174);
    expect(turn1.startSec).toBe(4.0);

    // Turn 2 (An): starts after Turn 1 + 0.2s gap (6 frames) -> 174 + 6 = 180 (6.0s)
    const turn2 = shot2Dialogues[1];
    expect(turn2.speakerName).toBe("An");
    expect(turn2.startFrame).toBe(180);
    expect(turn2.durationFrames).toBe(36); // 1.2s * 30fps
    expect(turn2.endFrame).toBe(216);
    expect(turn2.startSec).toBe(6.0);

    // Total timeline length
    expect(timeline.targetTotalFrames).toBe(270);
    expect(timeline.targetTotalDurationSec).toBe(9.0);
  });

  // ── Criterion 2: Dialogue Overflow Policies (extend_shot vs error) ──────────
  it("extends shot duration when dialogue exceeds shot time under 'extend_shot' policy", () => {
    const script: EpisodicScript = {
      schemaVersion: "3.0",
      version: "3.0",
      seriesId: "cyber-saigon",
      episodeNumber: 1,
      title: "Thoại Dài",
      logline: "Test",
      fps: 30,
      scenes: [
        {
          sceneId: "sc01",
          sceneNumber: 1,
          locationId: "loc_bar",
          locationName: "Quán Bar",
          shots: [
            {
              shotId: "sc01_sh01",
              shotType: "close_up",
              durationSec: 3.0, // 3s target
              visualPrompt: "Minh phân trần",
              dialogues: [
                {
                  dialogueId: "sc01_sh01_d01",
                  characterId: "char_minh",
                  speakerName: "Minh",
                  text: "Câu thoại này rất dài và cần 5.0 giây để nói hết.",
                  type: "speech",
                },
              ],
            },
          ],
        },
      ],
    };

    const measuredTts = {
      sc01_sh01_d01: 5.0, // 5.0s > 3.0s!
    };

    // 1. With extend_shot policy (default): extends shot to fit dialogue + padding (0.3s)
    const extendedTimeline = TimelineScheduler.schedule(script, measuredTts, {
      fps: 30,
      overflowPolicy: "extend_shot",
      postDialoguePaddingSec: 0.3,
    });

    const vShot = extendedTimeline.videoTrack[0];
    expect(vShot.durationSec).toBeGreaterThanOrEqual(5.3);
    expect(vShot.durationFrames).toBe(secToFrame(5.3, 30));
    expect(extendedTimeline.targetTotalDurationSec).toBeGreaterThanOrEqual(5.3);

    // 2. With error policy: throws DialogueOverflowError with actionable detail
    expect(() =>
      TimelineScheduler.schedule(script, measuredTts, {
        fps: 30,
        overflowPolicy: "error",
      })
    ).toThrow(DialogueOverflowError);

    try {
      TimelineScheduler.schedule(script, measuredTts, {
        fps: 30,
        overflowPolicy: "error",
      });
    } catch (err: any) {
      expect(err).toBeInstanceOf(DialogueOverflowError);
      expect(err.shotId).toBe("sc01_sh01");
      expect(err.dialogueId).toBe("sc01_sh01_d01");
      expect(err.shotDurationSec).toBe(3.0);
      expect(err.dialogueDurationSec).toBeGreaterThanOrEqual(5.0);
      expect(err.overflowSec).toBeGreaterThanOrEqual(2.0);
    }
  });

  // ── Criterion 3: Transition Overlap Computation ───────────────────────────
  it("accounts for transition overlap in total timeline duration", () => {
    const script: EpisodicScript = {
      schemaVersion: "3.0",
      version: "3.0",
      seriesId: "cyber-saigon",
      episodeNumber: 1,
      title: "Chuyển Cảnh",
      logline: "Test",
      fps: 30,
      scenes: [
        {
          sceneId: "sc01",
          sceneNumber: 1,
          locationId: "loc_bar",
          locationName: "Quán Bar",
          shots: [
            {
              shotId: "sc01_sh01",
              durationSec: 4.0,
              visualPrompt: "Shot 1",
              dialogues: [],
            },
            {
              shotId: "sc01_sh02",
              durationSec: 4.0,
              visualPrompt: "Shot 2",
              dialogues: [],
            },
          ],
        },
      ],
    };

    // Case A: Hard Cut (0s overlap)
    const cutTimeline = TimelineScheduler.schedule(script, {}, {
      fps: 30,
      transitionType: "cut",
      transitionDurationSec: 0,
    });
    expect(cutTimeline.targetTotalDurationSec).toBe(8.0);
    expect(cutTimeline.videoTrack[1].startSec).toBe(4.0);

    // Case B: Crossfade with 0.5s overlap (15 frames)
    const xfadeTimeline = TimelineScheduler.schedule(script, {}, {
      fps: 30,
      transitionType: "crossfade",
      transitionDurationSec: 0.5,
    });
    // Shot 2 starts 0.5s before Shot 1 ends: startFrame = 120 - 15 = 105 (3.5s)
    expect(xfadeTimeline.videoTrack[1].startFrame).toBe(105);
    expect(xfadeTimeline.videoTrack[1].startSec).toBe(3.5);
    // Shot 2 duration = 4.0s (120 frames), ends at 105 + 120 = 225 frames (7.5s)
    expect(xfadeTimeline.targetTotalFrames).toBe(225);
    expect(xfadeTimeline.targetTotalDurationSec).toBe(7.5);
  });

  // ── Criterion 4: Subtitles use clean display text, NOT phonetic TTS text ───
  it("generates SRT and VTT subtitles strictly using subtitleText (display text), never phonetic ttsText", () => {
    const script: EpisodicScript = {
      schemaVersion: "3.0",
      version: "3.0",
      seriesId: "cyber-saigon",
      episodeNumber: 1,
      title: "Phụ Đề",
      logline: "Test",
      fps: 30,
      scenes: [
        {
          sceneId: "sc01",
          sceneNumber: 1,
          locationId: "loc_bar",
          locationName: "Quán Bar",
          shots: [
            {
              shotId: "sc01_sh01",
              durationSec: 4.0,
              visualPrompt: "Shot 1",
              dialogues: [
                {
                  dialogueId: "sc01_sh01_d01",
                  characterId: "char_minh",
                  speakerName: "Minh",
                  rawText: 'MINH (thì thào): "Giá con chip này: đúng $500."',
                  subtitleText: "Giá con chip này: đúng $500.", // Display text for viewer
                  ttsText: "Giá con chip này: đúng năm trăm đô la.", // TTS speech text
                  actingInstruction: "thì thào",
                  type: "speech",
                },
              ],
            },
          ],
        },
      ],
    };

    const timeline = TimelineScheduler.schedule(script, { sc01_sh01_d01: 2.5 }, { fps: 30 });
    expect(timeline.subtitleTrack.length).toBe(1);

    const sub = timeline.subtitleTrack[0];
    expect(sub.displayText).toBe("Giá con chip này: đúng $500.");

    // Check SRT text output
    const srt = exportToSrt(timeline.subtitleTrack);
    expect(srt).toContain("Minh: Giá con chip này: đúng $500.");
    expect(srt).not.toContain("năm trăm đô la");
    expect(srt).not.toContain("thì thào");

    // Check VTT text output
    const vtt = exportToVtt(timeline.subtitleTrack);
    expect(vtt).toContain("<v Minh>Giá con chip này: đúng $500.");
    expect(vtt).not.toContain("năm trăm đô la");
  });

  // ── Criterion 5: Multi-Track Audio Stems Assembly & File Export ───────────
  it("assembles and exports 4 distinct audio stems (dialogue, sfx, ambience, bgm) and subtitle files", async () => {
    const assembler = new AudioAssembler();
    const script: EpisodicScript = {
      schemaVersion: "3.0",
      version: "3.0",
      seriesId: "cyber-saigon",
      episodeNumber: 1,
      title: "Stems Test",
      logline: "Test",
      fps: 30,
      aspectRatio: "9:16",
      bgm: "cyber_ambient",
      scenes: [
        {
          sceneId: "sc01",
          sceneNumber: 1,
          locationId: "loc_bar",
          locationName: "Quán Bar",
          shots: [
            {
              shotId: "sc01_sh01",
              durationSec: 4.0,
              visualPrompt: "Quán bar",
              dialogues: [
                {
                  dialogueId: "sc01_sh01_d01",
                  characterId: "char_minh",
                  speakerName: "Minh",
                  text: "Xin chào.",
                  type: "speech",
                },
              ],
              sfxCue: {
                name: "door_close",
                offsetSec: 0.2,
                volume: 0.7,
              },
            },
          ],
        },
      ],
    };

    const outDir = "output/test-stems-assembly";
    const result = await assembler.assembleEpisodeAudio({
      script,
      bible,
      outputDir: outDir,
      mockTts: true,
    });

    // Verify 4 Stems were generated and paths returned
    expect(result.stems.dialogue).toContain("stem_dialogue.mp3");
    expect(result.stems.sfx).toContain("stem_sfx.mp3");
    expect(result.stems.ambience).toContain("stem_ambience.mp3");
    expect(result.stems.bgm).toContain("stem_bgm.mp3");
    expect(result.stems.master).toContain("master-soundtrack.mp3");

    // Verify Subtitle files were generated and written
    expect(result.subtitles.srtPath).toContain("subtitles.srt");
    expect(result.subtitles.vttPath).toContain("subtitles.vtt");

    const srtDiskContent = await readFile(result.subtitles.srtPath, "utf8");
    expect(srtDiskContent).toContain("Minh: Xin chào.");

    // Verify Timeline Drift Metrics
    expect(result.unifiedTimeline.metrics.isWithinTolerance).toBe(true);
    expect(result.unifiedTimeline.metrics.driftSec).toBeLessThanOrEqual(
      getFrameToleranceSec(30) + CODEC_PADDING_TOLERANCE_SEC
    );
  });
});
