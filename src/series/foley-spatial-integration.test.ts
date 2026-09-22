import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { BibleManager } from "../bible/bible-manager.js";
import { AudioAssembler } from "./audio-assembler.js";
import { TimelineScheduler } from "./timeline-scheduler.js";
import { EpisodicScriptSchema } from "./series-schema.js";
import { MmaudioFoleyClient, type FoleyGenerator } from "../audio/foley-generator.js";

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "foley-spatial-test-"));
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe("Phase 1: Foley & Spatial Audio Integration", () => {
  it("TimelineScheduler maps sfxCue pan and actionPrompt correctly", () => {
    const script = EpisodicScriptSchema.parse({
      seriesId: "test_series",
      episodeNumber: 1,
      title: "Căn Phòng Tối",
      logline: "Minh mở cửa trong đêm.",
      scenes: [
        {
          sceneNumber: 1,
          locationId: "loc_room",
          locationName: "Căn phòng bí mật",
          timeOfDay: "night",
          shots: [
            {
              shotId: "shot_01",
              shotType: "medium",
              durationSec: 4.0,
              visualPrompt: "Minh đứng bên trái mở cánh cửa gỗ cũ kỹ",
              beatIds: [],
              dialogues: [],
              sfxCue: {
                name: "door_creak",
                offsetSec: 0.5,
                volume: 0.8,
                pan: -0.25,
                description: "Tiếng cánh cửa gỗ cũ kỹ mở kẽo kẹt",
              },
            },
          ],
        },
      ],
    });

    const timeline = TimelineScheduler.schedule(script, {}, { fps: 30 });

    expect(timeline.sfxTrack.length).toBe(1);
    expect(timeline.sfxTrack[0].name).toBe("door_creak");
    expect(timeline.sfxTrack[0].pan).toBe(-0.25);
    expect(timeline.sfxTrack[0].actionPrompt).toBe("Tiếng cánh cửa gỗ cũ kỹ mở kẽo kẹt");
    expect(timeline.sfxTrack[0].startSec).toBeCloseTo(0.5, 1);
  });

  it("AudioAssembler dynamically synthesizes Foley SFX using FoleyGenerator and applies spatial pan", async () => {
    const bible = new BibleManager(":memory:", { allowMemoryFallback: true });
    bible.upsertSeriesMetadata({ id: "series_foley", title: "Thám Tử Tư" });
    bible.upsertCharacter({ id: "char_minh", name: "Minh", series_id: "series_foley" });

    // Mock Foley Generator that records calls and produces mock audio
    let generatedCount = 0;
    const mockFoleyGen: FoleyGenerator = {
      async generateFoley(videoPath, actionPrompt, outPath, options) {
        generatedCount++;
        const client = new MmaudioFoleyClient({
          endpoint: "http://127.0.0.1:59999",
          mockFallback: true,
        });
        return client.generateFoley(videoPath, actionPrompt, outPath, options);
      },
    };

    const assembler = new AudioAssembler({
      foleyGenerator: mockFoleyGen,
    });

    const script = EpisodicScriptSchema.parse({
      seriesId: "series_foley",
      episodeNumber: 1,
      title: "Tiếng Bước Chân Trong Đêm",
      logline: "Minh bước đi trong hành lang.",
      scenes: [
        {
          sceneNumber: 1,
          locationId: "loc_hallway",
          locationName: "Hành lang u tối",
          timeOfDay: "night",
          shots: [
            {
              shotId: "shot_step_left",
              shotType: "medium",
              durationSec: 3.5,
              visualPrompt: "Minh bước đi vội vã bên trái hành lang",
              beatIds: [],
              dialogues: [],
              sfxCue: {
                name: "footsteps_concrete",
                volume: 0.85,
                pan: -0.25,
                description: "Tiếng bước chân gấp gáp nện trên sàn bê tông",
              },
            },
          ],
        },
      ],
    });

    const result = await assembler.assembleEpisodeAudio({
      script,
      bible,
      outputDir: tmp,
      mockTts: false,
    });

    expect(result.stems.sfx).toBeDefined();
    expect(existsSync(result.stems.sfx)).toBe(true);
    expect(generatedCount).toBe(1);
    expect(result.unifiedTimeline.sfxTrack.length).toBe(1);
    expect(result.unifiedTimeline.sfxTrack[0].pan).toBe(-0.25);
  });
});
