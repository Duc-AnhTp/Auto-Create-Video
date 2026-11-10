import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { BroadcastQcAuditor } from "./broadcast-qc-auditor.js";
import { createValidMockMp4File, createValidMockMp3File } from "./assets/mock-media-generator.js";

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

  it("skips 3-second hook check for 16:9 widescreen master video", async () => {
    const videoPath = join(tmp, "master_widescreen.mp4");
    await createValidMockMp4File(videoPath, 10.0, 1920, 1080);

    const report = await BroadcastQcAuditor.auditDelivery({
      masterVideoPath: videoPath,
      aspectRatio: "16:9",
      firstShotDurationSec: 5.0,
      mockFallback: true,
    });

    const hookCheck = report.checks.find((c) => c.id === "short_3s_hook");
    expect(hookCheck).toBeUndefined();
  });

  it("verifies 3-second visual hook retention check for 9:16 vertical video", async () => {
    const videoPath = join(tmp, "master_vertical.mp4");
    await createValidMockMp4File(videoPath, 5.0, 720, 1280);

    // Fail case: first shot > 3.2s
    const failReport = await BroadcastQcAuditor.auditDelivery({
      masterVideoPath: videoPath,
      aspectRatio: "9:16",
      firstShotDurationSec: 4.5,
      mockFallback: true,
    });
    const failHookCheck = failReport.checks.find((c) => c.id === "short_3s_hook");
    expect(failHookCheck).toBeDefined();
    expect(failHookCheck?.passed).toBe(false);

    // Pass case: first shot <= 3.2s
    const passReport = await BroadcastQcAuditor.auditDelivery({
      masterVideoPath: videoPath,
      aspectRatio: "9:16",
      firstShotDurationSec: 3.0,
      mockFallback: true,
    });
    const passHookCheck = passReport.checks.find((c) => c.id === "short_3s_hook");
    expect(passHookCheck).toBeDefined();
    expect(passHookCheck?.passed).toBe(true);
  });

  it("verifies safe title margins for 4:5 portrait subtitles", async () => {
    const videoPath = join(tmp, "master_4x5.mp4");
    const assPath = join(tmp, "subtitles_4x5.ass");
    await createValidMockMp4File(videoPath, 5.0, 720, 900);

    const { writeFileSync } = await import("node:fs");
    const assContent = `[Script Info]
Title: Test 4:5
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1350

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Arial,50,&H00FFFFFF,&H0000FFFF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,3.5,2.0,2,60,120,240,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:01.00,0:00:03.00,Default,,0,0,0,,Phụ đề mẫu 4:5
`;
    writeFileSync(assPath, assContent, "utf8");

    const report = await BroadcastQcAuditor.auditDelivery({
      masterVideoPath: videoPath,
      subtitleAssPath: assPath,
      aspectRatio: "4:5",
      mockFallback: true,
    });

    const subCheck = report.checks.find((c) => c.id === "sub_safe_title");
    expect(subCheck).toBeDefined();
    expect(subCheck?.name).toBe("Mobile 4:5 Safe Title Subtitle Margins");
    expect(subCheck?.passed).toBe(true);
  });
});
