import { existsSync } from "node:fs";
import { resolve } from "node:path";

/**
 * American Society of Cinematographers Color Decision List (ASC CDL) standard.
 * SOP (Slope, Offset, Power) + Saturation.
 */
export interface AscCdl {
  slope: [number, number, number]; // [R, G, B]
  offset: [number, number, number]; // [R, G, B]
  power: [number, number, number]; // [R, G, B]
  saturation: number;
}

export interface ColorMatchOptions {
  /** Cinematic LUT preset name or path to .cube file */
  lutPreset?: "kodak_2383" | "fuji_eterna" | "teal_orange" | "bleach_bypass" | "none" | string;
  /** Contrast enhancement (0.8 - 1.3). Default: 1.05 */
  contrast?: number;
  /** Saturation enhancement (0.8 - 1.4). Default: 1.02 */
  saturation?: number;
  /** Color temperature shift in Kelvin or tint factor (-0.1 to 0.1). Default: 0 */
  temperatureShift?: number;
  /** Specific ASC CDL values to apply */
  cdl?: Partial<AscCdl>;
}

export interface ShotColorProfile {
  shotId: string;
  sceneId: string;
  isSceneMaster: boolean;
  filterGraphString: string;
  cdl: AscCdl;
}

/**
 * Cinematic Color Science & Shot-to-Shot Color Matching Engine.
 *
 * Ensures visual consistency across adjacent shots in the same scene:
 * - Uses the scene's first shot (Master Shot) as the color grading reference.
 * - Adheres to ASC CDL standard (Slope, Offset, Power, Saturation).
 * - Generates FFmpeg video filter chains (`eq`, `colorbalance`, `curves`, `lut3d`)
 *   to harmonize white balance, exposure, and color grade across all scene shots.
 */
export class ColorMatcher {
  public static readonly DEFAULT_CDL: AscCdl = {
    slope: [1.0, 1.0, 1.0],
    offset: [0.0, 0.0, 0.0],
    power: [1.0, 1.0, 1.0],
    saturation: 1.0,
  };

  /**
   * Converts an ASC CDL into an FFmpeg filter chain representation.
   */
  public static cdlToFfmpegFilter(cdl: AscCdl): string {
    const filters: string[] = [];

    // 1. Slope (Gain / Contrast approximation) & Saturation
    const avgSlope = (cdl.slope[0] + cdl.slope[1] + cdl.slope[2]) / 3.0;
    const avgPower = (cdl.power[0] + cdl.power[1] + cdl.power[2]) / 3.0;
    const gamma = Math.max(0.1, 1.0 / avgPower);
    filters.push(
      `eq=contrast=${avgSlope.toFixed(2)}:gamma=${gamma.toFixed(2)}:saturation=${cdl.saturation.toFixed(2)}`
    );

    // 2. Offset / Lift via colorbalance shadows
    const rs = cdl.offset[0].toFixed(3);
    const gs = cdl.offset[1].toFixed(3);
    const bs = cdl.offset[2].toFixed(3);
    if (cdl.offset[0] !== 0 || cdl.offset[1] !== 0 || cdl.offset[2] !== 0) {
      filters.push(`colorbalance=rs=${rs}:gs=${gs}:bs=${bs}`);
    }

    return filters.join(",");
  }

  /**
   * Exports an ASC CDL into standard XML format for DaVinci Resolve & Premiere Pro.
   */
  public static exportCdlXml(cdl: AscCdl, shotId: string): string {
    const s = `${cdl.slope[0].toFixed(4)} ${cdl.slope[1].toFixed(4)} ${cdl.slope[2].toFixed(4)}`;
    const o = `${cdl.offset[0].toFixed(4)} ${cdl.offset[1].toFixed(4)} ${cdl.offset[2].toFixed(4)}`;
    const p = `${cdl.power[0].toFixed(4)} ${cdl.power[1].toFixed(4)} ${cdl.power[2].toFixed(4)}`;
    const sat = cdl.saturation.toFixed(4);

    return [
      `<?xml version="1.0" encoding="UTF-8"?>`,
      `<ColorCorrection id="${shotId}">`,
      `  <SOPNode>`,
      `    <Slope>${s}</Slope>`,
      `    <Offset>${o}</Offset>`,
      `    <Power>${p}</Power>`,
      `  </SOPNode>`,
      `  <SatNode>`,
      `    <Saturation>${sat}</Saturation>`,
      `  </SatNode>`,
      `</ColorCorrection>`,
    ].join("\n");
  }

