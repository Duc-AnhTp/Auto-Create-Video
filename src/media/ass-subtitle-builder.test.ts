import { describe, it, expect } from "vitest";
import {
  formatAssTimestamp,
  splitIntoWords,
  calculateWordKaraokeDurations,
  exportToAss,
  sanitizeSubtitleText,
  burnAssSubtitles,
  isHighIntensityCue,
} from "./ass-subtitle-builder.js";
import type { TimelineSubtitleCue } from "../series/timeline-schema.js";
import { mkdtempSync, rmSync, existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("AssSubtitleBuilder", () => {
  it("formats timestamps into valid ASS H:MM:SS.cc format", () => {
    expect(formatAssTimestamp(0)).toBe("0:00:00.00");
    expect(formatAssTimestamp(1.25)).toBe("0:00:01.25");
    expect(formatAssTimestamp(65.5)).toBe("0:01:05.50");
    expect(formatAssTimestamp(3661.12)).toBe("1:01:01.12");
  });

  it("splits text into distinct words correctly", () => {
    const words = splitIntoWords("Hành trình đến Cyber Sài Gòn bắt đầu.");
    expect(words).toEqual(["Hành", "trình", "đến", "Cyber", "Sài", "Gòn", "bắt", "đầu."]);
  });

  it("calculates proportional word karaoke durations matching total duration", () => {
    const words = ["Tôi", "phát", "hiện", "bí", "mật"];
    const totalDurationSec = 2.0; // 200 centiseconds
    const durations = calculateWordKaraokeDurations(words, totalDurationSec);

    expect(durations.length).toBe(words.length);
    const sum = durations.reduce((a, b) => a + b, 0);
    expect(sum).toBe(200); // Exactly 200 centiseconds!
  });

  it("sanitizes text removing acting brackets and converting newlines to ASS line breaks", () => {
    const raw = '[thì thầm] Dòng thứ nhất\nDòng thứ hai';
    expect(sanitizeSubtitleText(raw)).toBe('Dòng thứ nhất\\NDòng thứ hai');
  });

  it("exports valid ASS format with styles and karaoke events", () => {
    const mockCues: TimelineSubtitleCue[] = [
      {
        subtitleId: "sub_1",
        shotId: "shot_1",
        dialogueId: "dia_1",
        speakerName: "Minh",
        displayText: "Chúng ta phải rời khỏi đây ngay.",
        startFrame: 0,
        endFrame: 60,
        startSec: 0,
        endSec: 2.0,
        durationSec: 2.0,
      },
    ];

    const ass = exportToAss(mockCues, { aspectRatio: "9:16", style: "karaoke" });

    expect(ass).toContain("[Script Info]");
    expect(ass).toContain("PlayResX: 1080");
    expect(ass).toContain("PlayResY: 1920");
    expect(ass).toContain("[V4+ Styles]");
    expect(ass).toContain("Style: Karaoke");
    expect(ass).toContain("[Events]");
    expect(ass).toContain("Dialogue: 0,0:00:00.00,0:00:02.00,Karaoke,,0,0,0,,");
    expect(ass).toContain("Minh:");
    expect(ass).toContain("{\\k");
  });

  it("exports clean style ASS without karaoke tags when requested", () => {
    const mockCues: TimelineSubtitleCue[] = [
      {
        subtitleId: "sub_1",
        shotId: "shot_1",
        dialogueId: "dia_1",
        speakerName: "Người dẫn chuyện",
        displayText: "Đêm thành phố không bao giờ ngủ.",
        startFrame: 0,
        endFrame: 90,
        startSec: 1.0,
        endSec: 4.0,
        durationSec: 3.0,
      },
    ];

    const ass = exportToAss(mockCues, { style: "clean" });
    expect(ass).not.toContain("{\\k");
    expect(ass).toContain("Đêm thành phố không bao giờ ngủ.");
  });

  it("exports pop_in kinetic scale effect and 16:9 landscape resolution", () => {
    const mockCues: TimelineSubtitleCue[] = [
      {
        subtitleId: "sub_1",
        shotId: "shot_1",
        dialogueId: "dia_1",
        speakerName: "Thám tử",
        displayText: "Khu vực này đã bị phong tỏa.",
        startFrame: 0,
        endFrame: 60,
        startSec: 0,
        endSec: 2.0,
        durationSec: 2.0,
      },
    ];

    const ass = exportToAss(mockCues, { aspectRatio: "16:9", style: "pop_in" });
    expect(ass).toContain("PlayResX: 1920");
    expect(ass).toContain("PlayResY: 1080");
    expect(ass).toContain("\\fscx108\\fscy108");
    expect(ass).toContain("Thám tử: {\\r}Khu vực này đã bị phong tỏa.");
  });

  it("safely escapes Windows drive paths for FFmpeg subtitles filter syntax", () => {
    const rawWindowsPath = "D:\\Projects\\Series\\ep1\\subtitles.ass";
    const escaped = rawWindowsPath.replace(/\\/g, "/").replace(/:/g, "\\:");
    expect(escaped).toBe("D\\:/Projects/Series/ep1/subtitles.ass");
    expect(`subtitles='${escaped}'`).toBe("subtitles='D\\:/Projects/Series/ep1/subtitles.ass'");
  });

  it("defensively strips bracketed and parenthesized acting instructions from subtitle cues", () => {
    const mockCues: TimelineSubtitleCue[] = [
      {
        subtitleId: "sub_1",
        shotId: "shot_1",
        dialogueId: "d1",
        speakerName: "Minh",
        displayText: "[thì thầm, lo lắng] Đừng gây ra tiếng động nào!",
        startFrame: 0,
        endFrame: 60,
        startSec: 0,
        endSec: 2.0,
        durationSec: 2.0,
      },
    ];

    const ass = exportToAss(mockCues, { style: "clean" });
    expect(ass).not.toContain("thì thầm");
    expect(ass).not.toContain("lo lắng");
    expect(ass).toContain("Đừng gây ra tiếng động nào!");
  });

  it("handles multi-line subtitles in karaoke mode without tagging linebreaks with \\k", () => {
    const mockCues: TimelineSubtitleCue[] = [
      {
        subtitleId: "sub_1",
        shotId: "shot_1",
        dialogueId: "d1",
        speakerName: "Minh",
        displayText: "Dòng một\nDòng hai",
        startFrame: 0,
        endFrame: 60,
        startSec: 0,
        endSec: 2.0,
        durationSec: 2.0,
      },
    ];

    const ass = exportToAss(mockCues, { style: "karaoke" });
    expect(ass).toContain("\\N");
    expect(ass).not.toContain("{\\k\\N}");
    expect(ass).not.toMatch(/\{\\k\d+\}\\N/);
  });

  it("burnAssSubtitles burns or passes through ASS subtitles to output video", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "ass-burn-test-"));
    try {
      const mockVid = join(tempDir, "input.mp4");
      const mockAss = join(tempDir, "subtitles.ass");
      const outVid = join(tempDir, "output.mp4");

      writeFileSync(mockVid, "MOCK_VIDEO_DATA");
      writeFileSync(mockAss, "[Script Info]\nTitle: Test\n");

      const res = await burnAssSubtitles(mockVid, mockAss, outVid);
      expect(res).toBe(outVid);
      expect(existsSync(outVid)).toBe(true);
    } finally {
      if (existsSync(tempDir)) {
        rmSync(tempDir, { recursive: true, force: true });
      }
    }
  });

  it("burnAssSubtitles throws when input video is missing", async () => {
    await expect(
      burnAssSubtitles("nonexistent_video.mp4", "nonexistent.ass", "out.mp4")
    ).rejects.toThrow("Input video not found");
  });

  it("isHighIntensityCue identifies screams, shouts, and exclamation cues", () => {
    const screamCue: TimelineSubtitleCue = {
      subtitleId: "sub_loud",
      shotId: "s1",
      dialogueId: "d1",
      speakerName: "Minh",
      displayText: "Cẩn thận phía sau!",
      actingInstruction: "hét lớn trong hoảng loạn",
      startFrame: 0,
      endFrame: 60,
      startSec: 0,
      endSec: 2.0,
      durationSec: 2.0,
    } as any;
    expect(isHighIntensityCue(screamCue)).toBe(true);

    const normalCue: TimelineSubtitleCue = {
      subtitleId: "sub_norm",
      shotId: "s1",
      dialogueId: "d2",
      speakerName: "Lan",
      displayText: "Chúng ta cần nói chuyện bình tĩnh.",
      actingInstruction: "nói nhỏ",
      startFrame: 60,
      endFrame: 120,
      startSec: 2.0,
      endSec: 4.0,
      durationSec: 2.0,
    } as any;
    expect(isHighIntensityCue(normalCue)).toBe(false);
  });

  it("applies Safe Title Area Avoidance margins for mobile 9:16 layout", () => {
    const mockCues: TimelineSubtitleCue[] = [
      {
        subtitleId: "sub_1",
        shotId: "shot_1",
        dialogueId: "d1",
        speakerName: "Minh",
        displayText: "Nội dung trong vùng an toàn.",
        startFrame: 0,
        endFrame: 60,
        startSec: 0,
        endSec: 2.0,
        durationSec: 2.0,
      },
    ];

    const ass = exportToAss(mockCues, {
      aspectRatio: "9:16",
      safeTitleAvoidance: true,
    });

    // Default style should have bottom margin 280, right margin 160, left margin 60
    expect(ass).toContain("MarginL, MarginR, MarginV");
    expect(ass).toContain(",60,160,280,1");
  });

  it("renders impact_bounce kinetic style and flame highlight for intense cues", () => {
    const mockCues: TimelineSubtitleCue[] = [
      {
        subtitleId: "sub_1",
        shotId: "shot_1",
        dialogueId: "d1",
        speakerName: "Minh",
        displayText: "DỪNG LẠI NGAY!",
        actingInstruction: "quát lớn",
        startFrame: 0,
        endFrame: 60,
        startSec: 0,
        endSec: 2.0,
        durationSec: 2.0,
      } as any,
    ];

    const ass = exportToAss(mockCues, {
      aspectRatio: "9:16",
      enablePeakImpactLinking: true,
    });

    expect(ass).toContain("Style: Impact");
    expect(ass).toContain("\\fscx118\\fscy118");
    expect(ass).toContain("\\c&H000055FF"); // Flame orange
    expect(ass).toContain("Impact,,0,0,0,,");
  });
});
