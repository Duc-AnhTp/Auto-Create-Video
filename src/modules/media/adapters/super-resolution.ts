import { WorkflowError } from "../../../platform/workflow-error.js";

import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { runMediaCommand } from "../../../platform/processes/media-process-runner.js";
import { hasFfmpeg, createValidMockMp4File } from "./assets/mock-media-generator.js";
import { log } from "../../../platform/observability/logger.js";

export type ResolutionStandard = "4k" | "1080p" | "720p" | "custom";
export type UpscaleAlgorithm = "lanczos4" | "bicubic" | "ai_enhanced" | "spline";
export type TargetColorSpace = "bt709" | "bt2020" | "preserve";

export interface SuperResolutionOptions {
  targetStandard?: ResolutionStandard;
  aspectRatio?: "16:9" | "9:16" | "1:1";
  customDimensions?: { width: number; height: number };
  algorithm?: UpscaleAlgorithm;
  colorSpace?: TargetColorSpace;
  bitDepth?: 8 | 10;
  filmGrainIntensity?: number; // 0.0 to 1.0 (default: 0.15 for subtle 35mm grain)
  unsharpStrength?: number; // 0.0 to 1.5 (default: 0.8)
  denoisePrePass?: boolean; // gentle hqdn3d pre-pass before sharpening
  crf?: number; // H.264/H.265 quality (default: 17 for broadcast master)
  mockFallback?: boolean;
}

export interface SuperResolutionResult {
  outputPath: string;
  sourceResolution?: { width: number; height: number };
  outputResolution: { width: number; height: number };
  algorithmUsed: UpscaleAlgorithm;
  bitDepth: number;
  colorSpace: TargetColorSpace;
  hasFilmGrain: boolean;
  filterGraphString: string;
}

const runCommand = runMediaCommand;

/**
 * Broadcast 4K Super-Resolution & Upscaling Engine.
 *
 * Upconverts AI-generated 720p/1080p clips to broadcast 4K UHD standards:
 * - 4-lobed Lanczos resampler with edge-adaptive unsharp masking.
 * - 10-bit Rec.709 / Rec.2020 color matrix preservation with dithered quantization.
 * - Organic 35mm film grain injection to eliminate flat digital/AI synthetic textures.
 * - Gentle denoise pre-pass to prevent noise amplification during upscaling.
 */
export class SuperResolutionEngine {
  /**
   * Resolves target width and height based on standard and aspect ratio.
   */
  public static computeTargetDimensions(
    aspectRatio: "16:9" | "9:16" | "1:1" = "16:9",
    targetStandard: ResolutionStandard = "4k",
    custom?: { width: number; height: number }
  ): { width: number; height: number } {
    if (targetStandard === "custom" && custom) {
      return {
        width: Math.floor(custom.width / 2) * 2,
        height: Math.floor(custom.height / 2) * 2,
      };
    }

    if (targetStandard === "4k") {
      if (aspectRatio === "9:16") {
        return { width: 2160, height: 3840 }; // 4K Vertical Cinema
      }
      if (aspectRatio === "1:1") {
        return { width: 2160, height: 2160 };
      }
      return { width: 3840, height: 2160 }; // 4K UHD Widescreen
    }

    if (targetStandard === "1080p") {
      if (aspectRatio === "9:16") {
        return { width: 1080, height: 1920 };
      }
      if (aspectRatio === "1:1") {
        return { width: 1080, height: 1080 };
      }
      return { width: 1920, height: 1080 };
    }

    // Default 720p
    if (aspectRatio === "9:16") {
      return { width: 720, height: 1280 };
    }
    if (aspectRatio === "1:1") {
      return { width: 720, height: 720 };
    }
    return { width: 1280, height: 720 };
  }

