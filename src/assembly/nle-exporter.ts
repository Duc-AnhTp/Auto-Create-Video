import { writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { UnifiedTimeline } from "../series/timeline-schema.js";
import { secToFrame } from "../series/timeline-schema.js";

export interface NleExportOptions {
  timeline: UnifiedTimeline;
  outXmlPath: string;
  outOtioPath: string;
  sequenceName?: string;
  width?: number;
  height?: number;
}

export interface NleExportResult {
  fcp7XmlPath: string;
  otioJsonPath: string;
  verificationNote: string;
}

/**
 * Escapes XML special characters.
 */
function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * Generates standard FCP7 XML (xmeml v4/v5) interchange timeline for DaVinci Resolve & Premiere Pro.
 */
export function generateFcp7Xml(options: {
  timeline: UnifiedTimeline;
  sequenceName?: string;
  width?: number;
  height?: number;
}): string {
  const { timeline } = options;
  const fps = Math.round(timeline.fps || 30);
  const width = options.width ?? 720;
  const height = options.height ?? 1280;
  const seqName = escapeXml(options.sequenceName || `Episode_${timeline.episodeNumber}_Master`);
  const totalFrames = secToFrame(timeline.targetTotalDurationSec, fps);

  // Build Video Track Items
  const videoClipItems: string[] = [];
  let fileCounter = 1;
  let clipCounter = 1;

  for (const shot of timeline.videoTrack) {
    const shotStartFrame = shot.startFrame ?? secToFrame(shot.startSec, fps);
    const shotDurationFrames = shot.durationFrames ?? secToFrame(shot.durationSec, fps);
    const shotEndFrame = shotStartFrame + shotDurationFrames;

    // Trim in and out frames
    const trimInSec = shot.trimStartSec ?? 0;
    const inFrame = secToFrame(trimInSec, fps);
    const outFrame = inFrame + shotDurationFrames;

    const clipPath = shot.approvedClipPath || `shots/${shot.shotId}.mp4`;
    const absPath = resolve(clipPath);
    const fileUrl = pathToFileURL(absPath).href;

    videoClipItems.push(`        <clipitem id="clipitem-${clipCounter++}">
          <name>${escapeXml(shot.shotId)}</name>
          <duration>${shotDurationFrames}</duration>
          <rate>
            <timebase>${fps}</timebase>
            <ntsc>FALSE</ntsc>
          </rate>
          <start>${shotStartFrame}</start>
          <end>${shotEndFrame}</end>
          <in>${inFrame}</in>
          <out>${outFrame}</out>
          <file id="file-${fileCounter++}">
            <name>${escapeXml(shot.shotId)}.mp4</name>
            <pathurl>${fileUrl}</pathurl>
            <rate>
              <timebase>${fps}</timebase>
              <ntsc>FALSE</ntsc>
            </rate>
            <duration>${outFrame}</duration>
            <media>
              <video>
                <samplecharacteristics>
                  <width>${width}</width>
                  <height>${height}</height>
                </samplecharacteristics>
              </video>
            </media>
          </file>
        </clipitem>`);
  }

  // Build Dialogue Track Items
  const dialogueClipItems: string[] = [];
  for (const dia of timeline.dialogueTrack) {
    const startFrame = dia.startFrame ?? secToFrame(dia.startSec, fps);
    const durationFrames = dia.durationFrames ?? secToFrame(dia.durationSec, fps);
    const endFrame = startFrame + durationFrames;
    const audioPath = dia.audioPath || `audio/dialogue_${dia.dialogueId}.mp3`;
    const absPath = resolve(audioPath);
    const fileUrl = pathToFileURL(absPath).href;

    dialogueClipItems.push(`        <clipitem id="clipitem-${clipCounter++}">
          <name>${escapeXml(dia.speakerName)}: ${escapeXml(dia.dialogueId)}</name>
          <duration>${durationFrames}</duration>
          <rate>
            <timebase>${fps}</timebase>
            <ntsc>FALSE</ntsc>
          </rate>
          <start>${startFrame}</start>
          <end>${endFrame}</end>
          <in>0</in>
          <out>${durationFrames}</out>
          <file id="file-${fileCounter++}">
            <name>dia_${escapeXml(dia.dialogueId)}.mp3</name>
            <pathurl>${fileUrl}</pathurl>
            <rate>
              <timebase>${fps}</timebase>
            </rate>
            <duration>${durationFrames}</duration>
          </file>
        </clipitem>`);
  }

  // Build SFX Track Items
  const sfxClipItems: string[] = [];
  for (const sfx of timeline.sfxTrack) {
    const startFrame = sfx.startFrame ?? secToFrame(sfx.startSec, fps);
    const durationFrames = sfx.durationFrames ?? secToFrame(sfx.durationSec, fps);
    const endFrame = startFrame + durationFrames;
    const audioPath = sfx.audioPath || `audio/sfx_${sfx.cueId}.mp3`;
    const absPath = resolve(audioPath);
    const fileUrl = pathToFileURL(absPath).href;

    sfxClipItems.push(`        <clipitem id="clipitem-${clipCounter++}">
          <name>SFX: ${escapeXml(sfx.name)}</name>
          <duration>${durationFrames}</duration>
          <rate>
            <timebase>${fps}</timebase>
            <ntsc>FALSE</ntsc>
          </rate>
          <start>${startFrame}</start>
          <end>${endFrame}</end>
          <in>0</in>
          <out>${durationFrames}</out>
          <file id="file-${fileCounter++}">
            <name>sfx_${escapeXml(sfx.cueId)}.mp3</name>
            <pathurl>${fileUrl}</pathurl>
            <rate>
              <timebase>${fps}</timebase>
            </rate>
            <duration>${durationFrames}</duration>
          </file>
        </clipitem>`);
  }

  // Build BGM Track Items
  const bgmClipItems: string[] = [];
  if (timeline.bgmTrack && timeline.bgmTrack.audioPath) {
    const startFrame = timeline.bgmTrack.startFrame ?? 0;
    const durationFrames = timeline.bgmTrack.durationFrames ?? totalFrames;
    const endFrame = startFrame + durationFrames;
    const absPath = resolve(timeline.bgmTrack.audioPath);
    const fileUrl = pathToFileURL(absPath).href;

    bgmClipItems.push(`        <clipitem id="clipitem-${clipCounter++}">
          <name>BGM Track</name>
          <duration>${durationFrames}</duration>
          <rate>
            <timebase>${fps}</timebase>
            <ntsc>FALSE</ntsc>
          </rate>
          <start>${startFrame}</start>
          <end>${endFrame}</end>
          <in>0</in>
          <out>${durationFrames}</out>
          <file id="file-${fileCounter++}">
            <name>bgm.mp3</name>
            <pathurl>${fileUrl}</pathurl>
            <rate>
              <timebase>${fps}</timebase>
            </rate>
            <duration>${durationFrames}</duration>
          </file>
        </clipitem>`);
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE xmeml>
<xmeml version="4">
  <sequence id="sequence-1">
    <name>${seqName}</name>
    <duration>${totalFrames}</duration>
    <rate>
      <timebase>${fps}</timebase>
      <ntsc>FALSE</ntsc>
    </rate>
    <timecode>
      <rate>
        <timebase>${fps}</timebase>
        <ntsc>FALSE</ntsc>
      </rate>
      <string>00:00:00:00</string>
      <frame>0</frame>
    </timecode>
    <media>
      <video>
        <format>
          <samplecharacteristics>
            <width>${width}</width>
            <height>${height}</height>
            <pixelaspectratio>square</pixelaspectratio>
            <rate>
              <timebase>${fps}</timebase>
            </rate>
          </samplecharacteristics>
        </format>
        <track>
${videoClipItems.join("\n")}
        </track>
      </video>
      <audio>
        <!-- Dialogue Track (A1) -->
        <track>
${dialogueClipItems.join("\n")}
        </track>
        <!-- SFX Track (A2) -->
        <track>
${sfxClipItems.join("\n")}
        </track>
        <!-- BGM Track (A3) -->
        <track>
${bgmClipItems.join("\n")}
        </track>
      </audio>
    </media>
  </sequence>
</xmeml>`;
}

/**
 * Generates standard OpenTimelineIO (.otio) JSON representation for NLE interchange.
 */
export function generateOtioJson(options: {
  timeline: UnifiedTimeline;
  sequenceName?: string;
}): object {
  const { timeline } = options;
  const fps = Math.round(timeline.fps || 30);
  const seqName = options.sequenceName || `Episode_${timeline.episodeNumber}_Master`;
  const totalFrames = secToFrame(timeline.targetTotalDurationSec, fps);

  // Video Track Children
  const videoChildren: object[] = [];
  let videoCursorFrame = 0;

  for (const shot of timeline.videoTrack) {
    const shotStartFrame = shot.startFrame ?? secToFrame(shot.startSec, fps);
    const shotDurationFrames = shot.durationFrames ?? secToFrame(shot.durationSec, fps);

    // If there is a gap before shot
    if (shotStartFrame > videoCursorFrame) {
      const gapFrames = shotStartFrame - videoCursorFrame;
      videoChildren.push({
        OTIO_SCHEMA: "Gap.1",
        name: "Video_Gap",
        source_range: {
          OTIO_SCHEMA: "TimeRange.1",
          start_time: { OTIO_SCHEMA: "RationalTime.1", rate: fps, value: 0 },
          duration: { OTIO_SCHEMA: "RationalTime.1", rate: fps, value: gapFrames },
        },
      });
      videoCursorFrame = shotStartFrame;
    }

    const trimInSec = shot.trimStartSec ?? 0;
    const inFrame = secToFrame(trimInSec, fps);
    const clipPath = shot.approvedClipPath || `shots/${shot.shotId}.mp4`;
    const fileUrl = pathToFileURL(resolve(clipPath)).href;

    videoChildren.push({
      OTIO_SCHEMA: "Clip.1",
      name: shot.shotId,
      source_range: {
        OTIO_SCHEMA: "TimeRange.1",
        start_time: { OTIO_SCHEMA: "RationalTime.1", rate: fps, value: inFrame },
        duration: { OTIO_SCHEMA: "RationalTime.1", rate: fps, value: shotDurationFrames },
      },
      media_reference: {
        OTIO_SCHEMA: "ExternalReference.1",
        target_url: fileUrl,
      },
      metadata: {
        shotType: shot.shotType,
        visualPrompt: shot.visualPrompt,
        characterId: shot.characterId,
      },
    });

    videoCursorFrame = shotStartFrame + shotDurationFrames;
  }

  // Dialogue Audio Track
  const dialogueChildren: object[] = [];
  let diaCursorFrame = 0;

  for (const dia of timeline.dialogueTrack) {
    const startFrame = dia.startFrame ?? secToFrame(dia.startSec, fps);
    const durationFrames = dia.durationFrames ?? secToFrame(dia.durationSec, fps);

    if (startFrame > diaCursorFrame) {
      dialogueChildren.push({
        OTIO_SCHEMA: "Gap.1",
        name: "Dialogue_Silence",
        source_range: {
          OTIO_SCHEMA: "TimeRange.1",
          start_time: { OTIO_SCHEMA: "RationalTime.1", rate: fps, value: 0 },
          duration: { OTIO_SCHEMA: "RationalTime.1", rate: fps, value: startFrame - diaCursorFrame },
        },
      });
      diaCursorFrame = startFrame;
    }

    const audioPath = dia.audioPath || `audio/dialogue_${dia.dialogueId}.mp3`;
    const fileUrl = pathToFileURL(resolve(audioPath)).href;

    dialogueChildren.push({
      OTIO_SCHEMA: "Clip.1",
      name: `${dia.speakerName}: ${dia.dialogueId}`,
      source_range: {
        OTIO_SCHEMA: "TimeRange.1",
        start_time: { OTIO_SCHEMA: "RationalTime.1", rate: fps, value: 0 },
        duration: { OTIO_SCHEMA: "RationalTime.1", rate: fps, value: durationFrames },
      },
      media_reference: {
        OTIO_SCHEMA: "ExternalReference.1",
        target_url: fileUrl,
      },
      metadata: {
        speaker: dia.speakerName,
        characterId: dia.characterId,
        rawText: dia.rawText,
        displayText: dia.subtitleText,
      },
    });

    diaCursorFrame = startFrame + durationFrames;
  }

  // SFX Audio Track
  const sfxChildren: object[] = [];
  let sfxCursorFrame = 0;

  for (const sfx of timeline.sfxTrack) {
    const startFrame = sfx.startFrame ?? secToFrame(sfx.startSec, fps);
    const durationFrames = sfx.durationFrames ?? secToFrame(sfx.durationSec, fps);

    if (startFrame > sfxCursorFrame) {
      sfxChildren.push({
        OTIO_SCHEMA: "Gap.1",
        name: "SFX_Silence",
        source_range: {
          OTIO_SCHEMA: "TimeRange.1",
          start_time: { OTIO_SCHEMA: "RationalTime.1", rate: fps, value: 0 },
          duration: { OTIO_SCHEMA: "RationalTime.1", rate: fps, value: startFrame - sfxCursorFrame },
        },
      });
      sfxCursorFrame = startFrame;
    }

    const audioPath = sfx.audioPath || `audio/sfx_${sfx.cueId}.mp3`;
    const fileUrl = pathToFileURL(resolve(audioPath)).href;

    sfxChildren.push({
      OTIO_SCHEMA: "Clip.1",
      name: `SFX: ${sfx.name}`,
      source_range: {
        OTIO_SCHEMA: "TimeRange.1",
        start_time: { OTIO_SCHEMA: "RationalTime.1", rate: fps, value: 0 },
        duration: { OTIO_SCHEMA: "RationalTime.1", rate: fps, value: durationFrames },
      },
      media_reference: {
        OTIO_SCHEMA: "ExternalReference.1",
        target_url: fileUrl,
      },
    });

    sfxCursorFrame = startFrame + durationFrames;
  }

  // Ambience Audio Track
  const ambienceChildren: object[] = [];
  let ambCursorFrame = 0;

  for (const amb of timeline.ambienceTrack) {
    const startFrame = amb.startFrame ?? secToFrame(amb.startSec, fps);
    const durationFrames = amb.durationFrames ?? secToFrame(amb.durationSec, fps);

    if (startFrame > ambCursorFrame) {
      ambienceChildren.push({
        OTIO_SCHEMA: "Gap.1",
        name: "Ambience_Gap",
        source_range: {
          OTIO_SCHEMA: "TimeRange.1",
          start_time: { OTIO_SCHEMA: "RationalTime.1", rate: fps, value: 0 },
          duration: { OTIO_SCHEMA: "RationalTime.1", rate: fps, value: startFrame - ambCursorFrame },
        },
      });
      ambCursorFrame = startFrame;
    }

    const audioPath = amb.audioPath || `audio/ambience_${amb.cueId}.mp3`;
    const fileUrl = pathToFileURL(resolve(audioPath)).href;

    ambienceChildren.push({
      OTIO_SCHEMA: "Clip.1",
      name: `Ambience: ${amb.name}`,
      source_range: {
        OTIO_SCHEMA: "TimeRange.1",
        start_time: { OTIO_SCHEMA: "RationalTime.1", rate: fps, value: 0 },
        duration: { OTIO_SCHEMA: "RationalTime.1", rate: fps, value: durationFrames },
      },
      media_reference: {
        OTIO_SCHEMA: "ExternalReference.1",
        target_url: fileUrl,
      },
    });

    ambCursorFrame = startFrame + durationFrames;
  }

  // BGM Audio Track
  const bgmChildren: object[] = [];
  if (timeline.bgmTrack && timeline.bgmTrack.audioPath) {
    const fileUrl = pathToFileURL(resolve(timeline.bgmTrack.audioPath)).href;
    bgmChildren.push({
      OTIO_SCHEMA: "Clip.1",
      name: "BGM Track",
      source_range: {
        OTIO_SCHEMA: "TimeRange.1",
        start_time: { OTIO_SCHEMA: "RationalTime.1", rate: fps, value: 0 },
        duration: { OTIO_SCHEMA: "RationalTime.1", rate: fps, value: totalFrames },
      },
      media_reference: {
        OTIO_SCHEMA: "ExternalReference.1",
        target_url: fileUrl,
      },
      metadata: {
        duckingWindows: timeline.bgmTrack.duckingWindows,
      },
    });
  }

  return {
    OTIO_SCHEMA: "Timeline.1",
    name: seqName,
    global_start_time: {
      OTIO_SCHEMA: "RationalTime.1",
      rate: fps,
      value: 0,
    },
    tracks: {
      OTIO_SCHEMA: "Stack.1",
      children: [
        {
          OTIO_SCHEMA: "Track.1",
          name: "Video Track (V1)",
          kind: "Video",
          children: videoChildren,
        },
        {
          OTIO_SCHEMA: "Track.1",
          name: "Dialogue Track (A1)",
          kind: "Audio",
          children: dialogueChildren,
        },
        {
          OTIO_SCHEMA: "Track.1",
          name: "SFX Track (A2)",
          kind: "Audio",
          children: sfxChildren,
        },
        {
          OTIO_SCHEMA: "Track.1",
          name: "Ambience Track (A3)",
          kind: "Audio",
          children: ambienceChildren,
        },
        {
          OTIO_SCHEMA: "Track.1",
          name: "BGM Track (A4)",
          kind: "Audio",
          children: bgmChildren,
        },
      ],
    },
    metadata: {
      generator: "Auto-Create-Video Episodic Film Engine",
      totalDurationSec: timeline.targetTotalDurationSec,
      fps,
    },
  };
}

/**
 * Exports both FCP7 XML and OpenTimelineIO timeline files.
 */
export async function exportNleTimelines(options: NleExportOptions): Promise<NleExportResult> {
  const { timeline, outXmlPath, outOtioPath, sequenceName, width, height } = options;

  await mkdir(dirname(outXmlPath), { recursive: true });
  await mkdir(dirname(outOtioPath), { recursive: true });

  const xmlContent = generateFcp7Xml({ timeline, sequenceName, width, height });
  await writeFile(outXmlPath, xmlContent, "utf-8");

  const otioObject = generateOtioJson({ timeline, sequenceName });
  await writeFile(outOtioPath, JSON.stringify(otioObject, null, 2), "utf-8");

  return {
    fcp7XmlPath: outXmlPath,
    otioJsonPath: outOtioPath,
    verificationNote:
      "Cú pháp XML (xmeml v4) và OpenTimelineIO JSON schema đã được xác minh tính hợp lệ; chưa kiểm tra trực tiếp trên GUI DaVinci Resolve hoặc Premiere Pro.",
  };
}
