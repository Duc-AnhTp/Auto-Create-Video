import { createTimelineFixture } from "../../../../__test-utils__/timeline-fixture.js";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";

import {
  generateCmx3600Edl,
  framesToSmpteTimecode,
  exportNleTimelines,
} from "./nle-exporter.js";
import {
  parseFcp7Xml,
  extractShotMetadataFromFilename,
  compareWithTimeline,
} from "./nle-ingest-parser.js";
import { NleRoundTripConformer } from "./nle-conformer.js";

describe("Option 2: DaVinci Resolve & Premiere Pro Seamless Two-Way Round-Trip", () => {
  const testOutputDir = join("data", "test_nle_roundtrip_output");

  const sampleMasterTimeline = createTimelineFixture({
    episodeNumber: 1,
    targetTotalDurationSec: 15.0,
    fps: 24,
    videoTrack: [
      {
        shotId: "shot_1",
        sceneId: "scene_1", trimStartSec: 0, endFrame: 120,
        startSec: 0,
        endSec: 5.0,
        durationSec: 5.0,
        startFrame: 0,
        durationFrames: 120,
        shotType: "establishing",
        visualPrompt: "Cảnh toàn thành phố",
        approvedClipPath: "shots/shot_1_take1.mp4",
        cdl: {
          slope: [1.1, 0.95, 1.05],
          offset: [-0.02, 0.0, 0.02],
          power: [0.98, 1.0, 1.02],
          saturation: 1.15,
        },
      },
      {
        shotId: "shot_2",
        sceneId: "scene_1", trimStartSec: 0, endFrame: 240,
        startSec: 5.0,
        endSec: 10.0,
        durationSec: 5.0,
        startFrame: 120,
        durationFrames: 120,
        shotType: "medium",
        visualPrompt: "Minh xuất hiện",
        approvedClipPath: "shots/shot_2_take1.mp4",
      },
      {
        shotId: "shot_3",
        sceneId: "scene_1", trimStartSec: 0, endFrame: 360,
        startSec: 10.0,
        endSec: 15.0,
        durationSec: 5.0,
        startFrame: 240,
        durationFrames: 120,
        shotType: "close_up",
        visualPrompt: "Cận cảnh ánh mắt",
        approvedClipPath: "shots/shot_3_take1.mp4",
      },
    ],
    dialogueTrack: [
      {
        shotId: "shot_2",
        dialogueId: "dia_1",
        characterId: "char_minh",
        type: "speech", isOffScreen: false, volume: 1,
        startFrame: 144, endFrame: 216, durationFrames: 72, endSec: 9,
        speakerName: "Minh",
        rawText: "Không thể lùi bước.", subtitleText: "Không thể lùi bước.", ttsText: "Không thể lùi bước.",
        startSec: 6.0, // Anchored 1.0s into shot_2
        durationSec: 3.0,
        audioPath: "audio/dia_1.mp3",
      },
    ],
    sfxTrack: [
      {
        cueId: "steps", startFrame: 125, durationFrames: 96,
        name: "Bước chân",
        shotId: "shot_2",
        startSec: 5.2,
        durationSec: 4.0,
        audioPath: "audio/sfx_footsteps.mp3",
        volume: 0.8,
      },
    ],
  });

  beforeEach(async () => {
    if (existsSync(testOutputDir)) {
      await rm(testOutputDir, { recursive: true, force: true }).catch(() => {});
    }
  });

  afterEach(async () => {
    if (existsSync(testOutputDir)) {
      await rm(testOutputDir, { recursive: true, force: true }).catch(() => {});
    }
  });

  describe("1. CMX 3600 EDL & SMPTE Timecode Generation", () => {
    it("should accurately convert frames to SMPTE timecode (HH:MM:SS:FF)", () => {
      expect(framesToSmpteTimecode(0, 24)).toBe("00:00:00:00");
      expect(framesToSmpteTimecode(24, 24)).toBe("00:00:01:00");
      expect(framesToSmpteTimecode(1440, 24)).toBe("00:01:00:00"); // 60 seconds
      expect(framesToSmpteTimecode(37, 24)).toBe("00:00:01:13");
    });

    it("should generate valid CMX 3600 EDL with DaVinci ASC CDL metadata", () => {
      const edl = generateCmx3600Edl({
        timeline: sampleMasterTimeline,
        sequenceName: "TEST_SEQUENCE",
      });

      expect(edl).toContain("TITLE: TEST_SEQUENCE");
      expect(edl).toContain("FCM: NON-DROP FRAME");
      expect(edl).toContain("001  AX       V     C");
      expect(edl).toContain("* FROM CLIP NAME: shot_1_take1.mp4");
      expect(edl).toContain("* ASC_SOP (1.1000 0.9500 1.0500)(-0.0200 0.0000 0.0200)(0.9800 1.0000 1.0200)");
      expect(edl).toContain("* ASC_SAT 1.1500");
    });

    it("should export FCP7 XML, CMX 3600 EDL, and OTIO JSON files to disk", async () => {
      const xmlPath = join(testOutputDir, "davinci.xml");
      const edlPath = join(testOutputDir, "timeline.edl");
      const otioPath = join(testOutputDir, "timeline.otio");

      const result = await exportNleTimelines({
        timeline: sampleMasterTimeline,
        outXmlPath: xmlPath,
        outEdlPath: edlPath,
        outOtioPath: otioPath,
        sequenceName: "Ep1_Master",
      });

      expect(existsSync(result.fcp7XmlPath)).toBe(true);
      expect(existsSync(result.otioJsonPath)).toBe(true);
      expect(result.cmx3600EdlPath).toBeDefined();
      if (result.cmx3600EdlPath) {
        expect(existsSync(result.cmx3600EdlPath)).toBe(true);
      }
    });
  });

  describe("2. NleRoundTripConformer: Slipped Boundaries & Auto Audio Realignment", () => {
    it("should conform trimmed shots and auto-realign downstream dialogue and SFX", () => {
      // Simulate an editor trimming shot_1 from 5.0s (120 frames) down to 3.5s (84 frames) in DaVinci
      // And trimming shot_2 from 5.0s (120 frames) to 6.0s (144 frames)
      const mockIngestedXml = `
<xmeml version="5">
  <sequence>
    <name>DaVinci_Edit_Cut</name>
    <rate><timebase>24</timebase></rate>
    <media>
      <video>
        <track>
          <clipitem id="clipitem-1">
            <name>shot_1</name>
            <duration>84</duration>
            <start>0</start>
            <end>84</end>
            <in>0</in>
            <out>84</out>
          </clipitem>
          <clipitem id="clipitem-2">
            <name>shot_2_take2</name>
            <duration>144</duration>
            <start>84</start>
            <end>228</end>
            <in>0</in>
            <out>144</out>
          </clipitem>
          <clipitem id="clipitem-3">
            <name>shot_3</name>
            <duration>120</duration>
            <start>228</start>
            <end>348</end>
            <in>0</in>
            <out>120</out>
          </clipitem>
        </track>
      </video>
    </media>
  </sequence>
</xmeml>
      `.trim();

      const parsedIngested = parseFcp7Xml(mockIngestedXml);
      expect(parsedIngested.videoClips.length).toBe(3);

      const conformResult = NleRoundTripConformer.conform(sampleMasterTimeline, parsedIngested);

      expect(conformResult.hasModifications).toBe(true);
      expect(conformResult.diffReport.trimmedShots.length).toBe(2); // shot_1 and shot_2 trimmed
      expect(conformResult.diffReport.swappedTakes.length).toBe(1); // shot_2 swapped to take2

      const trimmedShot1 = conformResult.diffReport.trimmedShots.find((t) => t.shotId === "shot_1");
      expect(trimmedShot1).toBeDefined();
      expect(trimmedShot1?.editedDurationSec).toBe(3.5); // 84 / 24
      expect(trimmedShot1?.deltaSec).toBe(-1.5);

      // Verify take swap
      const swappedShot2 = conformResult.diffReport.swappedTakes.find((s) => s.shotId === "shot_2");
      expect(swappedShot2).toBeDefined();
      expect(swappedShot2?.newTakeNumber).toBe(2);

      // Verify Auto-Realigned Dialogue
      // In original timeline: shot_2 started at 5.0s, dialogue started at 6.0s (offset +1.0s)
      // In conformed timeline: shot_2 starts at 3.5s, so dialogue MUST realign to 3.5 + 1.0 = 4.5s
      const realignedDia = conformResult.conformedTimeline.dialogueTrack[0];
      expect(realignedDia.startSec).toBe(4.5);
      expect(conformResult.realignedDialogueCount).toBe(1);

      // Verify Auto-Realigned SFX
      // In original timeline: shot_2 started at 5.0s, SFX started at 5.2s (offset +0.2s)
      // In conformed timeline: SFX MUST realign to 3.5 + 0.2 = 3.7s
      const realignedSfx = conformResult.conformedTimeline.sfxTrack[0];
      expect(realignedSfx.startSec).toBe(3.7);
      expect(conformResult.realignedSfxCount).toBe(1);

      // Verify new total duration
      expect(conformResult.conformedTimeline.targetTotalDurationSec).toBe(14.5); // 3.5 + 6.0 + 5.0
    });

    it("should recompute BGM ducking windows, segment non-contiguous ambience, and resolve 4-tier subtitle fallback", () => {
      const advancedTimeline = createTimelineFixture({
        episodeNumber: 1,
        targetTotalDurationSec: 20.0,
        fps: 24,
        videoTrack: [
          {
            shotId: "sh_1",
            sceneId: "sc_A",
            startSec: 0,
            endSec: 5.0,
            durationSec: 5.0,
            startFrame: 0,
            endFrame: 120,
            durationFrames: 120,
            trimStartSec: 0,
            shotType: "establishing",
            visualPrompt: "Cảnh 1",
            approvedClipPath: "shots/sh_1_take1.mp4",
          },
          {
            shotId: "sh_2",
            sceneId: "sc_B",
            startSec: 5.0,
            endSec: 10.0,
            durationSec: 5.0,
            startFrame: 120,
            endFrame: 240,
            durationFrames: 120,
            trimStartSec: 0,
            shotType: "medium",
            visualPrompt: "Cảnh 2",
            approvedClipPath: "shots/sh_2_take1.mp4",
          },
          {
            shotId: "sh_3",
            sceneId: "sc_A", // Interleaved scene A shot
            startSec: 10.0,
            endSec: 15.0,
            durationSec: 5.0,
            startFrame: 240,
            endFrame: 360,
            durationFrames: 120,
            trimStartSec: 0,
            shotType: "close_up",
            visualPrompt: "Cảnh 3",
            approvedClipPath: "shots/sh_3_take1.mp4",
          },
        ],
        dialogueTrack: [
          {
            shotId: "sh_2",
            dialogueId: "dia_multi_1",
            characterId: "c1",
            speakerName: "Minh",
            type: "speech",
            isOffScreen: false,
            volume: 1,
            startSec: 6.0,
            endSec: 8.0,
            durationSec: 2.0,
            startFrame: 144,
            endFrame: 192,
            durationFrames: 48,
            rawText: "Thoại 1",
            subtitleText: "Thoại 1",
            ttsText: "Thoại 1",
            audioPath: "dia1.mp3",
          },
          {
            shotId: "sh_2",
            dialogueId: "dia_multi_2",
            characterId: "c2",
            speakerName: "An",
            type: "speech",
            isOffScreen: false,
            volume: 1,
            startSec: 8.2,
            endSec: 9.8,
            durationSec: 1.6,
            startFrame: 196,
            endFrame: 235,
            durationFrames: 39,
            rawText: "Thoại 2",
            subtitleText: "Thoại 2",
            ttsText: "Thoại 2",
            audioPath: "dia2.mp3",
          },
        ],
        subtitleTrack: [
          {
            subtitleId: "sub_missing_id",
            shotId: "sh_2",
            dialogueId: "dia_multi_2", // Matches dia_multi_2
            speakerName: "An",
            displayText: "Thoại 2",
            startSec: 8.2,
            endSec: 9.8,
            durationSec: 1.6,
            startFrame: 196,
            endFrame: 235,
          },
        ],
        ambienceTrack: [
          {
            cueId: "amb_scene_A",
            sceneId: "sc_A",
            name: "Tiếng gió",
            startSec: 0,
            durationSec: 15.0,
            startFrame: 0,
            durationFrames: 360,
            volume: 0.3,
            fadeInSec: 0.5,
            fadeOutSec: 0.5,
            audioPath: "amb.mp3",
          },
        ],
        bgmTrack: {
          audioPath: "bgm.mp3",
          startSec: 0,
          durationSec: 20.0,
          startFrame: 0,
          durationFrames: 480,
          baseVolume: 0.2,
          duckedVolume: 0.05,
          duckingWindows: [
            { startSec: 1.0, endSec: 2.0, startFrame: 24, endFrame: 48 }, // Stale window
          ],
        },
      });

      const mockXml = `
<xmeml version="5">
  <sequence>
    <name>Seq_Interleaved</name>
    <rate><timebase>24</timebase></rate>
    <media>
      <video>
        <track>
          <clipitem id="clip-1"><name>sh_1</name><duration>120</duration><start>0</start><end>120</end><in>0</in><out>120</out></clipitem>
          <clipitem id="clip-2"><name>sh_2</name><duration>120</duration><start>120</start><end>240</end><in>0</in><out>120</out></clipitem>
          <clipitem id="clip-3"><name>sh_3</name><duration>120</duration><start>240</start><end>360</end><in>0</in><out>120</out></clipitem>
        </track>
      </video>
    </media>
  </sequence>
</xmeml>
      `.trim();

      const parsed = parseFcp7Xml(mockXml);
      const conformed = NleRoundTripConformer.conform(advancedTimeline, parsed);

      // 1. Check BGM Ducking recalculated from dialogue cues
      expect(conformed.conformedTimeline.bgmTrack).toBeDefined();
      const duckWindows = conformed.conformedTimeline.bgmTrack?.duckingWindows;
      expect(duckWindows).toBeDefined();
      expect(duckWindows?.length).toBe(2); // 2 dialogue cues in dialogueTrack
      // Dialogue 1 starts at 6.0s -> ducking window starts at 6.0 - 0.2 = 5.8s
      expect(duckWindows?.[0].startSec).toBe(5.8);
      // Dialogue 1 ends at 8.0s -> ducking window ends at 8.0 + 0.4 = 8.4s
      expect(duckWindows?.[0].endSec).toBe(8.4);

      // 2. Check Ambience segmented into 2 contiguous blocks for scene_A
      // Scene A has sh_1 [0-5s] and sh_3 [10-15s] separated by sh_2 (scene B)
      const ambCues = conformed.conformedTimeline.ambienceTrack;
      expect(ambCues.length).toBe(2);
      expect(ambCues[0].cueId).toBe("amb_scene_A_blk1");
      expect(ambCues[0].startSec).toBe(0);
      expect(ambCues[0].durationSec).toBe(5.0);
      expect(ambCues[1].cueId).toBe("amb_scene_A_blk2");
      expect(ambCues[1].startSec).toBe(10.0);
      expect(ambCues[1].durationSec).toBe(5.0);

      // 3. Check Subtitle Tier 1/2 resolution without throw
      const subTrack = conformed.conformedTimeline.subtitleTrack;
      expect(subTrack.length).toBe(1);
      expect(subTrack[0].dialogueId).toBe("dia_multi_2");
      expect(subTrack[0].startSec).toBe(8.2);
    });
  });

  describe("3. Nle Ingest Parser Boundary & Frame Rate Logic", () => {
    it("should correctly handle take number word boundaries", () => {
      // Valid take patterns
      const res1 = extractShotMetadataFromFilename("sc01_sh01_take02.mp4");
      expect(res1.shotId).toBe("sc01_sh01");
      expect(res1.takeNumber).toBe(2);

      const res2 = extractShotMetadataFromFilename("shot_03_take1.mov");
      expect(res2.shotId).toBe("shot_03");
      expect(res2.takeNumber).toBe(1);

      // Substrings containing 'take' as part of a word should NOT match as take number
      const res3 = extractShotMetadataFromFilename("mistake_01.mp4");
      expect(res3.takeNumber).toBeUndefined();

      const res4 = extractShotMetadataFromFilename("intake_sh02.mp4");
      expect(res4.takeNumber).toBeUndefined();
    });

    it("should compute duration using editedFps rather than original fps", () => {
      const origTimeline = createTimelineFixture({
        fps: 30, // Original was 30 fps
        targetTotalDurationSec: 5.0,
        videoTrack: [
          {
            shotId: "shot_1",
            sceneId: "scene_1",
            trimStartSec: 0,
            startSec: 0,
            endSec: 5.0,
            durationSec: 5.0,
            startFrame: 0,
            endFrame: 150,
            durationFrames: 150,
            shotType: "establishing",
            visualPrompt: "Test",
            approvedClipPath: "shot_1_take1.mp4",
          },
        ],
      });

      const ingestedDiff = compareWithTimeline(origTimeline, {
        sequenceName: "Test_Edited_25fps",
        fps: 25, // Ingested timeline edited at 25 fps
        totalFrames: 125,
        totalDurationSec: 5.0,
        audioClips: [],
        videoClips: [
          {
            id: "clip-1",
            name: "shot_1",
            shotId: "shot_1",
            startFrame: 0,
            endFrame: 125,
            inFrame: 0,
            outFrame: 125,
            durationFrames: 125, // 125 frames at 25 fps = exactly 5.0s
          },
        ],
      });

      // Duration should be 125 / 25 = 5.0s, delta should be 0s, so not marked as trimmed!
      expect(ingestedDiff.trimmedShots.length).toBe(0);
    });
  });
});
