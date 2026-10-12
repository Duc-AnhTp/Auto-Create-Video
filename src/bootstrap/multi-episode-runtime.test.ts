import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { MultiEpisodeRunner } from "./multi-episode-runtime.js";
import { SqliteStoryStore } from "./sqlite-story-store.js";
import { SeasonTrailerAutoCutter } from "../modules/media/application/season-trailer-auto-cutter.js";
import { UnifiedTimelineSchema } from "../contracts/timeline.js";

describe("MultiEpisodeRunner & Season Production Hardening", () => {
  const testOutputDir = join("data", "test_multi_ep_runner");

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

  it("instantiates cleanly and closes underlying SQLite Bible connection", () => {
    const runner = new MultiEpisodeRunner(":memory:");
    expect(runner.getBible()).toBeInstanceOf(SqliteStoryStore);

    // Verify explicit resource release doesn't throw
    expect(() => runner.close()).not.toThrow();
  });

  it("generates season trailer adhering strictly to UnifiedTimelineSchema", async () => {
    const candidateShots: import("../modules/media/application/season-trailer-auto-cutter.js").CandidateShot[] = [
      { shotId: "shot_act1_lead_cu", episodeNumber: 1, clipPath: "data/mock_clip1.mp4", sourceDurationSec: 4, shotType: "close_up", tensionScore: 0.7, dialogueSnippet: "Thời gian không còn nhiều.", speakerName: "Minh" },
      { shotId: "shot_act2_battle_wide", episodeNumber: 2, clipPath: "data/mock_clip2.mp4", sourceDurationSec: 5, shotType: "wide", tensionScore: 0.9 },
    ];

    const trailerRes = await SeasonTrailerAutoCutter.generateSeasonTrailer(candidateShots, {
      seriesId: "test_series_trailer",
      seriesTitle: "Chiến Binh Thời Gian",
      outputDir: testOutputDir,
      mockVideo: true,
      targetDurationSec: 30,
    });

    expect(trailerRes.trailerVideoPath).toBeTruthy();
    expect(trailerRes.timeline).toBeDefined();

    // Verify strict validation against UnifiedTimelineSchema
    const parsedTimeline = UnifiedTimelineSchema.parse(trailerRes.timeline);
    expect(parsedTimeline.seriesId).toBe("test_series_trailer");
    expect(parsedTimeline.episodeNumber).toBe(0);
    expect(parsedTimeline.videoTrack.length).toBeGreaterThan(0);
    expect(parsedTimeline.videoTrack[0].visualPrompt).toContain("Trailer cinematic shot");
    expect(parsedTimeline.videoTrack[0].durationFrames).toBeGreaterThan(0);
    expect(parsedTimeline.dialogueTrack.length).toBeGreaterThan(0);
    expect(parsedTimeline.dialogueTrack[0].dialogueId).toBe("diag_shot_act1_lead_cu");
    expect(parsedTimeline.sfxTrack.length).toBe(trailerRes.cuts.filter((cut) => cut.audioHit).length);
    const firstSfxCut = trailerRes.cuts.find((cut) => cut.audioHit);
    expect(parsedTimeline.sfxTrack[0].cueId).toBe(`sfx_${firstSfxCut?.audioHit}_${firstSfxCut?.shotId}`);
    expect(parsedTimeline.ambienceTrack.length).toBe(1);
    expect(parsedTimeline.ambienceTrack[0].cueId).toBe("amb_trailer_bed");
    expect(parsedTimeline.bgmTrack).toBeDefined();
    expect(parsedTimeline.bgmTrack?.durationSec).toBe(30);
    expect(parsedTimeline.subtitleTrack.length).toBe(parsedTimeline.dialogueTrack.length);
    expect(parsedTimeline.subtitleTrack[0].dialogueId).toBe("diag_shot_act1_lead_cu");
  });
});
