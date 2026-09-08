import { describe, it, expect } from "vitest";
import {
  decomposeShotDuration,
  buildExtractFinalFrameArgs,
  buildCrossfadeStitchFilter,
} from "./shot-chaining.js";

describe("Shot Chaining & Autoregressive Frame Extension", () => {
  it("keeps single pass for shots within native limit (<= 5s)", () => {
    const dec = decomposeShotDuration("shot_short", 4.2);
    expect(dec.requiresExtension).toBe(false);
    expect(dec.passes.length).toBe(1);
    expect(dec.passes[0].type).toBe("t2v");
    expect(dec.passes[0].durationSec).toBe(4.2);
    expect(dec.passes[0].conditionFromPass).toBeUndefined();
  });

  it("decomposes 8.5s shot into Pass 1 (5s T2V) + Pass 2 (3.5s I2V extension)", () => {
    const dec = decomposeShotDuration("shot_mid", 8.5);
    expect(dec.requiresExtension).toBe(true);
    expect(dec.passes.length).toBe(2);

    // Pass 1: 5.0s T2V
    expect(dec.passes[0].passIndex).toBe(1);
    expect(dec.passes[0].type).toBe("t2v");
    expect(dec.passes[0].durationSec).toBe(5.0);

    // Pass 2: 3.5s I2V conditioned on Pass 1
    expect(dec.passes[1].passIndex).toBe(2);
    expect(dec.passes[1].type).toBe("i2v_extend");
    expect(dec.passes[1].durationSec).toBe(3.5);
    expect(dec.passes[1].conditionFromPass).toBe(1);
  });

  it("decomposes 12s shot into 3 passes (5s + 5s + 2s)", () => {
    const dec = decomposeShotDuration("shot_long", 12.0);
    expect(dec.passes.length).toBe(3);
    expect(dec.passes[0].durationSec).toBe(5.0);
    expect(dec.passes[1].durationSec).toBe(5.0);
    expect(dec.passes[1].conditionFromPass).toBe(1);
    expect(dec.passes[2].durationSec).toBe(2.0);
    expect(dec.passes[2].conditionFromPass).toBe(2);
  });

  it("builds correct FFmpeg command to extract final frame for I2V conditioning", () => {
    const args = buildExtractFinalFrameArgs("clip_1.mp4", "frame_last.png");
    expect(args).toContain("-sseof");
    expect(args).toContain("-update");
    expect(args).toContain("frame_last.png");
  });

  it("generates crossfade stitch filter with correct timing offsets and no trailing semicolon", () => {
    const clips = ["sub1.mp4", "sub2.mp4"];
    const durations = [5.0, 3.5];
    const { filterComplex, totalOutputDuration } = buildCrossfadeStitchFilter(clips, durations, 0.1);

    expect(filterComplex).toContain("xfade=transition=fade:duration=0.1:offset=4.90[vout]");
    expect(filterComplex.endsWith(";")).toBe(false);
    expect(totalOutputDuration).toBeCloseTo(8.40);
  });

  it("handles short clips without negative offsets", () => {
    const clips = ["short1.mp4", "short2.mp4"];
    const durations = [0.05, 1.0]; // first clip shorter than crossfadeSec
    const { filterComplex } = buildCrossfadeStitchFilter(clips, durations, 0.1);

    expect(filterComplex).toContain("offset=0.00[vout]");
    expect(filterComplex.endsWith(";")).toBe(false);
  });
});
