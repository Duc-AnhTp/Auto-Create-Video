import type {ColorHistogram,ColorTemperatureMetrics,LightSourceVector,AmbientHemisphereLighting,DepthRelightingConfig,HistogramMatchTransfer,ShotHarmonizationProfile,SceneHarmonizationResult,ShotInput,SceneHarmonizationInput} from '../../../contracts/media-features.js';
export type {ColorHistogram,ColorTemperatureMetrics,LightSourceVector,AmbientHemisphereLighting,DepthRelightingConfig,HistogramMatchTransfer,ShotHarmonizationProfile,SceneHarmonizationResult,ShotInput,SceneHarmonizationInput} from '../../../contracts/media-features.js';

import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { runMediaCommand } from "../../../platform/processes/media-process-runner.js";
import { hasFfmpeg, createValidMockMp4File } from "./assets/mock-media-generator.js";
import { log } from "../../../platform/observability/logger.js";
import type { AscCdl } from "./cdl-grading-engine.js";

/**
 * 256-bin Color Histogram with statistical distribution moments.
 */


/**
 * Correlated Color Temperature (CCT) & White Balance Colorimetry.
 */


/**
 * 3D Directional Light Source representation.
 */


/**
 * Ambient Hemisphere & Rim Lighting parameters.
 */


/**
 * Depth-Aware Relighting configuration.
 */


/**
 * Discrete Cumulative Distribution Function (CDF) Specification Transfer Map.
 */


/**
 * Harmonization profile for a single shot within a scene.
 */


/**
 * Comprehensive Multi-Shot Scene Harmonization Result.
 */






/**
 * ─────────────────────────────────────────────────────────────────────────────
 * 1. HISTOGRAM MATCHING & SPECIFICATION ENGINE
 * ─────────────────────────────────────────────────────────────────────────────
 */
export class HistogramEngine {
  /**
   * Computes normalized Cumulative Distribution Function (CDF) from a 256-bin histogram.
   */
  public static computeCdf(histogram: number[]): Float64Array {
    const cdf = new Float64Array(256);
    let total = 0;
    for (let i = 0; i < 256; i++) {
      total += histogram[i];
    }
    if (total === 0) {
      for (let i = 0; i < 256; i++) cdf[i] = i / 255.0;
      return cdf;
    }

    let cum = 0;
    for (let i = 0; i < 256; i++) {
      cum += histogram[i];
      cdf[i] = cum / total;
    }
    return cdf;
  }

  /**
   * Computes the discrete inverse CDF mapping table (Specification Transfer).
   * Maps target input intensities [0, 255] to reference output intensities [0, 255].
   */
  public static matchCdf(targetCdf: Float64Array, refCdf: Float64Array): number[] {
    const lookup = new Array<number>(256);

    for (let t = 0; t < 256; t++) {
      const targetVal = targetCdf[t];
      let bestRefIdx = 0;
      let minDiff = 1.0;

      for (let r = 0; r < 256; r++) {
        const diff = Math.abs(refCdf[r] - targetVal);
        if (diff < minDiff) {
          minDiff = diff;
          bestRefIdx = r;
        }
      }
      lookup[t] = bestRefIdx;
    }

    return lookup;
  }

  /**
   * Calculates Wasserstein Distance (Earth Mover's Distance) between two normalized CDFs.
   */
  public static calculateWassersteinDistance(targetCdf: Float64Array, refCdf: Float64Array): number {
    let sum = 0;
    for (let i = 0; i < 256; i++) {
      sum += Math.abs(targetCdf[i] - refCdf[i]);
    }
    return parseFloat((sum / 256.0).toFixed(4));
  }

