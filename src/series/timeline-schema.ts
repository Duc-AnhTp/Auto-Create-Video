import { z } from "zod";
import { ShotTypeSchema } from "./series-schema.js";

// ── Timebase Math Utilities ──────────────────────────────────────────────────

/**
 * Converts a time in seconds to the nearest integer frame.
 */
export function secToFrame(sec: number, fps: number): number {
  return Math.round(sec * fps);
}

/**
 * Converts an integer frame count to time in seconds.
 */
export function frameToSec(frame: number, fps: number): number {
  return frame / fps;
}

/**
 * Acceptable frame tolerance in seconds for a given FPS.
 * At 30 fps, 1 frame is ~0.0333s (33.3ms).
 */
export function getFrameToleranceSec(fps: number): number {
  return 1.0 / fps;
}

/**
 * Audio codec packaging tolerance (e.g., MP3/AAC priming and bit reservoir padding).
 * Typically ±0.05s (50ms).
 */
export const CODEC_PADDING_TOLERANCE_SEC = 0.05;

// ── Dialogue Overflow Policy ────────────────────────────────────────────────

export type DialogueOverflowPolicy = "extend_shot" | "split_shot" | "error";

export class DialogueOverflowError extends Error {
  public shotId: string;
  public dialogueId: string;
  public shotDurationSec: number;
  public dialogueDurationSec: number;
  public overflowSec: number;

  constructor(
    shotId: string,
    dialogueId: string,
    shotDurationSec: number,
    dialogueDurationSec: number
  ) {
    const overflow = dialogueDurationSec - shotDurationSec;
    super(
      `[Lỗi Tràn Thoại Timeline] Cú máy '${shotId}' có thời lượng ${shotDurationSec.toFixed(
        2
      )}s nhưng câu thoại '${dialogueId}' dài ${dialogueDurationSec.toFixed(
        2
      )}s (vượt quá ${overflow.toFixed(2)}s).\n` +
        `  Chính sách: 'error'. Để giải quyết, hãy tăng thời lượng cú máy trong kịch bản hoặc sử dụng policy 'extend_shot'.`
    );
    this.name = "DialogueOverflowError";
    this.shotId = shotId;
    this.dialogueId = dialogueId;
    this.shotDurationSec = shotDurationSec;
    this.dialogueDurationSec = dialogueDurationSec;
    this.overflowSec = overflow;
  }
}

// ── Timeline Cues Schemas ────────────────────────────────────────────────────

export const TimelineVideoShotSchema = z.object({
  shotId: z.string().min(1),
  sceneId: z.string().min(1),
  startFrame: z.number().int().min(0),
  endFrame: z.number().int().min(0),
  durationFrames: z.number().int().positive(),
  startSec: z.number().min(0),
  endSec: z.number().min(0),
  durationSec: z.number().positive(),
  shotType: ShotTypeSchema.default("medium"),
  visualPrompt: z.string().min(1),
  referenceImage: z.string().optional(),
  characterId: z.string().optional(),
  approvedClipPath: z.string().optional(),
  transitionIn: z
    .object({
      type: z.enum(["cut", "crossfade"]).default("cut"),
      durationSec: z.number().min(0).default(0),
      durationFrames: z.number().int().min(0).default(0),
    })
    .optional(),
  transitionOut: z
    .object({
      type: z.enum(["cut", "crossfade"]).default("cut"),
      durationSec: z.number().min(0).default(0),
      durationFrames: z.number().int().min(0).default(0),
    })
    .optional(),
  trimStartSec: z.number().min(0).default(0),
  trimEndSec: z.number().min(0).optional(),
});

export type TimelineVideoShot = z.infer<typeof TimelineVideoShotSchema>;

export const TimelineDialogueCueSchema = z.object({
  dialogueId: z.string().min(1),
  shotId: z.string().min(1),
  characterId: z.string().min(1),
  speakerName: z.string().min(1),
  rawText: z.string(),
  subtitleText: z.string(), // Clean display text
  ttsText: z.string(), // Normalized speech text
  actingInstruction: z.string().optional(),
  type: z.enum(["speech", "voiceover"]).default("speech"),
  isOffScreen: z.boolean().default(false),
  startFrame: z.number().int().min(0),
  endFrame: z.number().int().min(0),
  durationFrames: z.number().int().min(0),
  startSec: z.number().min(0),
  endSec: z.number().min(0),
  durationSec: z.number().min(0),
  audioPath: z.string().default(""),
  voiceProfileId: z.string().optional(),
  volume: z.number().min(0).max(2).default(1.0),
});

export type TimelineDialogueCue = z.infer<typeof TimelineDialogueCueSchema>;

export const TimelineSfxCueSchema = z.object({
  cueId: z.string().min(1),
  shotId: z.string().optional(),
  name: z.string().min(1),
  startFrame: z.number().int().min(0),
  durationFrames: z.number().int().min(0),
  startSec: z.number().min(0),
  durationSec: z.number().min(0),
  audioPath: z.string().default(""),
  volume: z.number().min(0).max(1).default(0.7),
});

export type TimelineSfxCue = z.infer<typeof TimelineSfxCueSchema>;

export const TimelineAmbienceCueSchema = z.object({
  cueId: z.string().min(1),
  sceneId: z.string().optional(),
  name: z.string().min(1),
  startFrame: z.number().int().min(0),
  durationFrames: z.number().int().min(0),
  startSec: z.number().min(0),
  durationSec: z.number().min(0),
  audioPath: z.string().default(""),
  volume: z.number().min(0).max(1).default(0.3),
  fadeInSec: z.number().min(0).default(0.5),
  fadeOutSec: z.number().min(0).default(0.5),
});

