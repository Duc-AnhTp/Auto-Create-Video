import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { applySpatialAudioPanning } from "../assets/audio-tools.js";
import { TimelineScheduler } from "./timeline-scheduler.js";
import type { EpisodicScript } from "./series-schema.js";
import { mkdtempSync, rmSync, existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("Spatial Audio & Director Panning (Giai Đoạn 1)", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "spatial-audio-test-"));
  });

  afterEach(() => {
    try {
      if (existsSync(tempDir)) {
        rmSync(tempDir, { recursive: true, force: true });
      }
    } catch {}
  });

  it("applies spatial audio panning filter or safely copies file on zero pan", async () => {
    const mockIn = join(tempDir, "in.mp3");
    const mockOut = join(tempDir, "out_panned.mp3");
    writeFileSync(mockIn, "MOCK_AUDIO_DATA");

    const res = await applySpatialAudioPanning(mockIn, mockOut, 0.0);
    expect(res).toBe(mockOut);
    expect(existsSync(mockOut)).toBe(true);
  });

  it("TimelineScheduler automatically assigns stereo pan to dialogue cues based on character positions", () => {
    const mockScript: EpisodicScript = {
      schemaVersion: "2.0.0",
      version: "2.0.0",
      seriesId: "series_cyber",
      episodeNumber: 1,
      title: "Đêm Định Mệnh",
      logline: "Hai thám tử đối mặt trong màn đêm định mệnh",
      aspectRatio: "9:16",
      fps: 30,
      unresolvedCharacters: [],
      scenes: [
        {
          sceneId: "sc01",
          sceneNumber: 1,
          locationId: "loc_bar",
          locationName: "Quán Bar Hẻm 9",
          timeOfDay: "night",
          beatIds: [],
          propsPresent: [],
          charactersPresent: [
            { characterId: "char_minh", wardrobeId: "w1" },
            { characterId: "char_lan", wardrobeId: "w2" },
          ],
          shots: [
            {
              shotId: "sc01_sh01",
              shotType: "medium",
              durationSec: 4.0,
              visualPrompt: "Minh và Lan đối diện nhau.",
              beatIds: [],
              dialogues: [
                {
                  dialogueId: "sc01_sh01_d01",
                  characterId: "char_minh",
                  speakerName: "Minh",
                  text: "Tôi có linh cảm không lành.",
                  rawText: "Tôi có linh cảm không lành.",
                  subtitleText: "Tôi có linh cảm không lành.",
                  ttsText: "Tôi có linh cảm không lành.",
                  type: "speech",
                  actingInstruction: undefined,
                  voiceProfileId: undefined,
                  isUnresolved: false,
                  durationSec: 2.0,
                },
                {
                  dialogueId: "sc01_sh01_d02",
                  characterId: "char_lan",
                  speakerName: "Lan",
                  text: "Chúng ta cần di chuyển ngay.",
                  rawText: "Chúng ta cần di chuyển ngay.",
                  subtitleText: "Chúng ta cần di chuyển ngay.",
                  ttsText: "Chúng ta cần di chuyển ngay.",
                  type: "speech",
                  actingInstruction: undefined,
                  voiceProfileId: undefined,
                  isUnresolved: false,
                  durationSec: 2.0,
                },
              ],
            },
          ],
        },
      ],
    };

    const timeline = TimelineScheduler.schedule(mockScript, {
      "sc01_sh01_d01": 2.0,
      "sc01_sh01_d02": 2.0,
    });

    expect(timeline.dialogueTrack.length).toBe(2);
    // Lead character (Minh) -> Left side (-0.25)
    expect(timeline.dialogueTrack[0].pan).toBe(-0.25);
    // Second character (Lan) -> Right side (+0.25)
    expect(timeline.dialogueTrack[1].pan).toBe(0.25);
  });
});
