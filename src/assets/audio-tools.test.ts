import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execSync } from "node:child_process";
import { getDurationSec, concatWithSilence, mixBgmWithDucking } from "./audio-tools.js";

function hasBinary(bin: string): boolean {
  try {
    execSync(`${bin} -version`, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

const hasFfmpeg = hasBinary("ffmpeg") && hasBinary("ffprobe");

let tmp: string;
beforeEach(() => { tmp = mkdtempSync(join(tmpdir(), "aud-")); });
afterEach(() => { rmSync(tmp, { recursive: true, force: true }); });

describe.skipIf(!hasFfmpeg)("getDurationSec", () => {
  it("returns ~2s for sample-audio-1.mp3", async () => {
    const d = await getDurationSec("tests/fixtures/sample-audio-1.mp3");
    expect(d).toBeGreaterThan(1.9);
    expect(d).toBeLessThan(2.2);
  });
});

describe.skipIf(!hasFfmpeg)("concatWithSilence", () => {
  it("concatenates two mp3s with 0.3s gap", async () => {
    const out = join(tmp, "voice.mp3");
    await concatWithSilence(
      ["tests/fixtures/sample-audio-1.mp3", "tests/fixtures/sample-audio-2.mp3"],
      0.3,
      out,
    );
    expect(existsSync(out)).toBe(true);
    const d = await getDurationSec(out);
    // 2s + 0.3s + 3s = 5.3s, allow ±0.3s
    expect(d).toBeGreaterThan(5.0);
    expect(d).toBeLessThan(5.6);
  });
});

describe.skipIf(!hasFfmpeg)("mixBgmWithDucking", () => {
  it("mixes bgm with ducking onto voice track", async () => {
    const out = join(tmp, "voice-with-bgm.mp3");
    // Use sample-audio-1 as voice and sample-audio-2 as BGM
    await mixBgmWithDucking(
      "tests/fixtures/sample-audio-1.mp3",
      "tests/fixtures/sample-audio-2.mp3",
      out,
      { bgmVolume: 0.15, duckRatio: 8 }
    );
    expect(existsSync(out)).toBe(true);
    const d = await getDurationSec(out);
    // Output duration should match primary voice audio length (~2s)
    expect(d).toBeGreaterThan(1.8);
    expect(d).toBeLessThan(2.3);
  });

  it("loops BGM seamlessly when voice track is longer than BGM", async () => {
    const out = join(tmp, "voice-longer-than-bgm.mp3");
    // sample-audio-2 (~3s) as voice, sample-audio-1 (~2s) as BGM -> triggers stream loop
    await mixBgmWithDucking(
      "tests/fixtures/sample-audio-2.mp3",
      "tests/fixtures/sample-audio-1.mp3",
      out,
      { bgmVolume: 0.20, duckRatio: 6 }
    );
    expect(existsSync(out)).toBe(true);
    const d = await getDurationSec(out);
    // Output duration should match sample-audio-2 length (~3s)
    expect(d).toBeGreaterThan(2.8);
    expect(d).toBeLessThan(3.4);
  });
});