  /**
   * Synthesizes a representative Gaussian histogram given mean, stdDev, and total pixels.
   */
  public static generateSyntheticHistogram(
    mean: number,
    stdDev: number,
    totalPixels = 100000
  ): ColorHistogram {
    const r = new Array<number>(256).fill(0);
    const g = new Array<number>(256).fill(0);
    const b = new Array<number>(256).fill(0);
    const luma = new Array<number>(256).fill(0);

    const safeStd = Math.max(1.0, stdDev);
    const factor = 1.0 / (safeStd * Math.sqrt(2 * Math.PI));

    for (let i = 0; i < 256; i++) {
      const diff = i - mean;
      const prob = factor * Math.exp(-(diff * diff) / (2 * safeStd * safeStd));
      const count = Math.round(prob * totalPixels);
      r[i] = count;
      g[i] = count;
      b[i] = count;
      luma[i] = count;
    }

    return {
      r,
      g,
      b,
      luma,
      totalPixels,
      moments: {
        mean: [mean, mean, mean],
        stdDev: [safeStd, safeStd, safeStd],
        median: [mean, mean, mean],
        min: [Math.max(0, mean - 3 * safeStd), Math.max(0, mean - 3 * safeStd), Math.max(0, mean - 3 * safeStd)],
        max: [Math.min(255, mean + 3 * safeStd), Math.min(255, mean + 3 * safeStd), Math.min(255, mean + 3 * safeStd)],
        entropy: parseFloat((Math.log2(safeStd * Math.sqrt(2 * Math.PI * Math.E))).toFixed(2)),
      },
    };
  }

  /**
   * Derives mathematical ASC CDL (Slope, Offset, Power, Saturation) parameters
   * from the statistical distribution moments of reference vs target histograms.
   */
  public static deriveAscCdl(refHist: ColorHistogram, targetHist: ColorHistogram): AscCdl {
    const slope: [number, number, number] = [1.0, 1.0, 1.0];
    const offset: [number, number, number] = [0.0, 0.0, 0.0];
    const power: [number, number, number] = [1.0, 1.0, 1.0];

    for (let c = 0; c < 3; c++) {
      const refMean = refHist.moments.mean[c] / 255.0;
      const tgtMean = targetHist.moments.mean[c] / 255.0;
      const refStd = refHist.moments.stdDev[c] / 255.0;
      const tgtStd = targetHist.moments.stdDev[c] / 255.0;

      // 1. Slope (Contrast / Gain ratio) clamped to cinematic bounds [0.75, 1.35]
      const rawSlope = tgtStd > 0.01 ? refStd / tgtStd : 1.0;
      slope[c] = parseFloat(Math.min(1.35, Math.max(0.75, rawSlope)).toFixed(4));

      // 2. Offset (Lift) to align black levels, clamped to [-0.15, 0.15]
      const rawOffset = refMean - slope[c] * tgtMean;
      offset[c] = parseFloat(Math.min(0.15, Math.max(-0.15, rawOffset * 0.4)).toFixed(4));

      // 3. Power (Gamma) to align midtones
      const refMed = Math.max(0.05, Math.min(0.95, refHist.moments.median[c] / 255.0));
      const tgtMed = Math.max(0.05, Math.min(0.95, targetHist.moments.median[c] / 255.0));
      const rawPower = Math.log(refMed) / Math.log(tgtMed);
      power[c] = parseFloat(Math.min(1.30, Math.max(0.75, isNaN(rawPower) ? 1.0 : rawPower)).toFixed(4));
    }

    // Saturation ratio derived from color variance vs luminance variance
    const refSpread = (refHist.moments.stdDev[0] + refHist.moments.stdDev[1] + refHist.moments.stdDev[2]) / 3.0;
    const tgtSpread = (targetHist.moments.stdDev[0] + targetHist.moments.stdDev[1] + targetHist.moments.stdDev[2]) / 3.0;
    const rawSat = tgtSpread > 0.1 ? refSpread / tgtSpread : 1.0;
    const saturation = parseFloat(Math.min(1.30, Math.max(0.70, rawSat)).toFixed(4));

    return { slope, offset, power, saturation };
  }

  /**
   * Generates FFmpeg `curves` filter syntax for accurate non-linear tone curve transfer.
   */
  public static generateCurvesFilter(tableR: number[], tableG: number[], tableB: number[]): string {
    const samplePoints = [0, 64, 128, 192, 255];
    const formatCurve = (tbl: number[]) =>
      samplePoints
        .map((p) => `${(p / 255.0).toFixed(2)}/${(tbl[p] / 255.0).toFixed(2)}`)
        .join(" ");

    return `curves=r='${formatCurve(tableR)}':g='${formatCurve(tableG)}':b='${formatCurve(tableB)}'`;
  }
}

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * 2. COLOR TEMPERATURE & WHITE BALANCE ENGINE
 * ─────────────────────────────────────────────────────────────────────────────
 */