export type TimelineAmbienceCue = z.infer<typeof TimelineAmbienceCueSchema>;

export const TimelineBgmCueSchema = z.object({
  audioPath: z.string().min(1),
  startFrame: z.number().int().min(0).default(0),
  durationFrames: z.number().int().min(0),
  startSec: z.number().min(0).default(0),
  durationSec: z.number().min(0),
  baseVolume: z.number().min(0).max(1).default(0.2),
  duckedVolume: z.number().min(0).max(1).default(0.05),
  duckingWindows: z.array(
    z.object({
      startSec: z.number().min(0),
      endSec: z.number().min(0),
      startFrame: z.number().int().min(0),
      endFrame: z.number().int().min(0),
    })
  ),
});

export type TimelineBgmCue = z.infer<typeof TimelineBgmCueSchema>;

export const TimelineSubtitleCueSchema = z.object({
  subtitleId: z.string().min(1),
  shotId: z.string().min(1),
  dialogueId: z.string().min(1),
  speakerName: z.string().min(1),
  displayText: z.string().min(1), // Clean display text
  actingInstruction: z.string().optional(),
  startFrame: z.number().int().min(0),
  endFrame: z.number().int().min(0),
  startSec: z.number().min(0),
  endSec: z.number().min(0),
  durationSec: z.number().min(0),
});

export type TimelineSubtitleCue = z.infer<typeof TimelineSubtitleCueSchema>;

// ── Unified Master Timeline Schema ──────────────────────────────────────────

export const UnifiedTimelineSchema = z.object({
  seriesId: z.string().default("series_main"),
  episodeNumber: z.number().int().positive().default(1),
  fps: z.number().positive().default(30),
  sampleRate: z.number().int().positive().default(48000),
  targetTotalFrames: z.number().int().min(0),
  targetTotalDurationSec: z.number().min(0),
  videoTrack: z.array(TimelineVideoShotSchema),
  dialogueTrack: z.array(TimelineDialogueCueSchema),
  sfxTrack: z.array(TimelineSfxCueSchema),
  ambienceTrack: z.array(TimelineAmbienceCueSchema),
  bgmTrack: TimelineBgmCueSchema.optional(),
  subtitleTrack: z.array(TimelineSubtitleCueSchema),
  stems: z
    .object({
      dialogue: z.string().optional(),
      sfx: z.string().optional(),
      ambience: z.string().optional(),
      bgm: z.string().optional(),
      master: z.string().optional(),
    })
    .default({}),
  metrics: z
    .object({
      videoDurationSec: z.number().default(0),
      audioDurationSec: z.number().default(0),
      driftSec: z.number().default(0),
      driftFrames: z.number().default(0),
      isWithinTolerance: z.boolean().default(true),
      toleranceSec: z.number().default(0.05),
    })
    .default({}),
});

export type UnifiedTimeline = z.infer<typeof UnifiedTimelineSchema>;

// ── Subtitle Formatter Utilities (SRT / VTT) ────────────────────────────────

function formatSrtTimestamp(sec: number): string {
  const hours = Math.floor(sec / 3600);
  const minutes = Math.floor((sec % 3600) / 60);
  const seconds = Math.floor(sec % 60);
  const millis = Math.round((sec % 1) * 1000);
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(
    2,
    "0"
  )}:${String(seconds).padStart(2, "0")},${String(millis).padStart(3, "0")}`;
}

function formatVttTimestamp(sec: number): string {
  const hours = Math.floor(sec / 3600);
  const minutes = Math.floor((sec % 3600) / 60);
  const seconds = Math.floor(sec % 60);
  const millis = Math.round((sec % 1) * 1000);
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(
    2,
    "0"
  )}:${String(seconds).padStart(2, "0")}.${String(millis).padStart(3, "0")}`;
}

/**
 * Converts timeline subtitle cues into standard SubRip (.srt) text format.
 * Strictly uses displayText (subtitleText), never the phonetically altered ttsText.
 */
export function exportToSrt(subtitles: TimelineSubtitleCue[]): string {
  return subtitles
    .map((sub, idx) => {
      const index = idx + 1;
      const start = formatSrtTimestamp(sub.startSec);
      const end = formatSrtTimestamp(sub.endSec);
      const speakerPrefix =
        sub.speakerName && sub.speakerName !== "Người dẫn chuyện"
          ? `${sub.speakerName}: `
          : "";
      return `${index}\n${start} --> ${end}\n${speakerPrefix}${sub.displayText}\n`;
    })
    .join("\n");
}

/**
 * Converts timeline subtitle cues into standard WebVTT (.vtt) text format.
 */
export function exportToVtt(subtitles: TimelineSubtitleCue[]): string {
  const header = "WEBVTT - Episodic Film Series\n\n";
  const body = subtitles
    .map((sub, idx) => {
      const start = formatVttTimestamp(sub.startSec);
      const end = formatVttTimestamp(sub.endSec);
      const speakerPrefix =
        sub.speakerName && sub.speakerName !== "Người dẫn chuyện"
          ? `<v ${sub.speakerName}>`
          : "";
      const text = speakerPrefix ? `${speakerPrefix}${sub.displayText}` : sub.displayText;
      return `${idx + 1}\n${start} --> ${end}\n${text}\n`;
    })
    .join("\n");
  return header + body;
}
