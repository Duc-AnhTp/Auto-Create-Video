import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { copyFile, mkdtemp, rm } from "node:fs/promises";
import { resolve, join, isAbsolute } from "node:path";
import { tmpdir } from "node:os";
import type { TimelineSubtitleCue } from "../series/timeline-schema.js";
import { hasFfmpeg } from "../assets/mock-media-generator.js";

export interface AssSubtitleOptions {
  /** Video orientation / aspect ratio: "9:16" (default for mobile), "16:9", "1:1", "4:5" */
  aspectRatio?: "9:16" | "16:9" | "1:1" | "4:5" | string;
  /** Font family for subtitles, e.g. "Arial", "Montserrat", "Impact" */
  fontFamily?: string;
  /** Primary text color in ASS BGR hex, e.g. "&H00FFFFFF" (White) */
  primaryColor?: string;
  /** Karaoke highlight color in ASS BGR hex, e.g. "&H0000FFFF" (Yellow) */
  highlightColor?: string;
  /** Outline border color in ASS BGR hex, e.g. "&H00000000" (Black) */
  outlineColor?: string;
  /** Font size in pixels (default: 52 for 1080x1920, 42 for 1920x1080) */
  fontSize?: number;
  /** Subtitle animation style: "karaoke" | "pop_in" | "clean" | "impact_bounce" */
  style?: "karaoke" | "pop_in" | "clean" | "impact_bounce";
  /** Bottom margin in pixels (default: 220 for 9:16, 80 for 16:9) */
  marginV?: number;
  /** Left margin in pixels */
  marginL?: number;
  /** Right margin in pixels */
  marginR?: number;
  /** Enable Safe Title Avoidance Zone for mobile short-form UI (avoids TikTok/Shorts action buttons) */
  safeTitleAvoidance?: boolean;
  /** Automatically trigger dramatic impact scaling and flame highlight on high-intensity cues */
  enablePeakImpactLinking?: boolean;
}

/**
 * Detects if a subtitle cue carries high emotional or acoustic intensity
 * (e.g. screams, shouts, high volume, urgent exclamation).
 */
export function isHighIntensityCue(cue: TimelineSubtitleCue): boolean {
  const instruction = ((cue as any).actingInstruction || "").toLowerCase();
  const rawText = (cue.displayText || (cue as any).text || "").trim();
  const isLoudInstruction = /(?:hét|gắt|tức giận|la lớn|quát|screams?|shouts?|yells?|furious|urgent|frantic)/i.test(
    instruction
  );
  const hasExclamation = rawText.includes("!") || rawText.includes("!?");
  const isHighVolume = typeof (cue as any).volume === "number" && (cue as any).volume > 1.05;
  return isLoudInstruction || (hasExclamation && rawText.length <= 45) || isHighVolume;
}

/**
 * Formats seconds into standard ASS timestamp: H:MM:SS.cc (centiseconds).
 * ASS uses 2 decimal places for fractions of a second (1 centisecond = 10ms).
 */
export function formatAssTimestamp(sec: number): string {
  const safeSec = typeof sec === "number" && isFinite(sec) ? Math.max(0, sec) : 0;
  const hours = Math.floor(safeSec / 3600);
  const minutes = Math.floor((safeSec % 3600) / 60);
  const seconds = Math.floor(safeSec % 60);
  const centis = Math.floor(Math.round((safeSec % 1) * 100));

  const mm = String(minutes).padStart(2, "0");
  const ss = String(seconds).padStart(2, "0");
  const cc = String(Math.min(99, centis)).padStart(2, "0");

  return `${hours}:${mm}:${ss}.${cc}`;
}

/**
 * Strips outer quotes and bracketed/parenthesized acting instructions from subtitle text.
 */
export function sanitizeSubtitleText(raw: string): string {
  if (!raw) return "";
  let text = raw.trim();
  // Strip outer quotes
  if ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith("'") && text.endsWith("'"))) {
    text = text.slice(1, -1).trim();
  }
  // Strip leading acting instruction [instruction] or (instruction)
  text = text.replace(/^(?:\[[^\]]+\]|\([^)]+\)\s*)+/s, "").trim();
  // Strip outer quotes again if instruction was inside quotes
  if ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith("'") && text.endsWith("'"))) {
    text = text.slice(1, -1).trim();
  }
  // Convert newlines to ASS line break \N
  text = text.replace(/\r\n|\r|\n/g, "\\N");
  return text;
}

/**
 * Splits text into words while preserving punctuation and spacing.
 * Isolates \N line breaks so they are preserved as distinct tokens.
 */
export function splitIntoWords(text: string): string[] {
  const normalized = text.replace(/\\N/g, " \\N ");
  return normalized.trim().split(/\s+/).filter((w) => w.length > 0);
}

/**
 * Distributes total cue duration (in centiseconds) across words proportionally to their character lengths.
 */