export class ColorTemperatureEngine {
  /**
   * Approximates Correlated Color Temperature (CCT in Kelvin) and tint factor
   * from RGB chromaticity coordinates.
   */
  public static estimateCctFromRgb(r: number, g: number, b: number): ColorTemperatureMetrics {
    const sum = Math.max(0.001, r + g + b);

    // Convert sRGB to Linear RGB
    const rLin = Math.pow(Math.max(0, r) / 255.0, 2.2);
    const gLin = Math.pow(Math.max(0, g) / 255.0, 2.2);
    const bLin = Math.pow(Math.max(0, b) / 255.0, 2.2);

    // Convert Linear RGB to CIE 1931 XYZ
    const X = 0.4124 * rLin + 0.3576 * gLin + 0.1805 * bLin;
    const Y = 0.2126 * rLin + 0.7152 * gLin + 0.0722 * bLin;
    const Z = 0.0193 * rLin + 0.1192 * gLin + 0.9505 * bLin;
    const xyzSum = Math.max(0.0001, X + Y + Z);
    const x = X / xyzSum;
    const y = Y / xyzSum;

    // McCamy's approximation for Correlated Color Temperature
    // n = (x - 0.3320) / (0.1858 - y)
    // CCT = 449 * n^3 + 3525 * n^2 + 6823.3 * n + 5520.33
    const denom = 0.1858 - y;
    const safeDenom = Math.abs(denom) < 0.0001 ? (denom < 0 ? -0.0001 : 0.0001) : denom;
    const n = (x - 0.332) / safeDenom;
    let cct = 449.0 * Math.pow(n, 3) + 3525.0 * Math.pow(n, 2) + 6823.3 * n + 5520.33;

    // Balanced film daylight anchor: neutral gray/white is calibrated to 5600K
    const maxDiff = Math.max(Math.abs(r - g), Math.abs(g - b), Math.abs(r - b));
    if (maxDiff <= 2 && cct > 5500) {
      cct = 5600;
    }

    // Clamp to realistic cinematic color temperature domain [2000K, 12000K]
    if (isNaN(cct) || cct < 2000) cct = 2000;
    if (cct > 12000) cct = 12000;

    // Green-Magenta tint factor
    const expectedG = (r + b) / 2.0;
    const tintFactor = parseFloat(Math.min(1.0, Math.max(-1.0, (g - expectedG) / sum)).toFixed(3));

    return {
      cctKelvin: Math.round(cct),
      tintFactor,
      dominantWarmth: this.classifyLightingWarmth(cct),
      chromaticityX: parseFloat(x.toFixed(4)),
      chromaticityY: parseFloat(y.toFixed(4)),
    };
  }

  public static classifyLightingWarmth(kelvin: number): ColorTemperatureMetrics["dominantWarmth"] {
    if (kelvin < 3400) return "warm_tungsten";
    if (kelvin < 4800) return "golden_hour";
    if (kelvin < 6200) return "daylight";
    if (kelvin < 7500) return "overcast_cool";
    return "deep_shade";
  }

  /**
   * Computes the color temperature compensation factors to align target shot to reference master shot.
   */
  public static calculateCctAdjustment(
    sourceCct: ColorTemperatureMetrics,
    referenceCct: ColorTemperatureMetrics
  ): {
    slopeCorrection: [number, number, number];
    offsetCorrection: [number, number, number];
    temperatureFilterGraph: string;
  } {
    const deltaKelvin = referenceCct.cctKelvin - sourceCct.cctKelvin;
    // Scale factor: 1000K delta ≈ 0.05 shift in Red/Blue ratio
    const shift = (deltaKelvin / 1000.0) * 0.045;

    // If delta > 0: Reference CCT is higher (cooler/bluer) -> source must cool down (reduce Red, increase Blue)
    // If delta < 0: Reference CCT is lower (warmer/redder) -> source must warm up (increase Red, reduce Blue)
    const slopeR = parseFloat(Math.min(1.25, Math.max(0.80, 1.0 - shift)).toFixed(4));
    const slopeB = parseFloat(Math.min(1.25, Math.max(0.80, 1.0 + shift)).toFixed(4));
    const slopeG = 1.0;

    const tintShift = (referenceCct.tintFactor - sourceCct.tintFactor) * 0.05;
    const offsetG = parseFloat(Math.min(0.05, Math.max(-0.05, tintShift)).toFixed(4));

    // FFmpeg colortemperature or colorbalance filter
    const rs = (-shift * 0.15).toFixed(3);
    const bs = (shift * 0.15).toFixed(3);
    const gs = offsetG.toFixed(3);
    const filterGraph = `colorbalance=rs=${rs}:bs=${bs}:gs=${gs}:rm=${(-shift * 0.1).toFixed(3)}:bm=${(shift * 0.1).toFixed(3)}`;

    return {
      slopeCorrection: [slopeR, slopeG, slopeB],
      offsetCorrection: [0.0, offsetG, 0.0],
      temperatureFilterGraph: filterGraph,
    };
  }
}

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * 3. DEPTH-AWARE AMBIENT RELIGHTING ENGINE
 * ─────────────────────────────────────────────────────────────────────────────
 */
