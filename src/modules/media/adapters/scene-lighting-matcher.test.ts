import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  HistogramEngine,
  ColorTemperatureEngine,
  DepthRelightingEngine,
  SceneLightingMatcher,
  type SceneHarmonizationInput,
} from "./scene-lighting-matcher.js";

describe("Option 3: Advanced Scene-to-Scene Visual Style Transfer & Lighting Matcher", () => {
  const testOutputDir = join("data", "test_lighting_matcher_output");

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

  describe("1. HistogramEngine: CDF Matching & ASC CDL Derivation", () => {
    it("should compute monotonically increasing normalized CDF from 0.0 to 1.0", () => {
      const hist = HistogramEngine.generateSyntheticHistogram(128, 40);
      const cdf = HistogramEngine.computeCdf(hist.luma);

      expect(cdf.length).toBe(256);
      expect(cdf[0]).toBeGreaterThanOrEqual(0.0);
      expect(cdf[255]).toBeCloseTo(1.0, 2);

      // Verify monotonicity
      for (let i = 1; i < 256; i++) {
        expect(cdf[i]).toBeGreaterThanOrEqual(cdf[i - 1]);
      }
    });

    it("should compute inverse CDF mapping table for target-to-reference matching", () => {
      const refHist = HistogramEngine.generateSyntheticHistogram(150, 35); // Brighter reference
      const targetHist = HistogramEngine.generateSyntheticHistogram(100, 35); // Darker target

      const refCdf = HistogramEngine.computeCdf(refHist.luma);
      const targetCdf = HistogramEngine.computeCdf(targetHist.luma);

      const lut = HistogramEngine.matchCdf(targetCdf, refCdf);
      expect(lut.length).toBe(256);

      // Because reference is brighter, middle values should be mapped to higher values
      expect(lut[100]).toBeGreaterThanOrEqual(100);
    });

    it("should calculate Wasserstein distance between two distributions", () => {
      const histA = HistogramEngine.generateSyntheticHistogram(120, 30);
      const histB = HistogramEngine.generateSyntheticHistogram(160, 30);

      const cdfA = HistogramEngine.computeCdf(histA.luma);
      const cdfB = HistogramEngine.computeCdf(histB.luma);

      const dist = HistogramEngine.calculateWassersteinDistance(cdfA, cdfB);
      expect(dist).toBeGreaterThan(0.05);

      // Same distribution should have 0 distance
      const distSelf = HistogramEngine.calculateWassersteinDistance(cdfA, cdfA);
      expect(distSelf).toBe(0.0);
    });

    it("should derive cinematic ASC CDL parameters within standard legal bounds", () => {
      const refHist = HistogramEngine.generateSyntheticHistogram(140, 45);
      const targetHist = HistogramEngine.generateSyntheticHistogram(110, 38);

      const cdl = HistogramEngine.deriveAscCdl(refHist, targetHist);

      expect(cdl.slope[0]).toBeGreaterThan(1.0); // Gain increase
      expect(cdl.offset[0]).toBeGreaterThan(-0.15);
      expect(cdl.offset[0]).toBeLessThan(0.15);
      expect(cdl.power[0]).toBeGreaterThan(0.7);
      expect(cdl.power[0]).toBeLessThan(1.3);
      expect(cdl.saturation).toBeGreaterThan(0.7);
      expect(cdl.saturation).toBeLessThan(1.3);
    });

    it("should generate FFmpeg curves filter string", () => {
      const table = Array.from({ length: 256 }, (_, i) => Math.min(255, Math.round(i * 1.1)));
      const curves = HistogramEngine.generateCurvesFilter(table, table, table);

      expect(curves).toContain("curves=r='");
      expect(curves).toContain("':g='");
      expect(curves).toContain("':b='");
      expect(curves).toContain("0.00/0.00");
    });
  });

  describe("2. ColorTemperatureEngine: Kelvin Estimation & White Balance", () => {
    it("should estimate Correlated Color Temperature (CCT) from RGB ratios", () => {
      // Warm tungsten (more red, less blue)
      const warm = ColorTemperatureEngine.estimateCctFromRgb(210, 140, 70);
      expect(warm.cctKelvin).toBeLessThan(3800);
      expect(warm.dominantWarmth).toBe("warm_tungsten");

      // Golden hour
      const golden = ColorTemperatureEngine.estimateCctFromRgb(200, 160, 110);
      expect(golden.cctKelvin).toBeGreaterThan(3200);
      expect(golden.cctKelvin).toBeLessThan(5000);

      // Neutral daylight (balanced)
      const daylight = ColorTemperatureEngine.estimateCctFromRgb(150, 150, 150);
      expect(daylight.cctKelvin).toBeGreaterThan(5000);
      expect(daylight.cctKelvin).toBeLessThan(6500);

      // Cool overcast / deep shade (more blue, less red)
      const cool = ColorTemperatureEngine.estimateCctFromRgb(90, 130, 210);
      expect(cool.cctKelvin).toBeGreaterThan(6800);
      expect(cool.dominantWarmth).toMatch(/overcast_cool|deep_shade/);
    });

    it("should calculate warming adjustment for a cold target shot", () => {
      const sourceCold = {
        cctKelvin: 6800,
        tintFactor: 0.0,
        dominantWarmth: "overcast_cool" as const,
        chromaticityX: 0.28,
        chromaticityY: 0.30,
      };
      const refWarm = {
        cctKelvin: 4500,
        tintFactor: 0.0,
        dominantWarmth: "golden_hour" as const,
        chromaticityX: 0.38,
        chromaticityY: 0.36,
      };

      const adj = ColorTemperatureEngine.calculateCctAdjustment(sourceCold, refWarm);

      // Delta is -2300K (reference is warmer than cold source) -> source needs warming (slopeR increased, slopeB decreased)
      expect(adj.slopeCorrection[0]).toBeGreaterThan(1.0); // Warming factor: Red increased
      expect(adj.slopeCorrection[2]).toBeLessThan(1.0); // Warming factor: Blue decreased
      expect(adj.temperatureFilterGraph).toContain("colorbalance=");
    });
  });

  describe("3. DepthRelightingEngine: Normals, Key Light & Fresnel Rim Shading", () => {
    it("should compute correct 3D light direction vector from azimuth and elevation", () => {
      // 0° azimuth, 0° elevation -> pointing straight into screen [0, 0, 1]
      const front = DepthRelightingEngine.vectorFromAngles(0, 0);
      expect(front[0]).toBeCloseTo(0.0, 2);
      expect(front[1]).toBeCloseTo(0.0, 2);
      expect(front[2]).toBeCloseTo(1.0, 2);

      // 90° azimuth -> pointing from right to left [1, 0, 0]
      const right = DepthRelightingEngine.vectorFromAngles(90, 0);
      expect(right[0]).toBeCloseTo(1.0, 2);
      expect(right[2]).toBeCloseTo(0.0, 2);

      // -90° azimuth -> pointing from left to right [-1, 0, 0]
      const left = DepthRelightingEngine.vectorFromAngles(-90, 0);
      expect(left[0]).toBeCloseTo(-1.0, 2);
    });

    it("should compute surface normal from depth gradient", () => {
      // Flat surface: left = right = up = down
      const flat = DepthRelightingEngine.computeNormalAtPoint(0.5, 0.5, 0.5, 0.5);
      expect(flat[0]).toBeCloseTo(0.0, 2);
      expect(flat[1]).toBeCloseTo(0.0, 2);
      expect(flat[2]).toBeCloseTo(1.0, 2);

      // Sloping right: right depth is deeper (larger) than left
      const slope = DepthRelightingEngine.computeNormalAtPoint(0.3, 0.7, 0.5, 0.5);
      expect(slope[0]).toBeLessThan(0.0); // Normal points to the left
    });

    it("should compute Lambertian diffuse + ambient + Fresnel rim lighting multiplier", () => {
      const config = {
        keyLight: {
          azimuthDeg: 45,
          elevationDeg: 30,
          intensity: 1.2,
          color: [1.1, 1.0, 0.85] as [number, number, number],
          cctKelvin: 4800,
          vector3D: DepthRelightingEngine.vectorFromAngles(45, 30),
        },
        ambient: {
          skyAmbient: [0.6, 0.7, 0.8] as [number, number, number],
          groundBounce: [0.4, 0.3, 0.2] as [number, number, number],
          rimLightIntensity: 0.9,
          rimLightColor: [1.2, 1.0, 0.7] as [number, number, number],
          rimPower: 3.0,
        },
        depthScale: 3.5,
        foregroundWeight: 0.8,
        enableRimLight: true,
        enableAmbientBounce: true,
      };

      // Direct facing surface
      const normalFacing: [number, number, number] = [0, 0, 1];
      const multFacing = DepthRelightingEngine.computeShadingMultiplier(normalFacing, config);
      expect(multFacing).toBeGreaterThan(0.5);

      // Grazing edge surface (nz near 0 -> high rim light)
      const normalEdge: [number, number, number] = [0.95, 0, 0.1];
      const multEdge = DepthRelightingEngine.computeShadingMultiplier(normalEdge, config);
      expect(multEdge).toBeGreaterThan(0.1);
    });

    it("should generate ComfyUI prompt directives for depth lighting conditioning", () => {
      const config = {
        keyLight: {
          azimuthDeg: -60,
          elevationDeg: 25,
          intensity: 1.3,
          color: [1.0, 1.0, 1.0] as [number, number, number],
          cctKelvin: 3200,
          vector3D: DepthRelightingEngine.vectorFromAngles(-60, 25),
        },
        ambient: {
          skyAmbient: [0.5, 0.5, 0.5] as [number, number, number],
          groundBounce: [0.3, 0.3, 0.3] as [number, number, number],
          rimLightIntensity: 0.8,
          rimLightColor: [1.0, 1.0, 1.0] as [number, number, number],
          rimPower: 3.0,
        },
        depthScale: 3.5,
        foregroundWeight: 0.8,
        enableRimLight: true,
        enableAmbientBounce: true,
      };

      const directives = DepthRelightingEngine.generateComfyUiPromptDirectives(config);
      expect(directives.promptModifiers.some((p) => p.includes("camera left"))).toBe(true);
      expect(directives.promptModifiers.some((p) => p.includes("3200K"))).toBe(true);
      expect(directives.controlNetDepthWeight).toBe(0.85);
    });
  });

  describe("4. SceneLightingMatcher: Multi-Shot Scene Harmonization", () => {
    it("should harmonize a 5-shot cinematic scene against Master Establishing shot", () => {
      const sceneInput: SceneHarmonizationInput = {
        sceneId: "scene_rooftop_sunset",
        targetEnvironmentPreset: "golden_hour",
        shots: [
          {
            shotId: "shot_1_wide",
            shotType: "establishing",
            averageRgb: [180, 140, 95], // Master warm golden reference
          },
          {
            shotId: "shot_2_two_shot",
            shotType: "two_shot",
            averageRgb: [175, 138, 98],
          },
          {
            shotId: "shot_3_ots_ab",
            shotType: "ots_a_b",
            averageRgb: [165, 145, 120], // Drifting cooler
          },
          {
            shotId: "shot_4_ots_ba",
            shotType: "ots_b_a",
            averageRgb: [170, 142, 115], // Reverse angle
          },
          {
            shotId: "shot_5_close_up",
            shotType: "close_up",
            averageRgb: [160, 130, 90], // Hero close-up
          },
        ],
      };

      const result = SceneLightingMatcher.harmonizeScene(sceneInput);

      expect(result.sceneId).toBe("scene_rooftop_sunset");
      expect(result.masterShotId).toBe("shot_1_wide");
      expect(result.profiles.length).toBe(5);
      expect(result.sceneConsistencyScore).toBeGreaterThan(0.85);

      // Verify Master Shot profile
      const masterProfile = result.profiles[0];
      expect(masterProfile.isSceneMaster).toBe(true);
      expect(masterProfile.cctDeltaKelvin).toBe(0);
      expect(masterProfile.confidenceScore).toBe(1.0);

      // Verify Reverse Angle (OTS B->A) light mirroring
      const otsBaProfile = result.profiles.find((p) => p.shotType === "ots_b_a");
      expect(otsBaProfile).toBeDefined();
      expect(otsBaProfile?.relightingConfig.keyLight.azimuthDeg).toBe(
        -result.masterLighting.azimuthDeg
      );

      // Verify Close-Up Portrait Lift
      const closeUpProfile = result.profiles.find((p) => p.shotType === "close_up");
      expect(closeUpProfile).toBeDefined();
      expect(closeUpProfile?.cdlCorrection.slope[0]).toBeGreaterThan(1.0); // Highlight lift
      expect(closeUpProfile?.cdlCorrection.saturation).toBeGreaterThan(1.0);

      // Verify DaVinci Resolve CDL XML Manifest
      expect(result.davinciCdlManifestXml).toContain("<ColorDecisionList");
      expect(result.davinciCdlManifestXml).toContain('<ColorCorrection id="shot_1_wide">');
      expect(result.davinciCdlManifestXml).toContain('<ColorCorrection id="shot_5_close_up">');
      expect(result.davinciCdlManifestXml).toContain("<Slope>");
      expect(result.davinciCdlManifestXml).toContain("<Offset>");
      expect(result.davinciCdlManifestXml).toContain("<Power>");
      expect(result.davinciCdlManifestXml).toContain("<Saturation>");
    });

    it("should apply harmonization video filter via mock engine", async () => {
      const sceneInput: SceneHarmonizationInput = {
        sceneId: "scene_01",
        shots: [
          { shotId: "shot_01", shotType: "establishing" },
          { shotId: "shot_02", shotType: "close_up" },
        ],
      };

      const result = SceneLightingMatcher.harmonizeScene(sceneInput);
      const outPath = join(testOutputDir, "shot_02_harmonized.mp4");

      const savedPath = await SceneLightingMatcher.applyHarmonizationToVideo(
        "dummy_input.mp4",
        outPath,
        result.profiles[1],
        { mockFallback: true }
      );

      expect(existsSync(savedPath)).toBe(true);
    });
  });
});
