import { WorkflowError } from "../../../../platform/workflow-error.js";

import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { runMediaCommand } from "../../../../platform/processes/media-process-runner.js";
import { hasFfmpeg, createValidMockMp3File } from "../assets/mock-media-generator.js";
import { MmaudioFoleyClient } from "./foley-generator.js";
import { type FoleyGenerator } from "../../ports/foley.js";
import { log } from "../../../../platform/observability/logger.js";

export type FramingDistance = "close_up" | "medium" | "wide" | "extreme_wide";

export interface SpatialAudioCue {
  id: string;
  actionPrompt: string;
  sourceX: number; // -1.0 (far left) to +1.0 (far right)
  distance: FramingDistance;
  offsetSec: number;
  durationSec: number;
  baseVolume?: number; // 0.0 to 1.0 (default: 0.8)
  reverbAmount?: number; // 0.0 to 1.0 (default: 0.1)
}

export interface SpatialPannedGains {
  leftGain: number;
  rightGain: number;
  distanceGain: number;
  cutoffHz: number;
  combinedLeft: number;
  combinedRight: number;
}

export interface SpatialFoleyOptions {
  sampleRate?: number;
  foleyGenerator?: FoleyGenerator;
  mmaudioEndpoint?: string;
  mockFallback?: boolean;
  /** Aspect ratio of video, e.g. "9:16" (mobile portrait) or "16:9" (landscape) */
  aspectRatio?: "9:16" | "16:9" | string;
  /** Force clamp spatial panning to [-0.25, +0.25] to prevent phase cancellation on mobile mono speakers */
  mobileMonoCompatible?: boolean;
}

export interface SpatialFoleyResult {
  outputPath: string;
  cuesProcessed: number;
  filterGraphString: string;
  spatialManifest: Array<{
    cueId: string;
    actionPrompt: string;
    sourceX: number;
    distance: FramingDistance;
    gains: SpatialPannedGains;
  }>;
}

function runCommand(cmd:string,args:string[]):Promise<string>{return runMediaCommand(cmd,args);}

/**
 * Action Foley V2A Synthesis with Spatial Panning & Distance Attenuation.
 *
 * Implements:
 * 1. Constant-Power Panning Law:
 *      L = cos( (pi / 4) * (1 + x) )
 *      R = sin( (pi / 4) * (1 + x) )
 *    Preserves total acoustic power (L^2 + R^2 = 1.0) regardless of stereo position.
 * 2. Acoustic Distance Attenuation:
 *      - close_up: 0 dB gain, full frequency bandwidth (up to 20 kHz)
 *      - medium: -2.5 dB gain, mild air absorption (12 kHz cutoff)
 *      - wide: -6.0 dB gain, high-frequency rolloff (4.5 kHz cutoff)
 *      - extreme_wide: -9.0 dB gain, heavy distance absorption (2.8 kHz cutoff)
 * 3. Video-to-Audio (V2A) Foley Synthesis with temporal offset synchronization.
 */
export class SpatialFoleyEngine {
  /**
   * Calculates constant-power pan and distance attenuation gains for a given screen position and distance.
   * If mobileMonoCompatible or aspectRatio === "9:16" is specified, stereo panning is clamped to [-0.25, +0.25]
   * to eliminate destructive phase cancellation when played through smartphone single speakers.
   */
  public static calculateSpatialGains(
    sourceX: number,
    distance: FramingDistance,
    options?: { mobileMonoCompatible?: boolean; aspectRatio?: "9:16" | "16:9" | string } | boolean
  ): SpatialPannedGains {
    const isMobile =
      typeof options === "boolean"
        ? options
        : options?.mobileMonoCompatible === true || options?.aspectRatio === "9:16";

    // For mobile mono compatibility, clamp panning to [-0.25, +0.25]
    const maxPan = isMobile ? 0.25 : 1.0;
    const clampedX = Math.min(maxPan, Math.max(-maxPan, sourceX));

    // Constant-power angle: theta in [0, pi/2]
    // when x = -1 -> theta = 0 -> L = cos(0) = 1.0, R = sin(0) = 0.0
    // when x = 0  -> theta = pi/4 -> L = cos(pi/4) = 0.7071, R = sin(pi/4) = 0.7071 (L^2+R^2=1.0)
    // when x = +1 -> theta = pi/2 -> L = cos(pi/2) = 0.0, R = sin(pi/2) = 1.0
    const theta = (Math.PI / 4) * (1 + clampedX);
    const leftGain = Math.cos(theta);
    const rightGain = Math.sin(theta);

    let distanceGain = 1.0;
    let cutoffHz = 20000;

    switch (distance) {
      case "close_up":
        distanceGain = 1.0; // 0 dB
        cutoffHz = 20000;
        break;
      case "medium":
        distanceGain = 0.75; // ~ -2.5 dB
        cutoffHz = 12000;
        break;
      case "wide":
        distanceGain = 0.50; // -6.0 dB
        cutoffHz = 4500;
        break;
      case "extreme_wide":
        distanceGain = 0.35; // ~ -9.0 dB
        cutoffHz = 2800;
        break;
    }

    return {
      leftGain: parseFloat(leftGain.toFixed(4)),
      rightGain: parseFloat(rightGain.toFixed(4)),
      distanceGain: parseFloat(distanceGain.toFixed(4)),
      cutoffHz,
      combinedLeft: parseFloat((leftGain * distanceGain).toFixed(4)),
      combinedRight: parseFloat((rightGain * distanceGain).toFixed(4)),
    };
  }