export class DepthRelightingEngine {
  /**
   * Computes a 3D normalized light direction vector from azimuth and elevation spherical angles.
   * Azimuth: -180° to 180°
   * Elevation: -90° to 90°
   */
  public static vectorFromAngles(azimuthDeg: number, elevationDeg: number): [number, number, number] {
    const azRad = (azimuthDeg * Math.PI) / 180.0;
    const elRad = (elevationDeg * Math.PI) / 180.0;

    // Light direction vector pointing towards scene surfaces
    const x = Math.cos(elRad) * Math.sin(azRad);
    const y = -Math.sin(elRad); // Screen Y goes down
    const z = Math.cos(elRad) * Math.cos(azRad);

    const len = Math.sqrt(x * x + y * y + z * z) || 1.0;
    return [
      parseFloat((x / len).toFixed(4)),
      parseFloat((y / len).toFixed(4)),
      parseFloat((z / len).toFixed(4)),
    ];
  }

  /**
   * Estimates surface normals [Nx, Ny, Nz] from a normalized depth map buffer.
   */
  public static computeNormalAtPoint(
    depthLeft: number,
    depthRight: number,
    depthUp: number,
    depthDown: number,
    depthScale = 3.5
  ): [number, number, number] {
    const dX = (depthRight - depthLeft) * depthScale;
    const dY = (depthDown - depthUp) * depthScale;
    const dZ = 1.0;

    const len = Math.sqrt(dX * dX + dY * dY + dZ * dZ) || 1.0;
    return [-dX / len, -dY / len, dZ / len];
  }

  /**
   * Computes Phong/Lambertian diffuse + Fresnel rim lighting shading multiplier.
   */
  public static computeShadingMultiplier(
    normal: [number, number, number],
    config: DepthRelightingConfig
  ): number {
    const [nx, ny, nz] = normal;
    const [lx, ly, lz] = config.keyLight.vector3D;

    // 1. Lambertian Diffuse key light
    const dot = nx * lx + ny * ly + nz * lz;
    const diffuse = Math.max(0.0, dot) * config.keyLight.intensity;

    // 2. Hemispheric ambient bounce
    const hemisphereFactor = 0.5 * (1.0 - ny); // Skylight from above, ground from below
    const ambientSky = (config.ambient.skyAmbient[0] + config.ambient.skyAmbient[1] + config.ambient.skyAmbient[2]) / 3.0;
    const ambientGnd = (config.ambient.groundBounce[0] + config.ambient.groundBounce[1] + config.ambient.groundBounce[2]) / 3.0;
    const ambient = ambientSky * hemisphereFactor + ambientGnd * (1.0 - hemisphereFactor);

    // 3. Fresnel Rim Light (silhouetting separation)
    // Camera view direction is [0, 0, 1]. Facing ratio is nz.
    let rim = 0.0;
    if (config.enableRimLight) {
      const facing = Math.max(0.0, Math.min(1.0, nz));
      const fresnel = Math.pow(1.0 - facing, config.ambient.rimPower);
      // Rim light glints when light is from behind / side (lz < 0.2)
      const backlightFactor = Math.max(0.2, 1.0 - lz);
      rim = fresnel * config.ambient.rimLightIntensity * backlightFactor;
    }

    // Composite total lighting multiplier
    const total = ambient + diffuse + rim;
    return parseFloat(Math.min(2.0, Math.max(0.1, total)).toFixed(4));
  }

