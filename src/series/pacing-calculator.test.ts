import { describe, it, expect } from "vitest";
import { DynamicPacingCalculator } from "./pacing-calculator.js";
import type { EpisodicScript, Scene, Shot } from "./series-schema.js";

function makeScene(opts: Partial<Scene> & { sceneId: string; sceneNumber: number; locationId: string; locationName: string; shots: Shot[] }): Scene {
  return {
    timeOfDay: "night",
    charactersPresent: [],
    propsPresent: [],
    beatIds: [],
    ...opts,
  };
}

function makeScript(opts: Partial<EpisodicScript> & { seriesId: string; episodeNumber: number; scenes: Scene[] }): EpisodicScript {
  return {
    schemaVersion: "2.0.0",
    version: "2.0.0",
    title: "Tập phim",
    logline: "Tóm tắt",
    aspectRatio: "9:16",
    fps: 30,
    unresolvedCharacters: [],
    ...opts,
  };
}

describe("DynamicPacingCalculator (Giai Đoạn 2: Visual Pacing)", () => {
  it("calculates average shot duration (ASD) and cuts-per-minute (CPM) accurately", () => {
    const mockScript: EpisodicScript = makeScript({
      seriesId: "series_action",
      episodeNumber: 1,
      title: "Cuộc Truy Đuổi",
      aspectRatio: "9:16",
      fps: 30,
      scenes: [
        makeScene({
          sceneId: "sc01",
          sceneNumber: 1,
          locationId: "loc_bridge",
          locationName: "Cầu Mống",
          shots: [
            { shotId: "sh01", shotType: "establishing", durationSec: 4.0, visualPrompt: "Toàn cảnh cầu", dialogues: [], beatIds: [] },
            { shotId: "sh02", shotType: "action", durationSec: 2.0, visualPrompt: "Xe phóng nhanh", dialogues: [], beatIds: [] },
            { shotId: "sh03", shotType: "close_up", durationSec: 2.0, visualPrompt: "Gương mặt căng thẳng", dialogues: [], beatIds: [] },
            { shotId: "sh04", shotType: "action", durationSec: 2.0, visualPrompt: "Phanh gấp tóe lửa", dialogues: [], beatIds: [] },
          ],
        }),
      ],
    });

    const report = DynamicPacingCalculator.analyzeScriptPacing(mockScript);

    expect(report.totalShots).toBe(4);
    expect(report.totalDurationSec).toBe(10.0);
    // ASD = 10 / 4 = 2.5s
    expect(report.overallAverageShotDurationSec).toBe(2.5);
    // CPM = 4 shots / (10s / 60) = 24 cuts/minute
    expect(report.overallCutsPerMinute).toBe(24.0);
    expect(report.sceneMetrics[0].pacingCategory).toBe("rapid_action");
  });

  it("classifies atmospheric slow scenes when ASD is long and cuts are sparse", () => {
    const mockScript: EpisodicScript = makeScript({
      seriesId: "series_drama",
      episodeNumber: 1,
      title: "Mưa Đêm",
      aspectRatio: "16:9",
      fps: 30,
      scenes: [
        makeScene({
          sceneId: "sc01",
          sceneNumber: 1,
          locationId: "loc_room",
          locationName: "Căn phòng tĩnh mịch",
          mood: "yên ả thanh bình",
          shots: [
            { shotId: "sh01", shotType: "wide", durationSec: 5.5, visualPrompt: "Căn phòng tối", dialogues: [], beatIds: [] },
            { shotId: "sh02", shotType: "establishing", durationSec: 5.0, visualPrompt: "Mưa rơi ngoài cửa sổ", dialogues: [], beatIds: [] },
          ],
        }),
      ],
    });

    const report = DynamicPacingCalculator.analyzeScriptPacing(mockScript);

    expect(report.totalDurationSec).toBe(10.5);
    expect(report.overallAverageShotDurationSec).toBe(5.25);
    expect(report.sceneMetrics[0].pacingCategory).toBe("atmospheric_slow");
  });

  it("emits pacing mismatch warnings when high-tension climax has overly sluggish shot lengths", () => {
    const mockScript: EpisodicScript = makeScript({
      seriesId: "series_thriller",
      episodeNumber: 1,
      title: "Phút Sinh Tử",
      aspectRatio: "9:16",
      fps: 30,
      scenes: [
        makeScene({
          sceneId: "sc01",
          sceneNumber: 1,
          locationId: "loc_intro",
          locationName: "Văn phòng thám tử",
          shots: [{ shotId: "sh01", shotType: "medium", durationSec: 3.5, visualPrompt: "...", dialogues: [], beatIds: [] }],
        }),
        makeScene({
          sceneId: "sc02",
          sceneNumber: 2,
          locationId: "loc_roof",
          locationName: "Sân thượng nghìn trượng",
          mood: "chiến đấu sống còn nguy hiểm cao trào",
          shots: [
            // Sluggish 6-second shots in a climax action scene
            { shotId: "sh02_01", shotType: "action", durationSec: 6.0, visualPrompt: "Đấu kiếm", dialogues: [], beatIds: [] },
            { shotId: "sh02_02", shotType: "close_up", durationSec: 5.5, visualPrompt: "Máu rơi", dialogues: [], beatIds: [] },
          ],
        }),
      ],
    });

    const report = DynamicPacingCalculator.analyzeScriptPacing(mockScript);

    expect(report.warnings.length).toBeGreaterThan(0);
    expect(report.warnings[0]).toContain("mang tính chất cao trào");
    expect(report.warnings[0]).toContain("quá dài");
  });

  it("calculates Pacing Dynamism Score showing contrast between calm setup and intense climax", () => {
    const dynamicScript: EpisodicScript = makeScript({
      seriesId: "series_rollercoaster",
      episodeNumber: 1,
      title: "Cao Trào và Khoảng Lặng",
      aspectRatio: "9:16",
      fps: 30,
      scenes: [
        makeScene({
          sceneId: "sc01",
          sceneNumber: 1,
          locationId: "loc_quiet",
          locationName: "Khu vườn yên ả",
          mood: "yên ả thanh bình nghỉ ngơi",
          shots: [
            { shotId: "sh01", shotType: "wide", durationSec: 4.5, visualPrompt: "...", dialogues: [], beatIds: [] },
          ],
        }),
        makeScene({
          sceneId: "sc02",
          sceneNumber: 2,
          locationId: "loc_fight",
          locationName: "Đấu trường rực lửa",
          mood: "chiến đấu bùng nổ xung đột crisis",
          shots: [
            { shotId: "sh02", shotType: "action", durationSec: 2.0, visualPrompt: "...", dialogues: [], beatIds: [] },
            { shotId: "sh03", shotType: "close_up", durationSec: 2.0, visualPrompt: "...", dialogues: [], beatIds: [] },
          ],
        }),
      ],
    });

    const report = DynamicPacingCalculator.analyzeScriptPacing(dynamicScript);
    expect(report.pacingDynamismScore).toBeGreaterThan(0.4);
  });
});
