import type {AscCdl,CinematicPresetName,CinematicLookPreset,CdlGradeOptions,CdlGradeResult} from '../../../contracts/media-features.js';
export type {AscCdl,CinematicPresetName,CinematicLookPreset,CdlGradeOptions,CdlGradeResult} from '../../../contracts/media-features.js';
import { WorkflowError } from "../../../platform/workflow-error.js";

import { writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { runMediaCommand } from "../../../platform/processes/media-process-runner.js";
import { hasFfmpeg, createValidMockMp4File } from "./assets/mock-media-generator.js";
import { log } from "../../../platform/observability/logger.js";

/**
 * American Society of Cinematographers Color Decision List (ASC CDL) standard.
 * Formula:
 *   out = (in * slope + offset)^power
 *   luma = 0.2126 * R + 0.7152 * G + 0.0722 * B
 *   out' = luma + saturation * (out - luma)
 */






export const CINEMATIC_LOOK_PRESETS: Record<CinematicPresetName, CinematicLookPreset> = {
  kodak_2383: {
    id: "kodak_2383",
    name: "Kodak Vision 2383 Print Stock",
    description: "Classic Hollywood film print stock. Deep rich blacks, warm golden highlights, and cyan-leaning shadows.",
    cdl: {
      slope: [1.06, 0.98, 0.91],
      offset: [-0.02, 0.00, 0.04],
      power: [1.12, 1.08, 0.98],
      saturation: 1.15,
    },
    recommendedGrain: 0.18,
  },
  fuji_eterna: {
    id: "fuji_eterna",
    name: "Fujifilm Eterna 500T",
    description: "Soft low-contrast cinema palette. Gentle highlight rolloff, muted pastel tones, and emerald-tinted shadows.",
    cdl: {
      slope: [0.94, 1.02, 1.04],
      offset: [0.03, 0.02, 0.01],
      power: [0.95, 0.98, 1.02],
      saturation: 0.92,
    },
    recommendedGrain: 0.12,
  },
  teal_orange: {
    id: "teal_orange",
    name: "Blockbuster Teal & Orange",
    description: "Punchy Hollywood modern action grade. Warm saturated skin tones separated cleanly against deep teal shadows.",
    cdl: {
      slope: [1.16, 1.00, 0.84],
      offset: [-0.04, 0.01, 0.06],
      power: [1.12, 1.02, 0.90],
      saturation: 1.25,
    },
    recommendedGrain: 0.14,
  },
  cyberpunk_neon: {
    id: "cyberpunk_neon",
    name: "Cyberpunk Neo-Noir",
    description: "High-contrast sci-fi aesthetic. Vibrant electric magenta and cyan accents, cold deep shadows, sharp specular roll.",
    cdl: {
      slope: [0.88, 1.06, 1.24],
      offset: [0.05, -0.02, 0.08],
      power: [1.15, 0.95, 1.20],
      saturation: 1.35,
    },
    recommendedGrain: 0.16,
  },
  bleach_bypass: {
    id: "bleach_bypass",
    name: "Silver Retention Bleach Bypass",
    description: "Gritty war and thriller look. Highly desaturated chroma, extreme dynamic contrast, and deep metallic shadows.",
    cdl: {
      slope: [1.25, 1.25, 1.25],
      offset: [-0.08, -0.08, -0.08],
      power: [1.32, 1.32, 1.32],
      saturation: 0.45,
    },
    recommendedGrain: 0.25,
  },
  monochrome_noir: {
    id: "monochrome_noir",
    name: "35mm Monochrome Film Noir",
    description: "Zero saturation cinematic black and white. Spectral luminance weighting with dramatic chiaroscuro contrast.",
    cdl: {
      slope: [1.10, 1.10, 1.10],
      offset: [-0.03, -0.03, -0.03],
      power: [1.15, 1.15, 1.15],
      saturation: 0.0,
    },
    recommendedGrain: 0.22,
  },
  natural_balance: {
    id: "natural_balance",
    name: "Neutral Rec.709 Broadcast",
    description: "Clean uncolored reference grade with 1.0 slope/power unity and 0 offset.",
    cdl: {
      slope: [1.0, 1.0, 1.0],
      offset: [0.0, 0.0, 0.0],
      power: [1.0, 1.0, 1.0],
      saturation: 1.0,
    },
    recommendedGrain: 0.08,
  },
};





const runCommand = runMediaCommand;

/**
 * ASC CDL Color Grading Engine with 3D LUT (.cube) Generation & DaVinci Resolve Interchange.
 *
 * Implements strict ASC CDL mathematics:
 * 1. Slope (Multiplication/Gain)
 * 2. Offset (Addition/Lift)
 * 3. Power (Exponentiation/Gamma)
 * 4. Saturation (Rec.709 Luma weighting)
 *
 * Generates industry-standard 33x33x33 .cube 3D LUTs and ASC CDL XMLs.
 */
export class CdlGradingEngine {
  public static async prepareGrade(outputPath:string,preset:CinematicPresetName="kodak_2383",options:CdlGradeOptions={}):Promise<CdlGradeResult>{
    const cdl=this.resolveCdl(preset,options.customCdl),outDir=dirname(outputPath);await mkdir(outDir,{recursive:true});
    const lutPath=options.outputLutPath??join(outDir,`${preset}_3d.cube`),xmlPath=options.outputXmlPath??join(outDir,`${preset}_cdl.xml`);
    await writeFile(lutPath,this.generateCubeLutContent(cdl,preset,options.lutSize??33),"utf8");await writeFile(xmlPath,this.generateAscCdlXml(cdl,preset),"utf8");
    return {outputPath,presetApplied:preset,cdl,lutPath,xmlPath,filterGraphString:`lut3d='${lutPath.replace(/\\/g,"/").replace(/:/g,"\\:")}'`};
  }
  /**
   * Applies the exact mathematical ASC CDL transformation to a single normalized RGB pixel [0.0, 1.0].
   */
  public static transformRgbPixel(
    r: number,
    g: number,
    b: number,
    cdl: AscCdl
  ): [number, number, number] {
    const [sr, sg, sb] = cdl.slope;
    const [or, og, ob] = cdl.offset;
    const [pr, pg, pb] = cdl.power;
    const sat = cdl.saturation;

    // 1. Slope & Offset with zero-floor clamping
    const soR = Math.max(0.0, r * sr + or);
    const soG = Math.max(0.0, g * sg + og);
    const soB = Math.max(0.0, b * sb + ob);

    // 2. Power
    const powR = Math.pow(soR, pr);
    const powG = Math.pow(soG, pg);
    const powB = Math.pow(soB, pb);

    // 3. Rec.709 Luminance Weighting
    const luma = 0.2126 * powR + 0.7152 * powG + 0.0722 * powB;

    // 4. Saturation
    const outR = Math.min(1.0, Math.max(0.0, luma + sat * (powR - luma)));
    const outG = Math.min(1.0, Math.max(0.0, luma + sat * (powG - luma)));
    const outB = Math.min(1.0, Math.max(0.0, luma + sat * (powB - luma)));

    return [outR, outG, outB];
  }

  /**
   * Generates a standard Adobe / DaVinci Resolve 3D LUT (.cube) file content.
   */
  public static generateCubeLutContent(cdl: AscCdl, title: string = "CinematicCDL", size: number = 33): string {
    const lines: string[] = [];
    lines.push(`# ASC CDL 3D LUT Generated by Auto-Create-Video`);
    lines.push(`TITLE "${title}"`);
    lines.push(`LUT_3D_SIZE ${size}`);
    lines.push(`DOMAIN_MIN 0.0 0.0 0.0`);
    lines.push(`DOMAIN_MAX 1.0 1.0 1.0`);
    lines.push("");

    const step = 1.0 / (size - 1);

    // Standard .cube indexing order: R varies fastest, then G, then B
    for (let bIdx = 0; bIdx < size; bIdx++) {
      const bIn = bIdx * step;
      for (let gIdx = 0; gIdx < size; gIdx++) {
        const gIn = gIdx * step;
        for (let rIdx = 0; rIdx < size; rIdx++) {
          const rIn = rIdx * step;
          const [rOut, gOut, bOut] = this.transformRgbPixel(rIn, gIn, bIn, cdl);
          lines.push(`${rOut.toFixed(6)} ${gOut.toFixed(6)} ${bOut.toFixed(6)}`);
        }
      }
    }

    return lines.join("\n");
  }

  /**
   * Generates DaVinci Resolve / Final Cut Pro compatible ASC CDL XML string.
   */
  public static generateAscCdlXml(cdl: AscCdl, shotId: string = "MASTER_SHOT"): string {
    const [sr, sg, sb] = cdl.slope;
    const [or, og, ob] = cdl.offset;
    const [pr, pg, pb] = cdl.power;

    return `<?xml version="1.0" encoding="UTF-8"?>
<ColorDecisionList xmlns="urn:ASC:CDL:v1.01">
  <ColorDecision>
    <ColorCorrection id="${shotId}">
      <SOPNode>
        <Slope>${sr.toFixed(4)} ${sg.toFixed(4)} ${sb.toFixed(4)}</Slope>
        <Offset>${or.toFixed(4)} ${og.toFixed(4)} ${ob.toFixed(4)}</Offset>
        <Power>${pr.toFixed(4)} ${pg.toFixed(4)} ${pb.toFixed(4)}</Power>
      </SOPNode>
      <SatNode>
        <Saturation>${cdl.saturation.toFixed(4)}</Saturation>
      </SatNode>
    </ColorCorrection>
  </ColorDecision>
</ColorDecisionList>`.trim();
  }

  /**
   * Resolves final ASC CDL values given preset name or custom parameters.
   */
  public static resolveCdl(presetName?: CinematicPresetName | string, custom?: Partial<AscCdl>): AscCdl {
    const base = (presetName && CINEMATIC_LOOK_PRESETS[presetName as CinematicPresetName]?.cdl) ||
      CINEMATIC_LOOK_PRESETS.natural_balance.cdl;

    return {
      slope: custom?.slope || [...base.slope],
      offset: custom?.offset || [...base.offset],
      power: custom?.power || [...base.power],
      saturation: custom?.saturation ?? base.saturation,
    };
  }

  /**
   * Applies ASC CDL color grading to video via 3D LUT (.cube) and FFmpeg lut3d filter.
   */
  public static async applyCdlGrade(
    inputPath: string,
    outputPath: string,
    presetOrCdl: CinematicPresetName | AscCdl = "kodak_2383",
    options: CdlGradeOptions = {}
  ): Promise<CdlGradeResult> {
    const isMock = options.mockFallback === true || (options.mockFallback === undefined && process.env.NODE_ENV === "test");
    if (!isMock && !(await hasFfmpeg())) throw new WorkflowError("MEDIA_BACKEND_UNAVAILABLE", "MEDIA_BACKEND_UNAVAILABLE: FFmpeg is required", "needs_review");

    let presetName: CinematicPresetName | undefined;
    let cdl: AscCdl;

    if (typeof presetOrCdl === "string") {
      presetName = presetOrCdl as CinematicPresetName;
      cdl = this.resolveCdl(presetName, options.customCdl);
    } else {
      cdl = { ...presetOrCdl, ...options.customCdl };
    }

    const outDir = dirname(outputPath);
    await mkdir(outDir, { recursive: true });

    // 1. Write .cube 3D LUT file
    const lutPath = options.outputLutPath || join(outDir, `${presetName || "grade"}_3d.cube`);
    const lutSize = options.lutSize || 33;
    const cubeContent = this.generateCubeLutContent(cdl, presetName || "CustomGrade", lutSize);
    await writeFile(lutPath, cubeContent, "utf8");

    // 2. Write DaVinci Resolve CDL XML
    const xmlPath = options.outputXmlPath || join(outDir, `${presetName || "grade"}_cdl.xml`);
    const xmlContent = this.generateAscCdlXml(cdl, presetName || "MASTER");
    await writeFile(xmlPath, xmlContent, "utf8");

    // 3. Build FFmpeg filter string (normalize backslashes for FFmpeg on Windows)
    const escapedLutPath = lutPath.replace(/\\/g, "/").replace(/:/g, "\\:");
    const filterGraph = `lut3d='${escapedLutPath}'`;

    if (isMock) {
      log.info(`[CDL GRADING] Mock mode: Áp dụng LUT [${presetName || "custom"}] -> ${outputPath}`);
      await createValidMockMp4File(outputPath, 4.0);
      return {
        outputPath,
        presetApplied: presetName,
        cdl,
        lutPath,
        xmlPath,
        filterGraphString: filterGraph,
      };
    }

    log.info(`[CDL GRADING] Khởi chạy FFmpeg grading bằng 3D LUT [${presetName || "custom"}]...`);

    const args = [
      "-y",
      "-i",
      inputPath,
      "-vf",
      filterGraph,
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

    try {
      await runCommand("ffmpeg", args);
      return {
        outputPath,
        presetApplied: presetName,
        cdl,
        lutPath,
        xmlPath,
        filterGraphString: filterGraph,
      };
    } catch (err: any) {
      if (!isMock) throw err;
      log.warn(`[CDL GRADING] Lỗi FFmpeg khi grading: ${err.message}. Fallback mock.`);
      await createValidMockMp4File(outputPath, 4.0);
      return {
        outputPath,
        presetApplied: presetName,
        cdl,
        lutPath,
        xmlPath,
        filterGraphString: filterGraph,
      };
    }
  }
}