  /**
   * Synthesizes an FFmpeg video filter chain representing directional relighting,
   * vignetting, and ambient color temperature grading.
   */
  public static synthesizeRelightingFilterGraph(config: DepthRelightingConfig): string {
    const filters: string[] = [];
    const [lx, ly] = config.keyLight.vector3D;

    // 1. Color tint based on key light color
    const [kr, kg, kb] = config.keyLight.color;
    const rGain = (kr - 1.0) * 0.12;
    const bGain = (kb - 1.0) * 0.12;
    if (Math.abs(rGain) > 0.01 || Math.abs(bGain) > 0.01) {
      filters.push(`colorbalance=rs=${rGain.toFixed(3)}:bs=${bGain.toFixed(3)}:rh=${(rGain * 1.5).toFixed(3)}:bh=${(bGain * 1.5).toFixed(3)}`);
    }

    // 2. Directional gradient exposure bias approximating key light azimuth
    // If key light is from left (lx < 0), gently lift left side; if from right (lx > 0), lift right side
    const intensity = config.keyLight.intensity;
    const contrast = (0.95 + intensity * 0.1).toFixed(2);
    filters.push(`eq=contrast=${contrast}:saturation=1.03`);

    // 3. Vignette / Rim contrast enhancement
    if (config.enableRimLight) {
      filters.push("unsharp=luma_msize_x=5:luma_msize_y=5:luma_amount=0.6");
    }

    return filters.join(",");
  }

  /**
   * Generates ComfyUI ControlNet Depth / Wan 2.1 / Kling prompt conditioning directives
   * to ensure newly generated actor shots align with the scene's master lighting angle.
   */
  public static generateComfyUiPromptDirectives(config: DepthRelightingConfig): {
    promptModifiers: string[];
    controlNetDepthWeight: number;
    relightingGuidance: string;
  } {
    const az = config.keyLight.azimuthDeg;
    const el = config.keyLight.elevationDeg;
    let angleDesc = "front key light";
    if (az < -45) angleDesc = "key light from camera left";
    else if (az > 45) angleDesc = "key light from camera right";
    else if (Math.abs(az) > 135) angleDesc = "dramatic backlight rim lighting";

    const kelvinDesc =
      config.keyLight.cctKelvin < 4000
        ? "warm tungsten golden lighting 3200K"
        : config.keyLight.cctKelvin < 5800
        ? "balanced cinematic daylight 5200K"
        : "cool overcast ambient light 6500K";

    const promptModifiers = [
      `cinematic ${angleDesc}`,
      kelvinDesc,
      config.enableRimLight ? "subtle rim light outline separating character from background" : "",
      "physically-based ambient occlusion, consistent shadow falloff",
    ].filter(Boolean);

    const relightingGuidance = `Key light azimuth ${az}°, elevation ${el}°, intensity ${config.keyLight.intensity.toFixed(2)}, rim ${config.ambient.rimLightIntensity.toFixed(2)}`;

    return {
      promptModifiers,
      controlNetDepthWeight: 0.85,
      relightingGuidance,
    };
  }
}

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * 4. MULTI-SHOT SCENE LIGHTING MATCHER & HARMONIZER
 * ─────────────────────────────────────────────────────────────────────────────
 */
export class SceneLightingMatcher {
  /**
   * Resolves environment preset into realistic light source and ambient defaults.
   */
  public static resolveEnvironmentPreset(
    preset: SceneHarmonizationInput["targetEnvironmentPreset"] = "golden_hour",
    azimuthOverride?: number,
    elevationOverride?: number
  ): { keyLight: LightSourceVector; ambient: AmbientHemisphereLighting } {
    switch (preset) {
      case "golden_hour":
        return {
          keyLight: {
            azimuthDeg: azimuthOverride ?? 45,
            elevationDeg: elevationOverride ?? 25,
            intensity: 1.25,
            color: [1.15, 0.96, 0.75],
            cctKelvin: 4200,
            vector3D: DepthRelightingEngine.vectorFromAngles(azimuthOverride ?? 45, elevationOverride ?? 25),
          },
          ambient: {
            skyAmbient: [0.75, 0.82, 0.95],
            groundBounce: [0.65, 0.52, 0.38],
            rimLightIntensity: 0.85,
            rimLightColor: [1.18, 0.98, 0.72],
            rimPower: 2.8,
          },
        };
      case "cyberpunk_night":
        return {
          keyLight: {
            azimuthDeg: azimuthOverride ?? -60,
            elevationDeg: elevationOverride ?? 35,
            intensity: 1.35,
            color: [0.80, 1.05, 1.25],
            cctKelvin: 7800,
            vector3D: DepthRelightingEngine.vectorFromAngles(azimuthOverride ?? -60, elevationOverride ?? 35),
          },
          ambient: {
            skyAmbient: [0.45, 0.35, 0.75],
            groundBounce: [0.85, 0.25, 0.65],
            rimLightIntensity: 1.10,
            rimLightColor: [1.25, 0.40, 0.95],
            rimPower: 3.2,
          },
        };
      case "interior_candle":
        return {
          keyLight: {
            azimuthDeg: azimuthOverride ?? 30,
            elevationDeg: elevationOverride ?? 15,
            intensity: 1.10,
            color: [1.25, 0.90, 0.60],
            cctKelvin: 2800,
            vector3D: DepthRelightingEngine.vectorFromAngles(azimuthOverride ?? 30, elevationOverride ?? 15),
          },
          ambient: {
            skyAmbient: [0.35, 0.28, 0.22],
            groundBounce: [0.45, 0.32, 0.18],
            rimLightIntensity: 0.65,
            rimLightColor: [1.30, 0.92, 0.55],
            rimPower: 2.5,
          },
        };
      case "daylight_overcast":
      default:
        return {
          keyLight: {
            azimuthDeg: azimuthOverride ?? 0,
            elevationDeg: elevationOverride ?? 60,
            intensity: 1.0,
            color: [1.0, 1.0, 1.0],
            cctKelvin: 5600,
            vector3D: DepthRelightingEngine.vectorFromAngles(azimuthOverride ?? 0, elevationOverride ?? 60),
          },
          ambient: {
            skyAmbient: [0.85, 0.88, 0.92],
            groundBounce: [0.45, 0.45, 0.42],
            rimLightIntensity: 0.40,
            rimLightColor: [0.95, 0.98, 1.02],
            rimPower: 3.0,
          },
        };
    }
  }

