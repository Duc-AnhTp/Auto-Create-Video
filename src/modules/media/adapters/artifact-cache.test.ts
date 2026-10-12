import { describe, it, expect, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { MediaArtifactCache } from "./artifact-cache.js";
import * as validator from "./media-validator.js";
import * as store from "./artifact-store.js";

describe("MediaArtifactCache record with optional sha256", () => {
  it("should reuse provided sha256 and avoid calling hashFile", async () => {
    const root = await mkdtemp(join(tmpdir(), "artifact-cache-test-"));
    const manifestPath = join(root, "delivery-cache.json");
    const cache = new MediaArtifactCache(manifestPath);

    vi.spyOn(validator, "probeVideoFile").mockResolvedValue({
      isValid: true,
      durationSec: 5.0,
      width: 1920,
      height: 1080,
      fps: 24,
    } as any);

    const hashSpy = vi.spyOn(store, "hashFile").mockResolvedValue("calculated-hash");

    const validSha256 = "a".repeat(64);
    try {
      await cache.record("fp-123", [
        { path: join(root, "video.mp4"), kind: "video", sha256: validSha256 },
      ]);

      expect(hashSpy).not.toHaveBeenCalled();
    } finally {
      vi.restoreAllMocks();
      await rm(root, { recursive: true, force: true });
    }
  });
});