export function calculateWordKaraokeDurations(words: string[], totalDurationSec: number): number[] {
  if (words.length === 0) return [];
  const safeDurationSec =
    typeof totalDurationSec === "number" && isFinite(totalDurationSec) && totalDurationSec > 0
      ? totalDurationSec
      : 1.0;
  const totalCs = Math.max(1, Math.round(safeDurationSec * 100));
  const totalChars = words.reduce((acc, w) => acc + w.length, 0);

  if (totalChars === 0) {
    const avg = Math.floor(totalCs / words.length);
    return words.map(() => avg);
  }

  let accumulated = 0;
  const durations: number[] = [];

  for (let i = 0; i < words.length; i++) {
    if (i === words.length - 1) {
      // Allocate remaining centiseconds to last word to guarantee exact sum
      durations.push(Math.max(1, totalCs - accumulated));
    } else {
      const share = Math.max(1, Math.round((words[i].length / totalChars) * totalCs));
      durations.push(share);
      accumulated += share;
    }
  }

  return durations;
}

/**
 * Converts unified timeline subtitle cues into Advanced SubStation Alpha (.ass v4.00+)
 * with dynamic Karaoke timing, pop-in animation, and high-retention typography.
 */
export function exportToAss(
  subtitles: TimelineSubtitleCue[],
  options: AssSubtitleOptions = {}
): string {
  const aspect = options.aspectRatio || "9:16";
  const isLandscape = aspect === "16:9";
  const isSquare = aspect === "1:1";
  const isPortrait = !isLandscape && !isSquare;

  const playResX = isLandscape ? 1920 : 1080;
  const playResY = isLandscape ? 1080 : isSquare ? 1080 : 1920;
  const fontFamily = options.fontFamily || "Arial";
  const fontSize = options.fontSize || (isPortrait ? 54 : isSquare ? 48 : 44);
  const primaryColor = options.primaryColor || "&H00FFFFFF"; // White (AABBGGRR)
  const highlightColor = options.highlightColor || "&H0000FFFF"; // Bright Yellow
  const outlineColor = options.outlineColor || "&H00000000"; // Black

  // Safe Title Area Avoidance: clears TikTok/Shorts bottom seekbars and right action buttons
  const isSafeTitle = options.safeTitleAvoidance ?? isPortrait;
  const marginV = options.marginV || (isSafeTitle && isPortrait ? 280 : isPortrait ? 240 : isSquare ? 140 : 90);
  const marginR = options.marginR || (isSafeTitle && isPortrait ? 160 : 40);
  const marginL = options.marginL || (isSafeTitle && isPortrait ? 60 : 40);

  const styleType = options.style || "karaoke";

  const header = `[Script Info]
; Script generated by Auto-Create-Video Kinetic Subtitle Engine
Title: Episodic Film Kinetic Subtitles
ScriptType: v4.00+
WrapStyle: 0
ScaledBorderAndShadow: yes
YCbCr Matrix: TV.709
PlayResX: ${playResX}
PlayResY: ${playResY}

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,${fontFamily},${fontSize},${primaryColor},${highlightColor},${outlineColor},&H80000000,-1,0,0,0,100,100,0,0,1,3.5,2.0,2,${marginL},${marginR},${marginV},1
Style: Karaoke,${fontFamily},${fontSize + 2},${highlightColor},${primaryColor},${outlineColor},&H90000000,-1,0,0,0,100,100,0,0,1,4.0,2.5,2,${marginL},${marginR},${marginV},1
Style: Impact,${fontFamily},${fontSize + 4},&H000055FF,&H00FFFFFF,&H00000000,&HA0000000,-1,0,0,0,105,105,0,0,1,5.0,3.0,2,${marginL},${marginR},${marginV},1
Style: SpeakerTag,${fontFamily},${Math.round(fontSize * 0.7)},&H0000D7FF,&H00FFFFFF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,2.0,1.0,2,${marginL},${marginR},${marginV + 65},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;

  const dialogueLines = subtitles.map((cue) => {
    const start = formatAssTimestamp(cue.startSec);
    const end = formatAssTimestamp(cue.endSec);
    const speaker = cue.speakerName && cue.speakerName !== "Người dẫn chuyện" ? cue.speakerName : "";
    const cleanText = sanitizeSubtitleText(cue.displayText || (cue as any).text || (cue as any).line || "");
    const inlineBreakText = cleanText.replace(/\s*\\N\s*/g, "\\N");
    const isPeak = options.enablePeakImpactLinking && isHighIntensityCue(cue);

    // 1. Clean Style: Plain readable subtitle
    if (styleType === "clean") {
      const text = speaker ? `{\\c&H0000D7FF}${speaker}: {\\r}${inlineBreakText}` : inlineBreakText;
      return `Dialogue: 0,${start},${end},Default,,0,0,0,,${text}`;
    }

    // 2. Pop-in Style: Kinetic scale pop on start
    if (styleType === "pop_in") {
      const popEffect = "{\\t(0,120,\\fscx108\\fscy108)\\t(120,240,\\fscx100\\fscy100)}";
      const text = speaker
        ? `${popEffect}{\\c&H0000D7FF}${speaker}: {\\r}${inlineBreakText}`
        : `${popEffect}${inlineBreakText}`;
      return `Dialogue: 0,${start},${end},Default,,0,0,0,,${text}`;
    }

    // 3. Impact Bounce Style or Peak High-Intensity Line
    if (styleType === "impact_bounce" || isPeak) {
      const impactEffect = "{\\fscx118\\fscy118\\t(0,140,\\fscx100\\fscy100)}";
      const flameHighlight = "{\\c&H000055FF}"; // Flame Orange
      const text = speaker
        ? `${impactEffect}${flameHighlight}${speaker}: {\\rImpact}${inlineBreakText}`
        : `${impactEffect}${flameHighlight}${inlineBreakText}`;
      return `Dialogue: 0,${start},${end},Impact,,0,0,0,,${text}`;
    }

    // 4. Karaoke Style: Word-by-word highlight transition (\k<centis>)
    const words = splitIntoWords(cleanText);
    const spokenWords = words.filter((w) => w !== "\\N");
    const cueDur =
      typeof cue.durationSec === "number" && isFinite(cue.durationSec) && cue.durationSec > 0
        ? cue.durationSec
        : typeof cue.endSec === "number" && typeof cue.startSec === "number" && cue.endSec > cue.startSec
          ? cue.endSec - cue.startSec
          : 1.0;
    const wordDurations = calculateWordKaraokeDurations(spokenWords, cueDur);

    let durIdx = 0;
    const parts: string[] = [];
    for (const w of words) {
      if (w === "\\N") {
        parts.push("\\N");
      } else {
        parts.push(`{\\k${wordDurations[durIdx++]}}${w}`);
      }
    }
    const karaokeBody = parts.join(" ").replace(/\s*\\N\s*/g, "\\N");

    const fullLine = speaker
      ? `{\\c&H0000D7FF}${speaker}: {\\rKaraoke}${karaokeBody}`
      : karaokeBody;

    return `Dialogue: 0,${start},${end},Karaoke,,0,0,0,,${fullLine}`;
  });

  return header + dialogueLines.join("\n") + "\n";
}

export interface BurnAssOptions {
  ffmpegPath?: string;
  videoCodec?: string;
  audioCodec?: string;
  crf?: number;
  preset?: string;
}

/**
 * Burns Advanced SubStation Alpha (.ass) kinetic subtitles onto a video using FFmpeg.
 * Properly escapes paths for Windows and POSIX path separators in filter graphs.
 */
export async function burnAssSubtitles(
  videoInputPath: string,
  assSubtitlePath: string,
  videoOutputPath: string,
  options: BurnAssOptions = {}
): Promise<string> {
  if (!existsSync(videoInputPath)) {
    throw new Error(`Input video not found: ${videoInputPath}`);
  }
  if (!existsSync(assSubtitlePath)) {
    throw new Error(`ASS subtitle file not found: ${assSubtitlePath}`);
  }

  if (!options.ffmpegPath && !(await hasFfmpeg())) throw new Error("FFmpeg is required to burn ASS subtitles");

  const ffmpegBin = options.ffmpegPath || "ffmpeg";
  // Use a fixed relative filter filename: filter escaping otherwise breaks drive
  // letters, apostrophes and brackets even though spawn receives an argument array.
  const workspace = await mkdtemp(join(tmpdir(), "studio-ass-"));
  const filterArg = "ass=filename=subtitles.ass";

  const args = [
    "-y",
    "-i",
    resolve(videoInputPath),
    "-vf",
    filterArg,
    "-c:v",
    options.videoCodec || "libx264",
    "-preset",
    options.preset || "fast",
    "-crf",
    String(options.crf ?? 20),
    "-c:a",
    options.audioCodec || "copy",
    resolve(videoOutputPath),
  ];

  try {
    await copyFile(assSubtitlePath, join(workspace, "subtitles.ass"));
    return await new Promise<string>((res, rej) => {
      const binary = isAbsolute(ffmpegBin) || !/[\\/]/.test(ffmpegBin) ? ffmpegBin : resolve(ffmpegBin);
      const proc = spawn(binary, args, { cwd: workspace, windowsHide: true });
      let timedOut = false;
      let settled = false;

      const timer = setTimeout(() => {
        timedOut = true;
        try {
          proc.kill("SIGKILL");
        } catch {}
      }, 120000);

      let err = "";
      proc.stderr.on("data", (d) => (err += d.toString()));
      proc.on("close", (code) => {
        clearTimeout(timer);
        if (settled) return;
        settled = true;
        if (timedOut) {
          rej(new Error("ASS render timed out"));
        } else if (code === 0) {
          res(videoOutputPath);
        } else {
          rej(new Error(`FFmpeg burn-in ASS subtitles failed (exit ${code}): ${err}`));
        }
      });
      proc.on("error", (error) => {
        clearTimeout(timer);
        if (settled) return;
        settled = true;
        rej(error);
      });
    });
  } finally {
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        await rm(workspace, { recursive: true, force: true });
        break;
      } catch {
        if (attempt === 4) break;
        await new Promise((r) => setTimeout(r, 150));
      }
    }
  }
}
