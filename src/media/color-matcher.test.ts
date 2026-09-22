import { describe, it, expect } from "vitest";
import { ColorMatcher } from "./color-matcher.js";

describe("ColorMatcher", () => {
  it("builds default cinematic color filter string", () => {
    const filter = ColorMatcher.buildShotColorFilter("shot_01", "scene_01", 0, {
      contrast: 1.1,
      saturation: 1.05,
      temperatureShift: 0.2,
    });

    expect(filter).toContain("eq=contrast=1.10:saturation=1.05");
    expect(filter).toContain("colorbalance=");
  });

  it("harmonizes all shots in a scene designating the first shot as scene master", () => {
    const sceneShots = ["shot_01", "shot_02", "shot_03"];
    const profiles = ColorMatcher.harmonizeSceneShots("scene_kitchen", sceneShots);

    expect(profiles).toHaveLength(3);
    expect(profiles[0].isSceneMaster).toBe(true);
    expect(profiles[1].isSceneMaster).toBe(false);
    expect(profiles[2].isSceneMaster).toBe(false);
    expect(profiles[0].filterGraphString).toContain("eq=contrast=1.05");
  });
});