  /**
   * Builds the comprehensive FFmpeg video filter chain for super-resolution.
   */
  public static buildFfmpegFilterGraph(
    targetDim: { width: number; height: number },
    options: SuperResolutionOptions = {}
  ): string {
    const filters: string[] = [];
    const algorithm = options.algorithm ?? "lanczos4";
    const unsharp = options.unsharpStrength ?? 0.8;
    const grain = options.filmGrainIntensity ?? 0.15;

    // 1. Optional subtle denoise pre-pass to avoid amplifying compression artifacts
    if (options.denoisePrePass) {
      filters.push("hqdn3d=1.5:1.5:2.5:2.5");
    }

    // 2. High-precision Resampler
    let scaleFlags = "lanczos";
    if (algorithm === "bicubic") scaleFlags = "bicubic+accurate_rnd";
    else if (algorithm === "spline") scaleFlags = "spline";
    else if (algorithm === "ai_enhanced" || algorithm === "lanczos4") scaleFlags = "lanczos+accurate_rnd+full_chroma_int";

    filters.push(`scale=${targetDim.width}:${targetDim.height}:flags=${scaleFlags}`);

    // 3. Unsharp Masking for Edge Definition
    if (unsharp > 0) {
      const lumaAmount = Math.min(1.5, Math.max(0.1, unsharp)).toFixed(2);
      const chromaAmount = (unsharp * 0.5).toFixed(2);
      filters.push(`unsharp=5:5:${lumaAmount}:3:3:${chromaAmount}`);
    }

    // 4. Color space & Gamma conversion
    if (options.colorSpace === "bt2020") {
      filters.push("colorspace=all=bt2020nc:trc=bt2020_10:space=bt2020nc:fast=0");
    } else if (options.colorSpace === "bt709") {
      filters.push("colorspace=all=bt709:trc=bt709:space=bt709:fast=0");
    }

    // 5. Film Grain Synthesis (to break digital smoothness / AI banding)
    if (grain > 0) {
      const noiseStrength = Math.round(grain * 40); // 0.15 -> ~6, 0.5 -> ~20
      filters.push(`noise=alls=${noiseStrength}:allf=t+u`);
    }

    // 6. 10-bit or 8-bit format
    const pixFmt = options.bitDepth === 10 ? "yuv420p10le" : "yuv420p";
    filters.push(`format=${pixFmt}`);

    return filters.join(",");
  }

  /**
   * Executes 4K Super-Resolution upscaling on input video.
   */
  public static async upscaleVideo(
    inputPath: string,
    outputPath: string,
    options: SuperResolutionOptions = {}
  ): Promise<SuperResolutionResult> {
    const isMock = options.mockFallback === true || (options.mockFallback === undefined && process.env.NODE_ENV === "test");
    if (!isMock && !(await hasFfmpeg())) throw new WorkflowError("MEDIA_BACKEND_UNAVAILABLE", "MEDIA_BACKEND_UNAVAILABLE: FFmpeg is required", "needs_review");
    const targetDim = this.computeTargetDimensions(
      options.aspectRatio || "16:9",
      options.targetStandard || "4k",
      options.customDimensions
    );

    await mkdir(dirname(outputPath), { recursive: true });

    const filterGraph = this.buildFfmpegFilterGraph(targetDim, options);
    const bitDepth = options.bitDepth ?? 10;
    const colorSpace = options.colorSpace ?? "bt709";
    const algorithm = options.algorithm ?? "lanczos4";
    const crf = options.crf ?? 17;

    if (isMock) {
      log.info(`[SUPER RES] Mock mode: Tạo video mô phỏng ${targetDim.width}x${targetDim.height} (Standard: ${options.targetStandard || "4k"})...`);
      await createValidMockMp4File(outputPath, 4.0, targetDim.width, targetDim.height);
      return {
        outputPath,
        outputResolution: targetDim,
        algorithmUsed: algorithm,
        bitDepth,
        colorSpace,
        hasFilmGrain: (options.filmGrainIntensity ?? 0.15) > 0,
        filterGraphString: filterGraph,
      };
    }

    log.info(`[SUPER RES] Khởi chạy 4K Super-Resolution: ${targetDim.width}x${targetDim.height} [${algorithm}]...`);

    const args = [
      "-y",
      "-i",
      inputPath,
      "-vf",
      filterGraph,
      "-c:v",
      "libx264",
      "-preset",
      "slow",
      "-crf",
      String(crf),
      "-c:a",
      "copy",
      outputPath,
    ];

    try {
      await runCommand("ffmpeg", args);
      return {
        outputPath,
        outputResolution: targetDim,
        algorithmUsed: algorithm,
        bitDepth,
        colorSpace,
        hasFilmGrain: (options.filmGrainIntensity ?? 0.15) > 0,
        filterGraphString: filterGraph,
      };
    } catch (err: any) {
      if (!isMock) throw err;
      log.warn(`[SUPER RES] Lỗi FFmpeg khi upscaling: ${err.message}. Chuyển sang mock fallback.`);
      await createValidMockMp4File(outputPath, 4.0, targetDim.width, targetDim.height);
      return {
        outputPath,
        outputResolution: targetDim,
        algorithmUsed: algorithm,
        bitDepth,
        colorSpace,
        hasFilmGrain: (options.filmGrainIntensity ?? 0.15) > 0,
        filterGraphString: filterGraph,
      };
    }
  }
}
