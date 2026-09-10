import { existsSync } from "node:fs";
import { stat } from "node:fs/promises";
import { runFfprobe, runFfmpeg, isFfmpegAvailable } from "../media/ffmpeg.js";
import { probeVideoFile } from "../media/media-validator.js";
import type { AssemblyQaReport } from "./manifest-schema.js";
import { log } from "../utils/logger.js";

export interface VerifyAssemblyOptions {
  masterVideoPath: string;
  masterAudioPath?: string;
  expectedDurationSec?: number;
  shotClipPaths?: string[];
  stems?: {
    dialogue?: string;
    sfx?: string;
    ambience?: string;
    bgm?: string;
  };
  maxAllowedDriftSec?: number;
  detectBlackFrames?: boolean;
  blackdetectDurationSec?: number; // default 0.5s
  blackdetectPicTh?: number; // default 0.98
}

/**
 * Parses FFmpeg blackdetect output from stderr.
 * Example lines:
 * [blackdetect @ 000001...] black_start:1.200000 black_end:1.800000 black_duration:0.600000
 */
export function parseBlackdetectStderr(stderr: string): Array<{
  startSec: number;
  endSec: number;
  durationSec: number;
}> {
  const results: Array<{ startSec: number; endSec: number; durationSec: number }> = [];
  const regex = /black_start:([0-9.]+)\s+black_end:([0-9.]+)\s+black_duration:([0-9.]+)/g;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(stderr)) !== null) {
    results.push({
      startSec: Number.parseFloat(match[1]),
      endSec: Number.parseFloat(match[2]),
      durationSec: Number.parseFloat(match[3]),
    });
  }

  return results;
}

/**
 * Verifies audio duration using ffprobe.
 */
async function probeAudioDuration(audioPath: string): Promise<number> {
  if (!existsSync(audioPath)) {
    throw new Error(`Audio file does not exist: ${audioPath}`);
  }

  try {
    const stdout = await runFfprobe([
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-of",
      "default=noprint_wrappers=1:nokey=1",
      audioPath,
    ]);
    const parsed = Number.parseFloat(stdout.trim());
    return Number.isFinite(parsed) ? parsed : 0;
  } catch (err: any) {
    throw new Error(`ffprobe failed to read audio duration: ${err.message}`);
  }
}

/**
 * Runs automated QA verification on the assembled film output:
 * 1. Checks missing files or empty files (< 1000 bytes)
 * 2. Checks corrupt media container/codec
 * 3. Measures video vs audio duration and detects A/V drift
 * 4. Runs black frame detection (blackdetect)
 */
