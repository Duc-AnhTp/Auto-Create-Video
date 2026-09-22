import { writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve, basename } from "node:path";
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
function escapeXml(str: unknown): string {
  if (str === undefined || str === null) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * Convenience wrapper exporting FCP7 XML directly from a UnifiedTimeline.
 */
export function exportFcp7Xml(
  timeline: UnifiedTimeline,
  sequenceName?: string,
  width?: number,
  height?: number
): string {
  return generateFcp7Xml({ timeline, sequenceName, width, height });
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

  // Build Video Track Items (with bucketing for multi-track collision prevention during crossfades)
  const videoBuckets: { cursorFrame: number; clipItems: string[] }[] = [];
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

    const rawMediaDurationFrames =
      shot.fileDurationFrames ??
      (shot.fileDurationSec !== undefined
        ? secToFrame(shot.fileDurationSec, fps)
        : undefined);
    const effectiveMediaDuration = Math.max(
      rawMediaDurationFrames ?? (outFrame + secToFrame(shot.trimEndSec ?? 0, fps)),
      outFrame
    );

    const clipPath = shot.approvedClipPath || `shots/${shot.shotId}.mp4`;
    const absPath = resolve(clipPath);
    const fileUrl = pathToFileURL(absPath).href;

    let bucket = videoBuckets.find((b) => b.cursorFrame <= shotStartFrame);
    if (!bucket) {
      bucket = { cursorFrame: 0, clipItems: [] };
      videoBuckets.push(bucket);
    }

    let markerColor = "Green";
    let markerComment = "Approved Take";
    if ((shot as any).priority === "hero") {
      markerColor = "Cyan";
      markerComment = "Hero Shot - High Priority";
    } else if (shot.shotType === "action") {
      markerColor = "Orange";
      markerComment = "Action Sequence";
    } else if (shot.shotType === "establishing") {
      markerColor = "Purple";
      markerComment = "Establishing Geography";
    } else if (shot.shotType === "close_up" || shot.shotType === "extreme_close_up") {
      markerColor = "Blue";
      markerComment = "Close-up Reaction";
    }

    if ((shot as any).cameraMovement) {
      markerComment += ` | Camera: ${(shot as any).cameraMovement}`;
    }

    bucket.clipItems.push(`        <clipitem id="clipitem-${clipCounter++}">
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
          <marker>
            <name>${escapeXml(shot.shotId)}</name>
            <comment>${escapeXml(markerComment)}</comment>
            <color>${markerColor}</color>
            <in>${inFrame}</in>
            <out>${inFrame + Math.min(fps, shotDurationFrames)}</out>
          </marker>
          <file id="file-${fileCounter++}">
            <name>${escapeXml(shot.shotId)}.mp4</name>
            <pathurl>${fileUrl}</pathurl>
            <rate>
              <timebase>${fps}</timebase>
              <ntsc>FALSE</ntsc>
            </rate>
            <duration>${effectiveMediaDuration}</duration>
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
    bucket.cursorFrame = shotEndFrame;
  }

  // Build Dialogue Track Items
  const dialogueClipItems: string[] = [];
  for (const dia of timeline.dialogueTrack) {
    const startFrame = dia.startFrame ?? secToFrame(dia.startSec, fps);
    const rawDurationFrames = dia.durationFrames ?? secToFrame(dia.durationSec, fps);
    const durationFrames = Math.max(rawDurationFrames, 1);
    const endFrame = startFrame + durationFrames;
    const speaker = dia.speakerName || (dia as { speaker?: string }).speaker || "Speaker";
    const dialogueId = dia.dialogueId || (dia as { id?: string }).id || "dia";
    const audioPath = dia.audioPath || `audio/dialogue_${dialogueId}.mp3`;
    const absPath = resolve(audioPath);
    const fileUrl = pathToFileURL(absPath).href;
    const rawFileDurationFrames =
      dia.fileDurationFrames ??
      (dia.fileDurationSec !== undefined
        ? secToFrame(dia.fileDurationSec, fps)
        : durationFrames);
    const effectiveFileDuration = Math.max(rawFileDurationFrames, durationFrames);
    const diaFileName = basename(audioPath) || `dia_${dialogueId}.mp3`;

    dialogueClipItems.push(`        <clipitem id="clipitem-${clipCounter++}">
          <name>${escapeXml(speaker)}: ${escapeXml(dialogueId)}</name>
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
            <name>${escapeXml(diaFileName)}</name>
            <pathurl>${fileUrl}</pathurl>
            <rate>
              <timebase>${fps}</timebase>
            </rate>
            <duration>${effectiveFileDuration}</duration>
            <media>
              <audio>
                <samplecharacteristics>
                  <depth>16</depth>
                  <samplerate>48000</samplerate>
                </samplecharacteristics>
                <channelcount>2</channelcount>
              </audio>
            </media>
          </file>
        </clipitem>`);
  }

  // Build SFX Track Items
  const sfxClipItems: string[] = [];
  for (const sfx of timeline.sfxTrack) {
    const startFrame = sfx.startFrame ?? secToFrame(sfx.startSec, fps);
    const rawDurationFrames = sfx.durationFrames ?? secToFrame(sfx.durationSec, fps);
    const durationFrames = Math.max(rawDurationFrames, 1);
    const endFrame = startFrame + durationFrames;
    const cueId = sfx.cueId || (sfx as { id?: string }).id || "sfx";
    const sfxName = sfx.name || cueId;
    const audioPath = sfx.audioPath || `audio/sfx_${cueId}.mp3`;
    const absPath = resolve(audioPath);
    const fileUrl = pathToFileURL(absPath).href;
    const rawFileDurationFrames =
      sfx.fileDurationFrames ??
      (sfx.fileDurationSec !== undefined
        ? secToFrame(sfx.fileDurationSec, fps)
        : durationFrames);
    const effectiveFileDuration = Math.max(rawFileDurationFrames, durationFrames);
    const sfxFileName = basename(audioPath) || `sfx_${cueId}.mp3`;

    sfxClipItems.push(`        <clipitem id="clipitem-${clipCounter++}">
          <name>SFX: ${escapeXml(sfxName)}</name>
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
            <name>${escapeXml(sfxFileName)}</name>
            <pathurl>${fileUrl}</pathurl>
            <rate>
              <timebase>${fps}</timebase>
            </rate>
            <duration>${effectiveFileDuration}</duration>
            <media>
              <audio>
                <samplecharacteristics>
                  <depth>16</depth>
                  <samplerate>48000</samplerate>
                </samplecharacteristics>
                <channelcount>2</channelcount>
              </audio>
            </media>
          </file>
        </clipitem>`);
  }

  // Build BGM Track Items
  const bgmClipItems: string[] = [];
  if (timeline.bgmTrack && timeline.bgmTrack.audioPath) {
    const startFrame = timeline.bgmTrack.startFrame ?? 0;
    const rawDurationFrames = timeline.bgmTrack.durationFrames ?? totalFrames;
    const durationFrames = Math.max(rawDurationFrames, 1);
    const endFrame = startFrame + durationFrames;
    const absPath = resolve(timeline.bgmTrack.audioPath);
    const fileUrl = pathToFileURL(absPath).href;
    const rawFileDurationFrames =
      timeline.bgmTrack.fileDurationFrames ??
      (timeline.bgmTrack.fileDurationSec !== undefined
        ? secToFrame(timeline.bgmTrack.fileDurationSec, fps)
        : durationFrames);
    const effectiveFileDuration = Math.max(rawFileDurationFrames, durationFrames);
    const bgmFileName = basename(timeline.bgmTrack.audioPath) || "bgm.mp3";

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
            <name>${escapeXml(bgmFileName)}</name>
            <pathurl>${fileUrl}</pathurl>
            <rate>
              <timebase>${fps}</timebase>
            </rate>
            <duration>${effectiveFileDuration}</duration>
            <media>
              <audio>
                <samplecharacteristics>
                  <depth>16</depth>
                  <samplerate>48000</samplerate>
                </samplecharacteristics>
                <channelcount>2</channelcount>
              </audio>
            </media>
          </file>
        </clipitem>`);
  }

  // Build Ambience Track Items (A4+) - bucket concurrent cues into non-overlapping tracks
  interface Fcp7TrackBucket {
    cursorFrame: number;
    clipItems: string[];
  }
  const ambBuckets: Fcp7TrackBucket[] = [];
  const ambienceList = Array.isArray(timeline.ambienceTrack)
    ? timeline.ambienceTrack
    : timeline.ambienceTrack
    ? [timeline.ambienceTrack]
    : [];
  let ambIdx = 0;
  for (const amb of ambienceList) {
    // Skip entries without an explicit audioPath — fabricating a CWD-relative
    // path would produce broken <pathurl> references in the NLE import.
    if (!amb.audioPath) continue;

    ambIdx++;
    const startFrame = amb.startFrame ?? secToFrame(amb.startSec ?? 0, fps);
    const rawDuration =
      amb.durationFrames ??
      (amb.durationSec !== undefined
        ? secToFrame(amb.durationSec, fps)
        : totalFrames - startFrame);
    // Guard against zero or negative duration (e.g. cue starting at episode end).
    const durationFrames = Math.max(rawDuration, 1);
    const endFrame = startFrame + durationFrames;
    const cueId =
      amb.cueId || (amb as { id?: string }).id || (ambienceList.length > 1 ? `ambience_${ambIdx}` : "ambience");
    const ambName = amb.name || cueId;
    const absPath = resolve(amb.audioPath);
    const fileUrl = pathToFileURL(absPath).href;
    const rawFileDurationFrames =
      amb.fileDurationFrames ??
      (amb.fileDurationSec !== undefined
        ? secToFrame(amb.fileDurationSec, fps)
        : durationFrames);
    const effectiveFileDuration = Math.max(rawFileDurationFrames, durationFrames);
    const fileName = basename(amb.audioPath) || `ambience_${cueId}.mp3`;

    let bucket = ambBuckets.find((b) => b.cursorFrame <= startFrame);
    if (!bucket) {
      bucket = { cursorFrame: 0, clipItems: [] };
      ambBuckets.push(bucket);
    }

    bucket.clipItems.push(`        <clipitem id="clipitem-${clipCounter++}">
          <name>Ambience: ${escapeXml(ambName)}</name>
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
            <name>${escapeXml(fileName)}</name>
            <pathurl>${fileUrl}</pathurl>
            <rate>
              <timebase>${fps}</timebase>
            </rate>
            <duration>${effectiveFileDuration}</duration>
            <media>
              <audio>
                <samplecharacteristics>
                  <depth>16</depth>
                  <samplerate>48000</samplerate>
                </samplecharacteristics>
                <channelcount>2</channelcount>
              </audio>
            </media>
          </file>
        </clipitem>`);
    bucket.cursorFrame = endFrame;
  }

  const ambienceTracksXml =
    ambBuckets.length > 0
      ? ambBuckets
          .map(
            (b, idx) => `        <!-- Ambience Track (A${4 + idx}) -->
        <track>
${b.clipItems.join("\n")}
        </track>`
          )
          .join("\n")
      : `        <!-- Ambience Track (A4) -->
        <track>
        </track>`;

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
        ${videoBuckets.length > 0
          ? videoBuckets
              .map(
                (b, idx) => `<!-- Video Track (V${idx + 1}) -->
        <track>
${b.clipItems.join("\n")}
        </track>`
              )
              .join("\n        ")
          : `<track>\n        </track>`}
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
${ambienceTracksXml}
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

  // Video Track Children (with bucketing for multi-track collision prevention during crossfades)
  const videoBuckets: { cursorFrame: number; children: object[] }[] = [];

  for (const shot of timeline.videoTrack) {
    const shotStartFrame = shot.startFrame ?? secToFrame(shot.startSec, fps);
    const shotDurationFrames = shot.durationFrames ?? secToFrame(shot.durationSec, fps);

    let bucket = videoBuckets.find((b) => b.cursorFrame <= shotStartFrame);
    if (!bucket) {
      bucket = { cursorFrame: 0, children: [] };
      videoBuckets.push(bucket);
    }

    // If there is a gap before shot
    if (shotStartFrame > bucket.cursorFrame) {
      const gapFrames = shotStartFrame - bucket.cursorFrame;
      bucket.children.push({
        OTIO_SCHEMA: "Gap.1",
        name: "Video_Gap",
        source_range: {
          OTIO_SCHEMA: "TimeRange.1",
          start_time: { OTIO_SCHEMA: "RationalTime.1", rate: fps, value: 0 },
          duration: { OTIO_SCHEMA: "RationalTime.1", rate: fps, value: gapFrames },
        },
      });
      bucket.cursorFrame = shotStartFrame;
    }

    const trimInSec = shot.trimStartSec ?? 0;
    const inFrame = secToFrame(trimInSec, fps);
    const clipPath = shot.approvedClipPath || `shots/${shot.shotId}.mp4`;
    const fileUrl = pathToFileURL(resolve(clipPath)).href;

    bucket.children.push({
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

    bucket.cursorFrame = shotStartFrame + shotDurationFrames;
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

    const speaker = dia.speakerName || (dia as { speaker?: string }).speaker || "Speaker";
    const dialogueId = dia.dialogueId || (dia as { id?: string }).id || "dia";
    const audioPath = dia.audioPath || `audio/dialogue_${dialogueId}.mp3`;
    const fileUrl = pathToFileURL(resolve(audioPath)).href;

    dialogueChildren.push({
      OTIO_SCHEMA: "Clip.1",
      name: `${speaker}: ${dialogueId}`,
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
        speaker: speaker,
        characterId: dia.characterId || "",
        rawText: dia.rawText || (dia as { text?: string }).text || "",
        displayText: dia.subtitleText || (dia as { text?: string }).text || "",
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

    const cueId = sfx.cueId || (sfx as { id?: string }).id || "sfx";
    const sfxName = sfx.name || cueId;
    const audioPath = sfx.audioPath || `audio/sfx_${cueId}.mp3`;
    const fileUrl = pathToFileURL(resolve(audioPath)).href;

    sfxChildren.push({
      OTIO_SCHEMA: "Clip.1",
      name: `SFX: ${sfxName}`,
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

  // Ambience Audio Track(s)
  const ambList = Array.isArray(timeline.ambienceTrack)
    ? timeline.ambienceTrack
    : timeline.ambienceTrack
    ? [timeline.ambienceTrack]
    : [];

  const validAmbs = ambList.filter((a) => a.audioPath);
  interface AmbTrackBucket {
    cursorFrame: number;
    children: object[];
  }
  const ambBuckets: AmbTrackBucket[] = [];

  for (const amb of validAmbs) {
    const startFrame = amb.startFrame ?? secToFrame(amb.startSec ?? 0, fps);
    // Fix: an ambience object without durationSec/durationFrames (common for
    // session-wide ambience like { name: "neon_hum", volume: 0.3 }) should
    // span the full episode rather than produce a zero-duration clip.
    const durationFrames = Math.max(
      1,
      amb.durationFrames ??
        (amb.durationSec !== undefined
          ? secToFrame(amb.durationSec, fps)
          : totalFrames - startFrame)
    );

    let bucket = ambBuckets.find((b) => b.cursorFrame <= startFrame);
    if (!bucket) {
      bucket = { cursorFrame: 0, children: [] };
      ambBuckets.push(bucket);
    }

    if (startFrame > bucket.cursorFrame) {
      bucket.children.push({
        OTIO_SCHEMA: "Gap.1",
        name: "Ambience_Gap",
        source_range: {
          OTIO_SCHEMA: "TimeRange.1",
          start_time: { OTIO_SCHEMA: "RationalTime.1", rate: fps, value: 0 },
          duration: { OTIO_SCHEMA: "RationalTime.1", rate: fps, value: startFrame - bucket.cursorFrame },
        },
      });
      bucket.cursorFrame = startFrame;
    }

    const cueId = amb.cueId || (amb as { id?: string }).id || "ambience";
    const ambName = amb.name || cueId;
    const fileUrl = pathToFileURL(resolve(amb.audioPath)).href;

    bucket.children.push({
      OTIO_SCHEMA: "Clip.1",
      name: `Ambience: ${ambName}`,
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

    bucket.cursorFrame = startFrame + durationFrames;
  }

  const ambienceTracks: object[] =
    ambBuckets.length === 0
      ? [
          {
            OTIO_SCHEMA: "Track.1",
            name: "Ambience Track (A4)",
            kind: "Audio",
            children: [],
          },
        ]
      : ambBuckets.map((bucket, idx) => ({
          OTIO_SCHEMA: "Track.1",
          name: ambBuckets.length === 1 ? "Ambience Track (A4)" : `Ambience Track ${idx + 1} (A${4 + idx})`,
          kind: "Audio",
          children: bucket.children,
        }));

  // BGM Audio Track
  const bgmChildren: object[] = [];
  if (timeline.bgmTrack && timeline.bgmTrack.audioPath) {
    const bgm = timeline.bgmTrack;
    const bgmStartFrame = bgm.startFrame ?? secToFrame(bgm.startSec ?? 0, fps);
    const rawBgmDuration =
      bgm.durationFrames ??
      (bgm.durationSec !== undefined
        ? secToFrame(bgm.durationSec, fps)
        : totalFrames - bgmStartFrame);
    const bgmDurationFrames = Math.max(rawBgmDuration, 1);

    if (bgmStartFrame > 0) {
      bgmChildren.push({
        OTIO_SCHEMA: "Gap.1",
        name: "BGM_Gap",
        source_range: {
          OTIO_SCHEMA: "TimeRange.1",
          start_time: { OTIO_SCHEMA: "RationalTime.1", rate: fps, value: 0 },
          duration: { OTIO_SCHEMA: "RationalTime.1", rate: fps, value: bgmStartFrame },
        },
      });
    }

    const fileUrl = pathToFileURL(resolve(bgm.audioPath)).href;
    bgmChildren.push({
      OTIO_SCHEMA: "Clip.1",
      name: "BGM Track",
      source_range: {
        OTIO_SCHEMA: "TimeRange.1",
        start_time: { OTIO_SCHEMA: "RationalTime.1", rate: fps, value: 0 },
        duration: { OTIO_SCHEMA: "RationalTime.1", rate: fps, value: bgmDurationFrames },
      },
      media_reference: {
        OTIO_SCHEMA: "ExternalReference.1",
        target_url: fileUrl,
      },
      metadata: {
        duckingWindows: bgm.duckingWindows,
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
        ...(videoBuckets.length > 0
          ? videoBuckets.map((b, idx) => ({
              OTIO_SCHEMA: "Track.1",
              name: `Video Track (V${idx + 1})`,
              kind: "Video",
              children: b.children,
            }))
          : [
              {
                OTIO_SCHEMA: "Track.1",
                name: "Video Track (V1)",
                kind: "Video",
                children: [],
              },
            ]),
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
          name: "BGM Track (A3)",
          kind: "Audio",
          children: bgmChildren,
        },
        ...ambienceTracks,
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
