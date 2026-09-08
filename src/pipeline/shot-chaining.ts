/**
 * Shot Chaining & Autoregressive Frame Extension (Phân Hệ IV)
 *
 * Wan 2.2 T2V has a native generation cap of ~5 seconds per run.
 * This module decomposes shots > 5s into an autoregressive chain:
 * - Pass 1: T2V for the first 5.0 seconds
 * - Pass 2..N: I2V extension using the final frame of Pass (N-1) as the conditioning image
 * - Generates smooth FFmpeg crossfade / stitch command to eliminate seam discontinuities
 */

export interface ExecutionPass {
  passIndex: number;
  type: "t2v" | "i2v_extend";
  durationSec: number;
  conditionFromPass?: number;
  seedModifier: number;
}

export interface ShotDecomposition {
  shotId: string;
  totalDurationSec: number;
  passes: ExecutionPass[];
  requiresExtension: boolean;
}

/**
 * Decomposes a target shot duration into native Wan 2.2 chunks (<= maxChunkSec).
 */
export function decomposeShotDuration(
  shotId: string,
  totalDurationSec: number,
  maxChunkSec = 5.0
): ShotDecomposition {
  if (totalDurationSec <= 0) {
    throw new Error(`Invalid shot duration: ${totalDurationSec}s`);
  }

  if (totalDurationSec <= maxChunkSec) {
    return {
      shotId,
      totalDurationSec,
      requiresExtension: false,
      passes: [
        {
          passIndex: 1,
          type: "t2v",
          durationSec: totalDurationSec,
          seedModifier: 0,
        },
      ],
    };
  }

  const passes: ExecutionPass[] = [];
  let remaining = totalDurationSec;
  let passIdx = 1;

  while (remaining > 0) {
    const chunk = Math.min(remaining, maxChunkSec);
    passes.push({
      passIndex: passIdx,
      type: passIdx === 1 ? "t2v" : "i2v_extend",
      durationSec: Math.round(chunk * 100) / 100,
      conditionFromPass: passIdx === 1 ? undefined : passIdx - 1,
      seedModifier: (passIdx - 1) * 7,
    });
    remaining = Math.round((remaining - chunk) * 100) / 100;
    passIdx++;
  }

  return {
    shotId,
    totalDurationSec,
    requiresExtension: true,
    passes,
  };
}

/**
 * Builds FFmpeg command arguments to extract the exact final frame of a video clip
 * for use as the conditioning image in I2V extension.
 */
export function buildExtractFinalFrameArgs(videoPath: string, outFramePath: string): string[] {
  return [
    "-sseof", "-0.05",
    "-i", videoPath,
    "-update", "1",
    "-q:v", "1",
    "-frames:v", "1",
    "-y",
    outFramePath,
  ];
}

/**
 * Generates an FFmpeg complex filter string for stitching extended sub-clips
 * with smooth crossfade blending at boundaries to prevent temporal jumpiness.
 */
export function buildCrossfadeStitchFilter(
  clipPaths: string[],
  clipDurations: number[],
  crossfadeSec = 0.1
): { filterComplex: string; totalOutputDuration: number } {
  if (clipPaths.length <= 1) {
    return { filterComplex: "", totalOutputDuration: clipDurations[0] ?? 0 };
  }

  // Calculate cumulative crossfade offsets
  const filterSteps: string[] = [];
  let lastStream = "[0:v]";
  let currentOffset = Math.max(0, clipDurations[0] - crossfadeSec);

  for (let i = 1; i < clipPaths.length; i++) {
    const nextStream = `[${i}:v]`;
    const outStream = i === clipPaths.length - 1 ? "[vout]" : `[v${i}]`;
    filterSteps.push(
      `${lastStream}${nextStream}xfade=transition=fade:duration=${crossfadeSec}:offset=${currentOffset.toFixed(2)}${outStream}`
    );
    lastStream = outStream;
    if (i < clipPaths.length - 1) {
      currentOffset += Math.max(0, clipDurations[i] - crossfadeSec);
    }
  }

  const totalOutputDuration = Math.max(
    0,
    clipDurations.reduce((acc, d) => acc + d, 0) - (clipPaths.length - 1) * crossfadeSec
  );

  return {
    filterComplex: filterSteps.join(";"),
    totalOutputDuration: Math.round(totalOutputDuration * 100) / 100,
  };
}
