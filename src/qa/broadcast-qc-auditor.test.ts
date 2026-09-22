import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { BroadcastQcAuditor } from "./broadcast-qc-auditor.js";
import { createValidMockMp4File, createValidMockMp3File } from "../assets/mock-media-generator.js";

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "broadcast-qc-test-"));
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe("Phase 4: Broadcast Quality Control (QC) & Film Delivery Compliance Suite", () => {
  it("audits video and audio delivery files against EBU R128 standard", async () => {
    const videoPath = join(tmp, "master_video.mp4");
    const audioPath = join(tmp, "master_audio.mp3");
    await createValidMockMp4File(videoPath, 5.0, 720, 1280);
    await createValidMockMp3File(audioPath, 5.0);

    const report = await BroadcastQcAuditor.auditDelivery({
      masterVideoPath: videoPath,
      masterAudioPath: audioPath,
      targetStandard: "broadcast_ebu_r128",
      mockFallback: true,
    });

    expect(report.overallPassed).toBe(false);
    expect(report.evidence).toBe("mock");
    expect(report.checks.length).toBeGreaterThanOrEqual(4);
    const peakCheck = report.checks.find((c) => c.id === "aud_true_peak");
    expect(peakCheck).toBeDefined();
    expect(peakCheck?.passed).toBe(true);

    const lufsCheck = report.checks.find((c) => c.id === "aud_lufs");
    expect(lufsCheck).toBeDefined();
    expect(lufsCheck?.passed).toBe(true);
  });

  it("checks dialogue-to-music clarity margin when stems are provided", async () => {
    const videoPath = join(tmp, "master_video.mp4");
    const diagPath = join(tmp, "stem_dialogue.mp3");
    const bgmPath = join(tmp, "stem_bgm.mp3");
    await createValidMockMp4File(videoPath, 5.0);
    await createValidMockMp3File(diagPath, 5.0);
    await createValidMockMp3File(bgmPath, 5.0);

    const report = await BroadcastQcAuditor.auditDelivery({
      masterVideoPath: videoPath,
      dialogueStemPath: diagPath,
      bgmStemPath: bgmPath,
      mockFallback: true,
    });

    const clarityCheck = report.checks.find((c) => c.id === "aud_dialogue_clarity");
    expect(clarityCheck).toBeDefined();
  });
});