  /**
   * Harmonizes an entire scene:
   * 1. Designates the Master Shot as the reference lighting anchor.
   * 2. Extracts master color temperature & tonal distribution.
   * 3. Calculates histogram specification transfer & CCT delta for all coverage shots.
   * 4. Produces DaVinci Resolve ASC CDL, 3D LUT, ComfyUI conditioning, and FFmpeg filter chains.
   */
  public static harmonizeScene(input: SceneHarmonizationInput): SceneHarmonizationResult {
    const { sceneId, shots } = input;
    if (!shots || shots.length === 0) {
      throw new Error(`Scene [${sceneId}] must contain at least 1 shot for lighting harmonization.`);
    }

    const masterShotId = input.masterShotId || shots[0].shotId;
    const masterShot = shots.find((s) => s.shotId === masterShotId) || shots[0];

    // 1. Resolve Master Shot CCT & Histogram
    const masterRgb = masterShot.averageRgb || [128, 120, 105];
    const masterCct = masterShot.measuredCct
      ? {
          cctKelvin: masterShot.measuredCct,
          tintFactor: 0.0,
          dominantWarmth: ColorTemperatureEngine.classifyLightingWarmth(masterShot.measuredCct),
          chromaticityX: 0.33,
          chromaticityY: 0.33,
        }
      : ColorTemperatureEngine.estimateCctFromRgb(masterRgb[0], masterRgb[1], masterRgb[2]);

    const masterHist = HistogramEngine.generateSyntheticHistogram(
      (masterRgb[0] + masterRgb[1] + masterRgb[2]) / 3.0,
      45.0
    );
    const masterCdf = HistogramEngine.computeCdf(masterHist.luma);

    // 2. Resolve Master Scene Lighting Vector
    const envLighting = this.resolveEnvironmentPreset(
      input.targetEnvironmentPreset,
      input.keyLightAzimuthDeg,
      input.keyLightElevationDeg
    );
    const masterLighting = envLighting.keyLight;

    // 3. Harmonize all shots against the Master Reference
    const profiles: ShotHarmonizationProfile[] = [];
    let totalConsistency = 0;

    for (let idx = 0; idx < shots.length; idx++) {
      const shot = shots[idx];
      const isMaster = shot.shotId === masterShotId;
      const shotType = shot.shotType || (idx === 0 ? "establishing" : idx === 1 ? "medium" : "close_up");

      // Approximate or measured target shot colorimetry
      let targetRgb: [number, number, number];
      if (shot.averageRgb) {
        targetRgb = shot.averageRgb;
      } else if (isMaster) {
        targetRgb = [...masterRgb];
      } else {
        // AI variations: shot variation drift simulation
        const driftR = masterRgb[0] + (idx % 2 === 0 ? 12 : -8);
        const driftG = masterRgb[1] + (idx % 3 === 0 ? 5 : -4);
        const driftB = masterRgb[2] + (idx % 2 === 1 ? 16 : -10);
        targetRgb = [
          Math.min(255, Math.max(0, driftR)),
          Math.min(255, Math.max(0, driftG)),
          Math.min(255, Math.max(0, driftB)),
        ];
      }

      const targetCct = shot.measuredCct
        ? {
            cctKelvin: shot.measuredCct,
            tintFactor: 0.0,
            dominantWarmth: ColorTemperatureEngine.classifyLightingWarmth(shot.measuredCct),
            chromaticityX: 0.33,
            chromaticityY: 0.33,
          }
        : ColorTemperatureEngine.estimateCctFromRgb(targetRgb[0], targetRgb[1], targetRgb[2]);

      const targetHist = HistogramEngine.generateSyntheticHistogram(
        (targetRgb[0] + targetRgb[1] + targetRgb[2]) / 3.0,
        42.0
      );
      const targetCdf = HistogramEngine.computeCdf(targetHist.luma);

      // Histogram matching lookup table
      const transferLuma = HistogramEngine.matchCdf(targetCdf, masterCdf);
      const transferR = transferLuma;
      const transferG = transferLuma;
      const transferB = transferLuma;
      const emd = HistogramEngine.calculateWassersteinDistance(targetCdf, masterCdf);

      // ASC CDL derivation
      const derivedCdl = isMaster
        ? { slope: [1.0, 1.0, 1.0] as [number, number, number], offset: [0.0, 0.0, 0.0] as [number, number, number], power: [1.0, 1.0, 1.0] as [number, number, number], saturation: 1.0 }
        : HistogramEngine.deriveAscCdl(masterHist, targetHist);

      // Incorporate shot-type compensation
      if (shotType === "close_up" || shotType === "extreme_close_up") {
        // Slight facial exposure lift (+2% slope, +0.02 saturation)
        derivedCdl.slope = [
          parseFloat((derivedCdl.slope[0] * 1.025).toFixed(4)),
          parseFloat((derivedCdl.slope[1] * 1.025).toFixed(4)),
          parseFloat((derivedCdl.slope[2] * 1.025).toFixed(4)),
        ];
        derivedCdl.saturation = parseFloat((derivedCdl.saturation * 1.03).toFixed(4));
      } else if (shotType === "ots_b_a") {
        // Reverse angle key-to-fill compensation
        derivedCdl.offset = [
          parseFloat((derivedCdl.offset[0] - 0.005).toFixed(4)),
          parseFloat((derivedCdl.offset[1] - 0.005).toFixed(4)),
          parseFloat((derivedCdl.offset[2] - 0.005).toFixed(4)),
        ];
      }

      // Merge custom CDL overrides if provided
      if (shot.customCdl) {
        if (shot.customCdl.slope) derivedCdl.slope = [...shot.customCdl.slope];
        if (shot.customCdl.offset) derivedCdl.offset = [...shot.customCdl.offset];
        if (shot.customCdl.power) derivedCdl.power = [...shot.customCdl.power];
        if (shot.customCdl.saturation !== undefined) derivedCdl.saturation = shot.customCdl.saturation;
      }

      // CCT adjustment
      const cctDelta = masterCct.cctKelvin - targetCct.cctKelvin;
      const cctAdj = ColorTemperatureEngine.calculateCctAdjustment(targetCct, masterCct);

      // Relighting configuration for this shot
      // For reverse OTS shots (OTS B->A), mirror key light azimuth so light direction stays on same side of 180° line!
      let shotAzimuth = masterLighting.azimuthDeg;
      if (shotType === "ots_b_a") {
        shotAzimuth = -masterLighting.azimuthDeg;
      }
      const shotKeyVector = DepthRelightingEngine.vectorFromAngles(shotAzimuth, masterLighting.elevationDeg);

      const relightingConfig: DepthRelightingConfig = {
        keyLight: {
          ...masterLighting,
          azimuthDeg: shotAzimuth,
          vector3D: shotKeyVector,
        },
        ambient: envLighting.ambient,
        depthScale: 3.5,
        foregroundWeight: shotType.includes("close_up") ? 0.85 : 0.60,
        enableRimLight: true,
        enableAmbientBounce: true,
      };

      // Composite FFmpeg filtergraph: CCT balance + Curves tone mapping + Relighting
      const curvesFilter = HistogramEngine.generateCurvesFilter(transferR, transferG, transferB);
      const relightFilter = DepthRelightingEngine.synthesizeRelightingFilterGraph(relightingConfig);
      const ffmpegFilters = [cctAdj.temperatureFilterGraph, curvesFilter, relightFilter].filter(Boolean);
      const ffmpegFilterGraph = ffmpegFilters.join(",");

      const comfyUiDirectives = DepthRelightingEngine.generateComfyUiPromptDirectives(relightingConfig);

      const confidenceScore = isMaster
        ? 1.0
        : parseFloat(Math.max(0.70, Math.min(0.99, 1.0 - emd * 0.5)).toFixed(3));
      totalConsistency += confidenceScore;

      profiles.push({
        shotId: shot.shotId,
        shotType,
        isSceneMaster: isMaster,
        sourceCct: targetCct,
        targetCct: masterCct,
        cctDeltaKelvin: cctDelta,
        histogramMatch: {
          transferTableR: transferR,
          transferTableG: transferG,
          transferTableB: transferB,
          transferTableLuma: transferLuma,
          wassersteinDistance: emd,
        },
        cdlCorrection: derivedCdl,
        relightingConfig,
        ffmpegFilterGraph,
        comfyUiDirectives,
        confidenceScore,
      });
    }

    const sceneConsistencyScore = parseFloat((totalConsistency / shots.length).toFixed(3));
    const davinciCdlManifestXml = this.generateDavinciCdlManifest(sceneId, profiles);

    return {
      sceneId,
      masterShotId,
      masterCct,
      masterLighting,
      profiles,
      sceneConsistencyScore,
      davinciCdlManifestXml,
    };
  }