  /**
   * Generates FFmpeg video filter string for a given shot in a scene.
   */
  public static buildShotColorFilter(
    shotId: string,
    sceneId: string,
    shotIndexInScene: number,
    options?: ColorMatchOptions
  ): string {
    const filters: string[] = [];
    const contrast = options?.contrast ?? 1.05;
    const saturation = options?.saturation ?? 1.02;
    const tempShift = options?.temperatureShift ?? 0;

    // 1. Equalization / Contrast / Saturation grade
    filters.push(`eq=contrast=${contrast.toFixed(2)}:saturation=${saturation.toFixed(2)}`);

    // 2. White balance / temperature tint
    if (tempShift !== 0) {
      if (tempShift > 0) {
        // Warmer (Golden hour / interior)
        filters.push(`colorbalance=rs=${(tempShift * 0.1).toFixed(3)}:bs=-${(tempShift * 0.1).toFixed(3)}`);
      } else {
        // Cooler (Moody / night / cyber)
        filters.push(`colorbalance=bs=${(-tempShift * 0.1).toFixed(3)}:rs=-${(-tempShift * 0.1).toFixed(3)}`);
      }
    }

    // 3. Cinematic 3D LUT filter if specified
    if (options?.lutPreset && options.lutPreset !== "none") {
      const directLutPath = resolve(options.lutPreset);
      const bundledLutPath = resolve("assets/luts", `${options.lutPreset}.cube`);
      const effectiveLutPath = existsSync(directLutPath)
        ? directLutPath
        : existsSync(bundledLutPath)
        ? bundledLutPath
        : null;

      if (effectiveLutPath) {
        const safeLutPath = effectiveLutPath.replace(/\\/g, "/").replace(/:/g, "\\:");
        filters.push(`lut3d=file='${safeLutPath}'`);
      } else {
        // Built-in cinematic curve fallback when physical .cube file is not present on disk
        const presetKey = options.lutPreset.toLowerCase().replace(/[^a-z0-9_]/g, "");
        if (presetKey.includes("kodak") || presetKey.includes("2383")) {
          filters.push("colorbalance=rs=0.08:rm=0.04:bs=-0.08:bm=-0.04:rh=-0.03:bh=0.05");
        } else if (presetKey.includes("teal") || presetKey.includes("orange")) {
          filters.push("colorbalance=rs=0.12:gs=0.02:bs=-0.15:rh=-0.08:gh=0.02:bh=0.12");
        } else if (presetKey.includes("bleach") || presetKey.includes("bypass")) {
          filters.push("eq=contrast=1.25:saturation=0.6");
        } else if (presetKey.includes("cyber") || presetKey.includes("neon")) {
          filters.push("colorbalance=rs=0.10:gs=-0.05:bs=0.18:rh=-0.05:bh=0.15");
        } else if (presetKey.includes("matrix") || presetKey.includes("green")) {
          filters.push("colorbalance=rs=-0.10:gs=0.15:bs=-0.10:gm=0.08");
        } else if (presetKey.includes("sepia") || presetKey.includes("vintage")) {
          filters.push("colorchannelmixer=.393:.769:.189:0:.349:.686:.168:0:.272:.534:.131");
        }
      }
    }

    return filters.join(",");
  }

  /**
   * Harmonizes reverse shots (Shot 3 OTS A->B and Shot 4 OTS B->A) against the scene's Two-Shot.
   */
  public static harmonizeReverseShots(
    masterCdl: AscCdl,
    shotType: "two_shot" | "ots_a_b" | "ots_b_a" | "close_up"
  ): AscCdl {
    const cdl: AscCdl = {
      slope: [...masterCdl.slope] as [number, number, number],
      offset: [...masterCdl.offset] as [number, number, number],
      power: [...masterCdl.power] as [number, number, number],
      saturation: masterCdl.saturation,
    };

    if (shotType === "close_up") {
      // Slight highlight lift for portrait facial clarity
      cdl.slope = [cdl.slope[0] * 1.02, cdl.slope[1] * 1.02, cdl.slope[2] * 1.02];
      cdl.saturation = Math.min(1.2, cdl.saturation * 1.03);
    } else if (shotType === "ots_b_a") {
      // Reverse angle key-to-fill compensation
      cdl.offset = [cdl.offset[0] - 0.005, cdl.offset[1] - 0.005, cdl.offset[2] - 0.005];
    }

    return cdl;
  }

  /**
   * Harmonizes an entire scene's shot list with consistent scene color grading.
   */
  public static harmonizeSceneShots(
    sceneId: string,
    shotIds: string[],
    options?: ColorMatchOptions
  ): ShotColorProfile[] {
    const baseCdl: AscCdl = {
      slope: options?.cdl?.slope ?? [1.0, 1.0, 1.0],
      offset: options?.cdl?.offset ?? [0.0, 0.0, 0.0],
      power: options?.cdl?.power ?? [1.0, 1.0, 1.0],
      saturation: options?.cdl?.saturation ?? (options?.saturation ?? 1.02),
    };

    return shotIds.map((shotId, idx) => ({
      shotId,
      sceneId,
      isSceneMaster: idx === 0,
      filterGraphString: ColorMatcher.buildShotColorFilter(shotId, sceneId, idx, options),
      cdl: idx === 0 ? baseCdl : ColorMatcher.harmonizeReverseShots(baseCdl, idx === 4 ? "close_up" : "ots_b_a"),
    }));
  }
}