  /**
   * Builds an FFmpeg audio filter string for spatial panning and distance filtering.
   */
  public static buildSpatialFfmpegFilter(gains: SpatialPannedGains, baseVolume: number = 0.8): string {
    const vol = baseVolume;
    const l = (gains.combinedLeft * vol).toFixed(4);
    const r = (gains.combinedRight * vol).toFixed(4);

    const filters: string[] = [];

    // Ensure audio layout is stereo first (converts mono to dual-channel so c1 always exists)
    filters.push("aformat=channel_layouts=stereo");
    // Pan filter for stereo placement (preserves stereo separation without dropping right channel c1)
    filters.push(`pan=stereo|c0=${l}*c0|c1=${r}*c1`);

    // Distance low-pass filter to simulate high-frequency air dissipation
    if (gains.cutoffHz < 18000) {
      filters.push(`lowpass=f=${gains.cutoffHz}`);
    }

    return filters.join(",");
  }

  /**
   * Processes a list of spatial audio cues, synthesizes foley, applies spatial panning, and mixes to master audio stem.
   */
  public static async renderSpatialFoleyTrack(
    videoPath: string,
    cues: SpatialAudioCue[],
    outputPath: string,
    options: SpatialFoleyOptions = {}
  ): Promise<SpatialFoleyResult> {
    const isMock = options.mockFallback === true || (options.mockFallback === undefined && process.env.NODE_ENV === "test");
    if (!isMock && !(await hasFfmpeg())) throw new WorkflowError("MEDIA_BACKEND_UNAVAILABLE", "MEDIA_BACKEND_UNAVAILABLE: FFmpeg is required", "needs_review");
    await mkdir(dirname(outputPath), { recursive: true });

    const foleyClient =
      options.foleyGenerator ||
      new MmaudioFoleyClient({
        endpoint: options.mmaudioEndpoint || "http://127.0.0.1:50002",
        mockFallback: true,
      });

    const spatialManifest: SpatialFoleyResult["spatialManifest"] = [];
    const filterParts: string[] = [];

    for (let i = 0; i < cues.length; i++) {
      const cue = cues[i];
      const gains = this.calculateSpatialGains(cue.sourceX, cue.distance, {
        mobileMonoCompatible: options.mobileMonoCompatible,
        aspectRatio: options.aspectRatio,
      });
      const filter = this.buildSpatialFfmpegFilter(gains, cue.baseVolume ?? 0.8);
      filterParts.push(filter);

      spatialManifest.push({
        cueId: cue.id,
        actionPrompt: cue.actionPrompt,
        sourceX: cue.sourceX,
        distance: cue.distance,
        gains,
      });
    }

    const filterGraphString = filterParts.join("; ");

    if (isMock || cues.length === 0) {
      log.info(`[SPATIAL FOLEY] Mock mode: Đã mô phỏng ${cues.length} spatial foley cues -> ${outputPath}`);
      const totalDuration = cues.reduce((max, c) => Math.max(max, c.offsetSec + c.durationSec), 5.0);
      await createValidMockMp3File(outputPath, totalDuration);

      return {
        outputPath,
        cuesProcessed: cues.length,
        filterGraphString,
        spatialManifest,
      };
    }

    log.info(`[SPATIAL FOLEY] Khởi chạy tổng hợp và spatial panning cho ${cues.length} cues...`);

    // For real production execution, generate individual foley clips and mix with delay & panning
    const tempDir = join(dirname(outputPath), ".tmp_spatial_foley");
    await mkdir(tempDir, { recursive: true });

    try {
      const intermediateClips: string[] = [];
      for (let i = 0; i < cues.length; i++) {
        const cue = cues[i];
        const clipRaw = join(tempDir, `raw_${cue.id}.mp3`);
        const clipPanned = join(tempDir, `panned_${cue.id}.mp3`);

        await foleyClient.generateFoley(videoPath, cue.actionPrompt, clipRaw, {
          durationSec: cue.durationSec,
          volume: cue.baseVolume ?? 0.8,
        });

        const gains = this.calculateSpatialGains(cue.sourceX, cue.distance);
        const filterStr = this.buildSpatialFfmpegFilter(gains, cue.baseVolume ?? 0.8);

        // Apply spatial pan & offset delay
        const delayMs = Math.round(cue.offsetSec * 1000);
        const afArgs = `${filterStr},adelay=${delayMs}|${delayMs}`;

        await runCommand("ffmpeg", [
          "-y",
          "-i",
          clipRaw,
          "-af",
          afArgs,
          "-c:a",
          "libmp3lame",
          clipPanned,
        ]);

        intermediateClips.push(clipPanned);
      }

      // Mix all panned clips together into master foley track
      if (intermediateClips.length === 1) {
        await runCommand("ffmpeg", ["-y", "-i", intermediateClips[0], "-c:a", "libmp3lame", outputPath]);
      } else if (intermediateClips.length > 1) {
        const inputArgs: string[] = [];
        for (const clip of intermediateClips) {
          inputArgs.push("-i", clip);
        }
        const amixFilter = `amix=inputs=${intermediateClips.length}:duration=longest:dropout_transition=0`;
        await runCommand("ffmpeg", [
          "-y",
          ...inputArgs,
          "-filter_complex",
          amixFilter,
          "-c:a",
          "libmp3lame",
          outputPath,
        ]);
      }

      return {
        outputPath,
        cuesProcessed: cues.length,
        filterGraphString,
        spatialManifest,
      };
    } catch (err: any) {
      if (!isMock) throw err;
      log.warn(`[SPATIAL FOLEY] Lỗi khi xử lý spatial audio: ${err.message}. Fallback mock.`);
      await createValidMockMp3File(outputPath, 5.0);
      return {
        outputPath,
        cuesProcessed: cues.length,
        filterGraphString,
        spatialManifest,
      };
    }
  }
}
