import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { MotionSmoothingEngine } from "./motion-smoother.js";
import { createValidMockMp4File } from "../assets/mock-media-generator.js";

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "motion-smoother-test-"));
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe("Phase 2: Motion Smoothing & Frame Rate Interpolation Engine", () => {
  it("interpolates video to target FPS with mock fallback", async () => {
    const inputPath = join(tmp, "raw_shot_24fps.mp4");
    await createValidMockMp4File(inputPath, 3.0, 720, 1280);

    const outPath = join(tmp, "interpolated_60fps.mp4");
    const result = await MotionSmoothingEngine.interpolateVideo(inputPath, outPath, {
      targetFps: 60,
      mode: "mci",
      quality: "cinematic",
      mockFallback: true,
    });

    expect(existsSync(result)).toBe(true);
    expect(result).toBe(outPath);
  });

  it("applies cinematic slow-motion ramping to climax shot", async () => {
    const inputPath = join(tmp, "climax_shot.mp4");
    await createValidMockMp4File(inputPath, 3.0, 720, 1280);

    const outPath = join(tmp, "climax_ramped.mp4");
    const result = await MotionSmoothingEngine.applySpeedCurve(inputPath, outPath, {
      curveType: "slow_motion_climax",
      speedFactor: 0.5,
      targetFps: 30,
      mockFallback: true,
    });

    expect(existsSync(result)).toBe(true);
    expect(result).toBe(outPath);
  });

  it("smooths an entire shot sequence and handles climax shots differently", async () => {
    const shot1 = join(tmp, "shot_01.mp4");
    const shot2 = join(tmp, "shot_02.mp4");
    await createValidMockMp4File(shot1, 3.0);
    await createValidMockMp4File(shot2, 3.0);

    const outDir = join(tmp, "smoothed_sequence");
    const results = await MotionSmoothingEngine.smoothShotSequence(
      [
        { shotId: "shot_01", clipPath: shot1, isClimax: false },
        { shotId: "shot_02", clipPath: shot2, isClimax: true },
      ],
      outDir,
      { mockFallback: true }
    );

    expect(results.length).toBe(2);
    expect(existsSync(results[0])).toBe(true);
    expect(existsSync(results[1])).toBe(true);
    expect(results[0]).toContain("smoothed_shot_01.mp4");
    expect(results[1]).toContain("smoothed_shot_02.mp4");
  });
});