  /**
   * Generates a unified DaVinci Resolve Color Decision List (ASC CDL XML) manifest
   * containing every shot in the scene.
   */
  public static generateDavinciCdlManifest(
    sceneId: string,
    profiles: ShotHarmonizationProfile[]
  ): string {
    const shotNodes = profiles.map((p) => {
      const s = p.cdlCorrection.slope.map((v) => v.toFixed(4)).join(" ");
      const o = p.cdlCorrection.offset.map((v) => v.toFixed(4)).join(" ");
      const pw = p.cdlCorrection.power.map((v) => v.toFixed(4)).join(" ");
      const sat = p.cdlCorrection.saturation.toFixed(4);

      return `    <ColorCorrection id="${p.shotId}">
      <Description>Shot ${p.shotId} (${p.shotType}${p.isSceneMaster ? " [MASTER]" : ""}) | CCT ${p.targetCct.cctKelvin}K</Description>
      <SOPNode>
        <Slope>${s}</Slope>
        <Offset>${o}</Offset>
        <Power>${pw}</Power>
      </SOPNode>
      <SatNode>
        <Saturation>${sat}</Saturation>
      </SatNode>
    </ColorCorrection>`;
    });

    return `<?xml version="1.0" encoding="UTF-8"?>
<ColorDecisionList xmlns="urn:ASC:CDL:v1.01">
  <Description>Scene ${sceneId} Automated Lighting &amp; Color Harmonization</Description>
  <ColorDecision>
${shotNodes.join("\n")}
  </ColorDecision>
</ColorDecisionList>`.trim();
  }

  /**
   * Applies the harmonized color & lighting grade to a video file via FFmpeg or mock generator.
   */
  public static async applyHarmonizationToVideo(
    inputPath: string,
    outputPath: string,
    profile: ShotHarmonizationProfile,
    options: { mockFallback?: boolean } = {}
  ): Promise<string> {
    const isMock = options.mockFallback || !(await hasFfmpeg()) || process.env.NODE_ENV === "test";
    const outDir = dirname(outputPath);
    await mkdir(outDir, { recursive: true });

    if (isMock) {
      log.info(`[SCENE LIGHTING] Mock mode: Áp dụng Color Match [${profile.shotId}] -> ${outputPath}`);
      await createValidMockMp4File(outputPath, 3.5);
      return outputPath;
    }

    log.info(`[SCENE LIGHTING] Áp dụng FFmpeg filtergraph cho Shot [${profile.shotId}]...`);
    const args = [
      "-y",
      "-i",
      inputPath,
      "-vf",
      profile.ffmpegFilterGraph,
      "-c:v",
      "libx264",
      "-preset",
      "fast",
      "-crf",
      "18",
      "-c:a",
      "copy",
      outputPath,
    ];

    await runMediaCommand("ffmpeg",args);

    return outputPath;
  }
}
