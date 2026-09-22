import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { MmaudioFoleyClient } from "./foley-generator.js";

let tmp: string;
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "foley-test-"));
});
afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe("MmaudioFoleyClient", () => {
  it("synthesizes synchronized Foley with mock fallback when offline", async () => {
    const client = new MmaudioFoleyClient({
      endpoint: "http://127.0.0.1:59998",
      mockFallback: true,
    });

    const outPath = join(tmp, "foley_footsteps.mp3");
    const res = await client.generateFoley(
      "dummy_shot_01.mp4",
      "Tiếng bước chân gấp gáp trên sàn gỗ",
      outPath,
      { durationSec: 2.5 }
    );

    expect(existsSync(res)).toBe(true);
    expect(res).toBe(outPath);
  });
});
