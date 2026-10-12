import { describe, it, expect } from "vitest";
import { ColorMatcher, type AscCdl } from "./color-matcher.js";

describe("Phase 3: Multi-Shot ASC CDL Color Grading & Lighting Harmonization", () => {
  it("converts standard ASC CDL to FFmpeg filter chain", () => {
    const cdl: AscCdl = {
      slope: [1.1, 1.1, 1.1],
      offset: [0.02, 0.01, -0.01],
      power: [0.95, 0.95, 0.95],
      saturation: 1.05,
    };

    const filter = ColorMatcher.cdlToFfmpegFilter(cdl);
    expect(filter).toContain("eq=contrast=1.10");
    expect(filter).toContain("saturation=1.05");
    expect(filter).toContain("colorbalance=rs=0.020:gs=0.010:bs=-0.010");
  });

  it("exports valid ASC CDL XML compatible with DaVinci Resolve", () => {
    const cdl: AscCdl = {
      slope: [1.05, 1.0, 0.95],
      offset: [0.0, 0.005, -0.005],
      power: [1.0, 1.0, 1.0],
      saturation: 1.08,
    };

    const xml = ColorMatcher.exportCdlXml(cdl, "shot_01");
    expect(xml).toContain('<ColorCorrection id="shot_01">');
    expect(xml).toContain("<Slope>1.0500 1.0000 0.9500</Slope>");
    expect(xml).toContain("<Offset>0.0000 0.0050 -0.0050</Offset>");
    expect(xml).toContain("<Saturation>1.0800</Saturation>");
  });

  it("harmonizes reverse shots (OTS and Close-Up) against scene Master Two-Shot", () => {
    const masterCdl: AscCdl = {
      slope: [1.0, 1.0, 1.0],
      offset: [0.0, 0.0, 0.0],
      power: [1.0, 1.0, 1.0],
      saturation: 1.0,
    };

    const closeUpCdl = ColorMatcher.harmonizeReverseShots(masterCdl, "close_up");
    expect(closeUpCdl.slope[0]).toBeGreaterThan(masterCdl.slope[0]); // facial highlight lift
    expect(closeUpCdl.saturation).toBeGreaterThan(masterCdl.saturation);

    const reverseOtsCdl = ColorMatcher.harmonizeReverseShots(masterCdl, "ots_b_a");
    expect(reverseOtsCdl.offset[0]).toBeLessThan(masterCdl.offset[0]); // reverse key-to-fill compensation
  });

  it("harmonizes entire scene shots generating color profiles with CDLs", () => {
    const profiles = ColorMatcher.harmonizeSceneShots("scene_01", ["shot_1", "shot_2", "shot_3", "shot_4", "shot_5"]);
    expect(profiles.length).toBe(5);
    expect(profiles[0].isSceneMaster).toBe(true);
    expect(profiles[1].isSceneMaster).toBe(false);
    expect(profiles[4].cdl.slope[0]).toBeGreaterThan(profiles[0].cdl.slope[0]); // Shot 5 is close-up
  });
});