export async function verifyAssemblyQa(
  options: VerifyAssemblyOptions
): Promise<AssemblyQaReport> {
  const {
    masterVideoPath,
    masterAudioPath,
    expectedDurationSec,
    shotClipPaths = [],
    stems = {},
    maxAllowedDriftSec = 0.1, // 100ms tolerance
    detectBlackFrames = true,
    blackdetectDurationSec = 0.5,
    blackdetectPicTh = 0.98,
  } = options;

  const warnings: string[] = [];
  const errors: string[] = [];
  const missingFiles: string[] = [];
  const corruptMedia: string[] = [];
  let blackSegments: Array<{ startSec: number; endSec: number; durationSec: number }> = [];

  // Check 1: Master Video Existence and Integrity
  if (!existsSync(masterVideoPath)) {
    missingFiles.push(masterVideoPath);
    errors.push(`Master video file not found: '${masterVideoPath}'`);
  } else {
    try {
      const st = await stat(masterVideoPath);
      if (st.size < 1000) {
        corruptMedia.push(masterVideoPath);
        errors.push(`Master video file too small (${st.size} bytes): '${masterVideoPath}'`);
      }
    } catch {}
  }

  // Check 2: Master Audio Existence
  if (masterAudioPath) {
    if (!existsSync(masterAudioPath)) {
      missingFiles.push(masterAudioPath);
      errors.push(`Master audio file not found: '${masterAudioPath}'`);
    } else {
      try {
        const st = await stat(masterAudioPath);
        if (st.size < 1000) {
          corruptMedia.push(masterAudioPath);
          errors.push(`Master audio file too small (${st.size} bytes): '${masterAudioPath}'`);
        }
      } catch {}
    }
  }

  // Check 3: Shot Clips Existence
  for (const clip of shotClipPaths) {
    if (!existsSync(clip)) {
      missingFiles.push(clip);
      errors.push(`Input shot clip not found: '${clip}'`);
    }
  }

  // Check 4: Stems Existence
  for (const [name, stemPath] of Object.entries(stems)) {
    if (stemPath && !existsSync(stemPath)) {
      warnings.push(`Stem '${name}' file not found: '${stemPath}'`);
    }
  }

  let videoDurationSec = 0;
  let audioDurationSec = 0;

  const hasFfmpeg = await isFfmpegAvailable();

  // Check 5: Probe Master Video
  if (existsSync(masterVideoPath) && hasFfmpeg) {
    const vProbe = await probeVideoFile(masterVideoPath);
    if (!vProbe.isValid) {
      corruptMedia.push(masterVideoPath);
      errors.push(`Master video corrupted or unreadable: ${vProbe.error}`);
    } else {
      videoDurationSec = vProbe.durationSec;
    }
  }

  // Check 6: Probe Master Audio
  if (masterAudioPath && existsSync(masterAudioPath) && hasFfmpeg) {
    try {
      audioDurationSec = await probeAudioDuration(masterAudioPath);
    } catch (err: any) {
      corruptMedia.push(masterAudioPath);
      errors.push(`Master audio corrupted: ${err.message}`);
    }
  }

  // Check 7: A/V Drift & Duration Check
  const driftSec =
    videoDurationSec > 0 && audioDurationSec > 0
      ? Math.abs(videoDurationSec - audioDurationSec)
      : 0;

  const isWithinDriftTolerance = driftSec <= maxAllowedDriftSec;
  if (!isWithinDriftTolerance) {
    const msg = `Audio/Video duration drift (${driftSec.toFixed(3)}s) exceeds tolerance (${maxAllowedDriftSec}s). Video: ${videoDurationSec.toFixed(3)}s, Audio: ${audioDurationSec.toFixed(3)}s`;
    if (driftSec > 0.5) {
      errors.push(msg);
    } else {
      warnings.push(msg);
    }
  }

  if (expectedDurationSec !== undefined && videoDurationSec > 0) {
    const diff = Math.abs(videoDurationSec - expectedDurationSec);
    if (diff > 0.5) {
      warnings.push(
        `Video duration (${videoDurationSec.toFixed(2)}s) differs from target (${expectedDurationSec.toFixed(2)}s) by ${diff.toFixed(2)}s`
      );
    }
  }

  // Check 8: Black Frame Detection via FFmpeg blackdetect
  if (detectBlackFrames && existsSync(masterVideoPath) && hasFfmpeg && videoDurationSec > 0) {
    try {
      // ffmpeg blackdetect outputs info to stderr; runFfmpeg throws error when code !== 0 or returns stdout
      // We run ffmpeg with -f null -
      const args = [
        "-v",
        "info",
        "-i",
        masterVideoPath,
        "-vf",
        `blackdetect=d=${blackdetectDurationSec}:pic_th=${blackdetectPicTh}`,
        "-f",
        "null",
        "-",
      ];
      // Note: FFmpeg writes blackdetect output to stderr
      try {
        await runFfmpeg(args, { timeoutMs: 30000 });
      } catch (procErr: any) {
        // FFmpeg may return 0 or if there's stderr message, runFfmpeg might resolve or reject with stderr
        const errText = procErr.message || "";
        blackSegments = parseBlackdetectStderr(errText);
      }

      if (blackSegments.length > 0) {
        warnings.push(
          `Detected ${blackSegments.length} unexpected black frame segment(s) >= ${blackdetectDurationSec}s: ` +
            blackSegments
              .map(
                (s) =>
                  `[${s.startSec.toFixed(2)}s - ${s.endSec.toFixed(2)}s (${s.durationSec.toFixed(2)}s)]`
              )
              .join(", ")
        );
      }
    } catch (err: any) {
      log.warn(`Black frame detection check failed: ${err.message}`);
    }
  }

  const isValid = errors.length === 0 && corruptMedia.length === 0 && missingFiles.length === 0;

  return {
    isValid,
    videoDurationSec: Math.round(videoDurationSec * 1000) / 1000,
    audioDurationSec: Math.round(audioDurationSec * 1000) / 1000,
    driftSec: Math.round(driftSec * 1000) / 1000,
    isWithinDriftTolerance,
    blackFrameDetected: blackSegments.length > 0,
    blackSegments,
    missingFiles,
    corruptMedia,
    warnings,
    errors,
  };
}
