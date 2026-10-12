import { describe, it, expect } from "vitest";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { FileAudioGenerationStore } from "./audio-generation-store.js";
import { createTimelineFixture } from "../../../../__test-utils__/timeline-fixture.js";
import type { AudioGenerationManifest } from "../../../../contracts/audio-generation.js";

describe("FileAudioGenerationStore materialize", () => {
  it("should write timeline.json, unified_timeline.json, and script-normalized.json concurrently", async () => {
    const root = await mkdtemp(join(tmpdir(), "store-mat-test-"));
    const store = new FileAudioGenerationStore();

    const sampleTimeline = createTimelineFixture({
      episodeNumber: 1,
      targetTotalDurationSec: 5.0,
      fps: 24,
    });

    const scriptMockPath = join(root, "mock-script.json");
    const scriptMockContent = JSON.stringify({ scenes: [] });
    await writeFile(scriptMockPath, scriptMockContent, "utf8");

    const manifest: AudioGenerationManifest = {
      version: 1,
      generationId: "gen-123",
      fingerprint: "fp-123",
      mockTts: true,
      fps: 24,
      durationSec: 5.0,
      audio: { path: "dummy.mp3", sha256: "abc" },
      timeline: { path: "dummy-tl.json", sha256: "def" },
      script: { path: scriptMockPath, sha256: "ghi" },
      planningShotDurations: {},
      shotDurations: {},
    };

    try {
      await store.materialize(root, manifest, sampleTimeline);

      const timelineOut = JSON.parse(await readFile(join(root, "timeline.json"), "utf8"));
      const unifiedOut = JSON.parse(await readFile(join(root, "artifacts", "unified_timeline.json"), "utf8"));
      const scriptOut = JSON.parse(await readFile(join(root, "script-normalized.json"), "utf8"));

      expect(timelineOut.targetTotalDurationSec).toBe(5.0);
      expect(unifiedOut.targetTotalDurationSec).toBe(5.0);
      expect(scriptOut).toEqual({ scenes: [] });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
