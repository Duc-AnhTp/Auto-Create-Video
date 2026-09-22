import { basename } from "node:path";
import type { UnifiedTimeline, TimelineVideoShot } from "../series/timeline-schema.js";
import type { BibleManager } from "../bible/bible-manager.js";
import { log } from "../utils/logger.js";

export interface IngestedClipItem {
  id: string;
  name: string;
  startFrame: number;
  endFrame: number;
  inFrame: number;
  outFrame: number;
  durationFrames: number;
  filePath?: string;
  shotId?: string;
  takeNumber?: number;
  isAudio?: boolean;
}

export interface IngestedNleTimeline {
  sequenceName: string;
  fps: number;
  videoClips: IngestedClipItem[];
  audioClips: IngestedClipItem[];
  totalFrames: number;
  totalDurationSec: number;
}

export interface ShotTrimDiff {
  shotId: string;
  originalDurationSec: number;
  editedDurationSec: number;
  deltaSec: number;
}

export interface ShotTakeSwapDiff {
  shotId: string;
  originalTakeNumber?: number;
  newTakeNumber: number;
  newClipPath: string;
  durationSec?: number;
}

export interface NleDiffReport {
  hasModifications: boolean;
  sequenceName: string;
  originalTotalDurationSec: number;
  editedTotalDurationSec: number;
  totalDurationDeltaSec: number;
  trimmedShots: ShotTrimDiff[];
  swappedTakes: ShotTakeSwapDiff[];
  removedShots: string[];
  reorderedShots: Array<{ shotId: string; originalIndex: number; newIndex: number }>;
}

/**
 * Extracts tag text content using regex (lightweight XML parsing without external dependencies).
 */
function extractTagContent(xml: string, tag: string): string | null {
  const match = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i").exec(xml);
  return match ? match[1].trim() : null;
}

/**
 * Parses shotId and takeNumber from video filename or clipitem name.
 * Examples:
 * - "sc01_sh01_take02.mp4" -> shotId: "sc01_sh01", takeNumber: 2
 * - "shot_03_take1" -> shotId: "shot_03", takeNumber: 1
 * - "cyber-saigon_ep01_sc01_sh02" -> shotId: "sc01_sh02"
 */
export function extractShotMetadataFromFilename(name: string): { shotId?: string; takeNumber?: number } {
  const base = basename(name).replace(/\.[^/.]+$/, ""); // strip extension
  let shotId: string | undefined = undefined;
  let takeNumber: number | undefined = undefined;

  const takeMatch = /take_?(\d+)/i.exec(base);
  if (takeMatch) {
    takeNumber = parseInt(takeMatch[1], 10);
  }

  // Strip take suffix first to preserve full shotId including any descriptor suffix (e.g. sc01_sh01_est)
  const withoutTake = base.replace(/_take_?\d+.*$/i, "");

  // Common shot patterns: sc01_sh02_xxx, shot_01_xxx, sh01_xxx
  const shotMatch = /(sc\d+_sh\d+(?:_[a-z0-9_]+)?|shot_?\d+(?:_[a-z0-9_]+)?|sh\d+(?:_[a-z0-9_]+)?)/i.exec(withoutTake);
  if (shotMatch) {
    shotId = shotMatch[1].toLowerCase();
  } else {
    // Fallback: clean base
    shotId = withoutTake.toLowerCase();
  }

  return { shotId, takeNumber };
}

/**
 * Parses standard FCP7 XML (xmeml) timeline exported from DaVinci Resolve or Premiere Pro.
 */
export function parseFcp7Xml(xmlContent: string): IngestedNleTimeline {
  const seqName = extractTagContent(xmlContent, "name") || "Imported_Sequence";
  const timebaseStr = extractTagContent(xmlContent, "timebase");
  const fps = timebaseStr ? parseInt(timebaseStr, 10) : 30;

  const videoClips: IngestedClipItem[] = [];
  const audioClips: IngestedClipItem[] = [];

  const parseClipItem = (id: string, body: string, isAudio: boolean): IngestedClipItem => {
    const name = extractTagContent(body, "name") || id;
    const startFrame = parseInt(extractTagContent(body, "start") || "0", 10);
    const endFrame = parseInt(extractTagContent(body, "end") || "0", 10);
    const inFrame = parseInt(extractTagContent(body, "in") || "0", 10);
    const outFrame = parseInt(extractTagContent(body, "out") || "0", 10);
    const durationFrames = Math.max(0, endFrame - startFrame);

    const pathurl = extractTagContent(body, "pathurl");
    let filePath: string | undefined = undefined;
    if (pathurl) {
      try {
        filePath = decodeURIComponent(new URL(pathurl).pathname);
        if (process.platform === "win32" && filePath.startsWith("/")) {
          filePath = filePath.slice(1);
        }
      } catch {
        filePath = pathurl;
      }
    }

    let meta = extractShotMetadataFromFilename(name);
    if (filePath) {
      const fileMeta = extractShotMetadataFromFilename(filePath);
      if (meta.takeNumber === undefined && fileMeta.takeNumber !== undefined) {
        meta.takeNumber = fileMeta.takeNumber;
      }
      if (!meta.shotId && fileMeta.shotId) {
        meta.shotId = fileMeta.shotId;
      }
    }
    const shotId = meta.shotId;
    const takeNumber = meta.takeNumber;

    return {
      id,
      name,
      startFrame,
      endFrame,
      inFrame,
      outFrame,
      durationFrames,
      filePath,
      shotId,
      takeNumber,
      isAudio,
    };
  };

  const clipitemRegex = /<clipitem[^>]*id="([^"]*)"[^>]*>([\s\S]*?)<\/clipitem>/gi;
  const videoMatch = /<video>([\s\S]*?)<\/video>/i.exec(xmlContent);
  const audioMatch = /<audio>([\s\S]*?)<\/audio>/i.exec(xmlContent);

  if (videoMatch || audioMatch) {
    if (videoMatch) {
      let m: RegExpExecArray | null;
      const vRegex = new RegExp(clipitemRegex.source, "gi");
      while ((m = vRegex.exec(videoMatch[1])) !== null) {
        videoClips.push(parseClipItem(m[1], m[2], false));
      }
    }
    if (audioMatch) {
      let m: RegExpExecArray | null;
      const aRegex = new RegExp(clipitemRegex.source, "gi");
      while ((m = aRegex.exec(audioMatch[1])) !== null) {
        audioClips.push(parseClipItem(m[1], m[2], true));
      }
    }
  } else {
    // Fallback if no explicit <video> or <audio> parent tags exist
    let match: RegExpExecArray | null;
    while ((match = clipitemRegex.exec(xmlContent)) !== null) {
      const id = match[1];
      const body = match[2];
      const name = extractTagContent(body, "name") || id;
      const isAudio =
        body.includes("<mediatype>audio</mediatype>") ||
        (!body.includes("<samplecharacteristics>") && /audio|dialogue|sfx|bgm|ambience/i.test(name));
      const clip = parseClipItem(id, body, isAudio);
      if (isAudio) {
        audioClips.push(clip);
      } else {
        videoClips.push(clip);
      }
    }
  }

  // Sort video clips chronologically by start frame
  videoClips.sort((a, b) => a.startFrame - b.startFrame);
  const totalFrames = videoClips.length > 0 ? Math.max(...videoClips.map((c) => c.endFrame)) : 0;
  const totalDurationSec = totalFrames / fps;

  return {
    sequenceName: seqName,
    fps,
    videoClips,
    audioClips,
    totalFrames,
    totalDurationSec,
  };
}

/**
 * Parses OpenTimelineIO (.otio) JSON timeline exported from Premiere Pro, DaVinci Resolve, or external tools.
 */
export function parseOtioJson(otioContent: string): IngestedNleTimeline {
  const data = typeof otioContent === "string" ? JSON.parse(otioContent) : otioContent;
  const seqName = data.name || "Imported_OTIO_Sequence";
  let fps = 30;
  if (data.global_start_time?.rate && data.global_start_time.rate < 1000) {
    fps = Math.round(data.global_start_time.rate);
  }

  const videoClips: IngestedClipItem[] = [];
  const audioClips: IngestedClipItem[] = [];

  const tracks: any[] = data.tracks?.children || data.children || [];
  for (const track of tracks) {
    const isVideo = track.kind === "Video" || /video/i.test(track.name || "");
    const isAudio = !isVideo && (track.kind === "Audio" || /audio|dialogue|sfx|bgm|ambience/i.test(track.name || ""));
    const children: any[] = track.children || [];

    let cursorFrame = 0;
    for (const child of children) {
      const schema: string = child.OTIO_SCHEMA || "";
      const rawDurVal = child.source_range?.duration?.value ?? 0;
      const rate = child.source_range?.duration?.rate;

      // Only video clips should update sequence video fps; audio sampling rates (e.g. 44100 / 48000 Hz) must not overwrite fps
      if (isVideo && rate && rate < 1000) {
        fps = Math.round(rate);
      }

      // Convert audio sample counts to sequence frames if rate is an audio sample rate
      let durVal = rawDurVal;
      if (rate && rate >= 1000) {
        durVal = Math.round((rawDurVal / rate) * fps);
      }

      if (schema.startsWith("Gap")) {
        cursorFrame += durVal;
        continue;
      }

      if (schema.startsWith("Clip") || !schema) {
        const name = child.name || "clip";
        const inFrame = child.source_range?.start_time?.value ?? 0;
        const outFrame = inFrame + durVal;
        const startFrame = cursorFrame;
        const endFrame = startFrame + durVal;
        const durationFrames = durVal;

        let filePath: string | undefined = undefined;
        const targetUrl = child.media_reference?.target_url || child.media_reference?.targetUrl;
        if (targetUrl) {
          try {
            filePath = decodeURIComponent(new URL(targetUrl).pathname);
            if (process.platform === "win32" && filePath.startsWith("/")) {
              filePath = filePath.slice(1);
            }
          } catch {
            filePath = targetUrl;
          }
        }

        let meta = extractShotMetadataFromFilename(name);
        if (filePath) {
          const fileMeta = extractShotMetadataFromFilename(filePath);
          if (meta.takeNumber === undefined && fileMeta.takeNumber !== undefined) {
            meta.takeNumber = fileMeta.takeNumber;
          }
          if (!meta.shotId && fileMeta.shotId) {
            meta.shotId = fileMeta.shotId;
          }
        }
        const shotId = meta.shotId;
        const takeNumber = meta.takeNumber;

        const clip: IngestedClipItem = {
          id: child.name || `clip_${startFrame}`,
          name,
          startFrame,
          endFrame,
          inFrame,
          outFrame,
          durationFrames,
          filePath,
          shotId,
          takeNumber,
          isAudio: !isVideo && isAudio,
        };

        if (isVideo) {
          videoClips.push(clip);
        } else if (isAudio) {
          audioClips.push(clip);
        } else {
          videoClips.push(clip);
        }

        cursorFrame = endFrame;
      }
    }
  }

  videoClips.sort((a, b) => a.startFrame - b.startFrame);
  const totalFrames = videoClips.length > 0 ? Math.max(...videoClips.map((c) => c.endFrame)) : 0;
  const totalDurationSec = totalFrames / fps;

  return {
    sequenceName: seqName,
    fps,
    videoClips,
    audioClips,
    totalFrames,
    totalDurationSec,
  };
}

/**
 * Universal NLE Timeline parser supporting both FCP7 XML (xmeml) and OpenTimelineIO (.otio) JSON.
 */
export function parseNleTimeline(content: string, format?: "xml" | "otio"): IngestedNleTimeline {
  const trimmed = content.trim();
  if (format === "otio" || trimmed.startsWith("{")) {
    return parseOtioJson(trimmed);
  }
  return parseFcp7Xml(trimmed);
}

/**
 * Compares an edited timeline against the original UnifiedTimeline to generate a structural diff.
 */
export function compareWithTimeline(
  original: UnifiedTimeline,
  edited: IngestedNleTimeline
): NleDiffReport {
  const fps = original.fps || 30;
  const trimmedShots: ShotTrimDiff[] = [];
  const swappedTakes: ShotTakeSwapDiff[] = [];
  const removedShots: string[] = [];
  const reorderedShots: Array<{ shotId: string; originalIndex: number; newIndex: number }> = [];

  const originalShotMap = new Map<string, { shot: TimelineVideoShot; index: number }>();
  original.videoTrack.forEach((sh, idx) => {
    originalShotMap.set(sh.shotId.toLowerCase(), { shot: sh, index: idx });
  });

  const seenInEdited = new Set<string>();

  edited.videoClips.forEach((clip, newIdx) => {
    if (!clip.shotId) return;
    const sId = clip.shotId.toLowerCase();
    seenInEdited.add(sId);

    const origEntry = originalShotMap.get(sId);
    if (!origEntry) return;

    const origShot = origEntry.shot;
    const origIndex = origEntry.index;

    // 1. Check Trim / Duration changes
    const editedDurationSec = clip.durationFrames / fps;
    const durDelta = editedDurationSec - origShot.durationSec;
    if (Math.abs(durDelta) >= 0.05) {
      trimmedShots.push({
        shotId: origShot.shotId,
        originalDurationSec: origShot.durationSec,
        editedDurationSec,
        deltaSec: durDelta,
      });
    }

    // 2. Check Take Swap
    if (clip.takeNumber !== undefined) {
      const origTakeMatch = /take_?(\d+)/i.exec(origShot.approvedClipPath || "");
      const origTakeNum = origTakeMatch ? parseInt(origTakeMatch[1], 10) : 1;
      if (origTakeNum !== clip.takeNumber) {
        let fallbackPath = origShot.approvedClipPath || "";
        if (/take_?\d+/i.test(fallbackPath)) {
          fallbackPath = fallbackPath.replace(
            /take_?\d+/i,
            `take${String(clip.takeNumber).padStart(2, "0")}`
          );
        } else if (fallbackPath) {
          const dotIdx = fallbackPath.lastIndexOf(".");
          const takeSuffix = `_take${String(clip.takeNumber).padStart(2, "0")}`;
          fallbackPath = dotIdx !== -1
            ? `${fallbackPath.slice(0, dotIdx)}${takeSuffix}${fallbackPath.slice(dotIdx)}`
            : `${fallbackPath}${takeSuffix}`;
        }
        const clipDurSec = clip.durationFrames > 0 ? clip.durationFrames / fps : origShot.durationSec;
        swappedTakes.push({
          shotId: origShot.shotId,
          originalTakeNumber: origTakeNum,
          newTakeNumber: clip.takeNumber,
          newClipPath: clip.filePath || fallbackPath || "",
          durationSec: clipDurSec,
        });
      }
    }

    // 3. Check Reordering
    if (origIndex !== newIdx) {
      reorderedShots.push({
        shotId: origShot.shotId,
        originalIndex: origIndex,
        newIndex: newIdx,
      });
    }
  });

  // 4. Check Removed Shots
  for (const [sId, { shot }] of originalShotMap.entries()) {
    if (!seenInEdited.has(sId)) {
      removedShots.push(shot.shotId);
    }
  }

  const origTotalDur = original.targetTotalDurationSec;
  const editedTotalDur = edited.totalDurationSec;
  const totalDurationDeltaSec = editedTotalDur - origTotalDur;

  const hasModifications =
    trimmedShots.length > 0 ||
    swappedTakes.length > 0 ||
    removedShots.length > 0 ||
    reorderedShots.length > 0 ||
    Math.abs(totalDurationDeltaSec) >= 0.1;

  return {
    hasModifications,
    sequenceName: edited.sequenceName,
    originalTotalDurationSec: origTotalDur,
    editedTotalDurationSec: editedTotalDur,
    totalDurationDeltaSec,
    trimmedShots,
    swappedTakes,
    removedShots,
    reorderedShots,
  };
}

/**
 * Applies human NLE edits (e.g. approved take swaps) directly into the Story Bible database.
 */
export function applyNleEditsToBible(
  diff: NleDiffReport,
  bible: BibleManager,
  seriesId: string,
  episodeNumber: number
): boolean {
  if (!diff.hasModifications) {
    return false;
  }

  log.info(`[NLE INGEST] Đang đồng bộ thay đổi từ Editor vào Story Bible cho Tập ${episodeNumber}...`);

  // 1. Update Swapped Takes
  for (const swap of diff.swappedTakes) {
    log.info(
      `  - Đổi Take cho Shot [${swap.shotId}]: Take ${swap.originalTakeNumber ?? "?"} -> Take ${swap.newTakeNumber}`
    );
    // In Story Bible, mark the newly chosen take as approved
    const takes = bible.listShotTakes(seriesId, episodeNumber);
    let foundTarget = false;
    for (const t of takes) {
      if (t.shot_id.toLowerCase() === swap.shotId.toLowerCase()) {
        const isTarget = t.take_number === swap.newTakeNumber;
        if (isTarget) foundTarget = true;
        bible.upsertShotTake({
          ...t,
          is_approved: isTarget ? 1 : 0,
        });
      }
    }
    // If the swapped take number does not yet exist in SQLite, insert it as approved
    if (!foundTarget && swap.newTakeNumber) {
      const takeNumStr = String(swap.newTakeNumber).padStart(2, "0");
      const trimmed = diff.trimmedShots.find(
        (t) => t.shotId.toLowerCase() === swap.shotId.toLowerCase()
      );
      const shotTakes = takes.filter(
        (t) => t.shot_id.toLowerCase() === swap.shotId.toLowerCase()
      );
      const effectiveDuration =
        swap.durationSec ??
        trimmed?.editedDurationSec ??
        (shotTakes.length > 0 ? shotTakes[0].duration_sec : 3.0);
      bible.upsertShotTake({
        id: `${swap.shotId}_take${takeNumStr}`,
        shot_id: swap.shotId,
        series_id: seriesId,
        episode_number: episodeNumber,
        take_number: swap.newTakeNumber,
        provider: "nle_import",
        prompt: `NLE imported take ${swap.newTakeNumber}`,
        local_path: swap.newClipPath || "",
        duration_sec: effectiveDuration,
        is_approved: 1,
      });
    }
  }

  // 2. Record State Event for audit trail
  bible.recordStateEvent({
    series_id: seriesId,
    episode_number: episodeNumber,
    entity_type: "world",
    entity_id: `nle_roundtrip_ep${episodeNumber}`,
    event_type: "status_change",
    to_state_json: JSON.stringify({
      diffSummary: {
        trimmedShotsCount: diff.trimmedShots.length,
        swappedTakesCount: diff.swappedTakes.length,
        removedShotsCount: diff.removedShots.length,
        durationDeltaSec: diff.totalDurationDeltaSec,
      },
    }),
    confirmation_source: "manual_override",
  });

  return true;
}

/**
 * Recalculates UnifiedTimeline by applying human NLE edits (trimmed durations, swapped takes, clip reordering).
 * Re-aligns cumulative timestamps across all shots to guarantee Zero-Drift continuity for instant re-assembly.
 */
export function applyNleEditsToTimeline(
  original: UnifiedTimeline,
  diff: NleDiffReport,
  edited: IngestedNleTimeline
): UnifiedTimeline {
  const fps = original.fps || 30;
  const trimMap = new Map<string, number>();
  for (const t of diff.trimmedShots) {
    trimMap.set(t.shotId.toLowerCase(), t.editedDurationSec);
  }

  const headTrimMap = new Map<string, number>();
  for (const clip of edited.videoClips) {
    if (clip.shotId && clip.inFrame > 0) {
      headTrimMap.set(clip.shotId.toLowerCase(), clip.inFrame / fps);
    }
  }

  const swapMap = new Map<string, { newClipPath: string; newTakeNumber: number }>();
  for (const s of diff.swappedTakes) {
    swapMap.set(s.shotId.toLowerCase(), { newClipPath: s.newClipPath, newTakeNumber: s.newTakeNumber });
  }

  const originalShotMap = new Map<string, TimelineVideoShot>();
  for (const sh of original.videoTrack) {
    originalShotMap.set(sh.shotId.toLowerCase(), sh);
  }

  // Construct new ordered video track based on edited sequence or original sequence
  let orderedShots: TimelineVideoShot[] = [];

  if (edited.videoClips.length > 0) {
    const seen = new Set<string>();
    for (const clip of edited.videoClips) {
      if (!clip.shotId) continue;
      const sId = clip.shotId.toLowerCase();
      if (seen.has(sId)) continue;
      seen.add(sId);

      const baseShot = originalShotMap.get(sId);
      if (baseShot) {
        orderedShots.push({ ...baseShot });
      }
    }
    // Append any shots from original that were not removed
    const removedSet = new Set(diff.removedShots.map((r) => r.toLowerCase()));
    for (const sh of original.videoTrack) {
      const sId = sh.shotId.toLowerCase();
      if (!seen.has(sId) && !removedSet.has(sId)) {
        orderedShots.push({ ...sh });
      }
    }
  } else {
    orderedShots = original.videoTrack.map((s) => ({ ...s }));
  }

  // Apply swapped takes, trimmed durations, and head trims
  for (const shot of orderedShots) {
    const sId = shot.shotId.toLowerCase();
    const swap = swapMap.get(sId);
    if (swap) {
      shot.approvedClipPath = swap.newClipPath;
    }
    const trimmedSec = trimMap.get(sId);
    if (trimmedSec !== undefined && trimmedSec > 0) {
      shot.durationSec = trimmedSec;
      shot.durationFrames = Math.round(trimmedSec * fps);
    }
    const headTrim = headTrimMap.get(sId);
    if (headTrim !== undefined) {
      shot.trimStartSec = headTrim;
    }
  }

  // Recalculate continuous timestamps across the entire video track (Zero-Drift)
  let currentFrame = 0;
  let currentSec = 0;
  for (const shot of orderedShots) {
    const durSec = typeof shot.durationSec === "number" && !isNaN(shot.durationSec) && shot.durationSec > 0
      ? shot.durationSec
      : 4.0;
    shot.durationSec = durSec;
    const durFrames = typeof shot.durationFrames === "number" && !isNaN(shot.durationFrames) && shot.durationFrames > 0
      ? shot.durationFrames
      : Math.round(durSec * fps);
    shot.durationFrames = durFrames;

    shot.startFrame = currentFrame;
    shot.startSec = currentSec;
    shot.endFrame = currentFrame + durFrames;
    shot.endSec = currentSec + durSec;
    currentFrame = shot.endFrame;
    currentSec = shot.endSec;
  }

  const targetTotalFrames = currentFrame;
  const targetTotalDurationSec = currentSec;

  const newShotMap = new Map<string, TimelineVideoShot>();
  for (const sh of orderedShots) {
    newShotMap.set(sh.shotId.toLowerCase(), sh);
  }

  // Re-align dialogue track to match trimmed/reordered shots
  const realignedDialogueTrack = (original.dialogueTrack || [])
    .filter((cue) => newShotMap.has(cue.shotId.toLowerCase()))
    .map((cue) => {
      const origShot = originalShotMap.get(cue.shotId.toLowerCase());
      const newShot = newShotMap.get(cue.shotId.toLowerCase())!;
      const offsetSec = origShot ? Math.max(0, cue.startSec - origShot.startSec) : 0;
      const startSec = newShot.startSec + Math.min(offsetSec, Math.max(0, newShot.durationSec - 0.05));
      const durationSec = Math.min(cue.durationSec, Math.max(0.05, newShot.endSec - startSec));
      const endSec = startSec + durationSec;
      const startFrame = Math.round(startSec * fps);
      const endFrame = Math.round(endSec * fps);
      return {
        ...cue,
        startSec,
        endSec,
        durationSec,
        startFrame,
        endFrame,
        durationFrames: Math.max(0, endFrame - startFrame),
      };
    });

  // Re-align subtitle track
  const realignedSubtitleTrack = (original.subtitleTrack || [])
    .filter((cue) => newShotMap.has(cue.shotId.toLowerCase()))
    .map((cue) => {
      const origShot = originalShotMap.get(cue.shotId.toLowerCase());
      const newShot = newShotMap.get(cue.shotId.toLowerCase())!;
      const offsetSec = origShot ? Math.max(0, cue.startSec - origShot.startSec) : 0;
      const startSec = newShot.startSec + Math.min(offsetSec, Math.max(0, newShot.durationSec - 0.05));
      const durationSec = Math.min(cue.durationSec, Math.max(0.05, newShot.endSec - startSec));
      const endSec = startSec + durationSec;
      const startFrame = Math.round(startSec * fps);
      const endFrame = Math.round(endSec * fps);
      return {
        ...cue,
        startSec,
        endSec,
        durationSec,
        startFrame,
        endFrame,
      };
    });

  // Re-align SFX cues that are tied to shotId
  const realignedSfxTrack = (original.sfxTrack || [])
    .filter((cue) => !cue.shotId || newShotMap.has(cue.shotId.toLowerCase()))
    .map((cue) => {
      if (!cue.shotId) {
        const startSec = Math.min(cue.startSec, targetTotalDurationSec);
        const durationSec = Math.min(cue.durationSec, Math.max(0, targetTotalDurationSec - startSec));
        return {
          ...cue,
          startSec,
          durationSec,
          startFrame: Math.round(startSec * fps),
          durationFrames: Math.round(durationSec * fps),
        };
      }
      const origShot = originalShotMap.get(cue.shotId.toLowerCase());
      const newShot = newShotMap.get(cue.shotId.toLowerCase())!;
      const offsetSec = origShot ? Math.max(0, cue.startSec - origShot.startSec) : 0;
      const startSec = newShot.startSec + Math.min(offsetSec, Math.max(0, newShot.durationSec - 0.05));
      const durationSec = Math.min(cue.durationSec, Math.max(0.05, newShot.endSec - startSec));
      return {
        ...cue,
        startSec,
        durationSec,
        startFrame: Math.round(startSec * fps),
        durationFrames: Math.round(durationSec * fps),
      };
    });

  // Re-align and clamp Ambience Track to new timeline boundary
  const rawAmbience = Array.isArray(original.ambienceTrack)
    ? original.ambienceTrack
    : original.ambienceTrack
    ? [original.ambienceTrack]
    : [];
  const realignedAmbienceTrack = rawAmbience
    .filter((cue) => cue.startSec < targetTotalDurationSec)
    .map((cue) => {
      const startSec = Math.min(cue.startSec, targetTotalDurationSec);
      const durationSec = Math.min(cue.durationSec, Math.max(0, targetTotalDurationSec - startSec));
      return {
        ...cue,
        startSec,
        durationSec,
        startFrame: Math.round(startSec * fps),
        durationFrames: Math.round(durationSec * fps),
      };
    })
    .filter((cue) => cue.durationSec > 0);

  // Re-align and clamp BGM Track to new timeline duration, recalculating ducking windows
  let realignedBgmTrack = original.bgmTrack;
  if (original.bgmTrack) {
    const bgmDurationSec = Math.min(original.bgmTrack.durationSec, targetTotalDurationSec);
    const bgmDurationFrames = Math.round(bgmDurationSec * fps);
    const duckingWindows = realignedDialogueTrack.map((d) => ({
      startSec: Math.max(0, d.startSec - 0.2),
      endSec: Math.min(targetTotalDurationSec, d.endSec + 0.3),
      startFrame: Math.max(0, Math.round((d.startSec - 0.2) * fps)),
      endFrame: Math.min(targetTotalFrames, Math.round((d.endSec + 0.3) * fps)),
    }));

    realignedBgmTrack = {
      ...original.bgmTrack,
      durationSec: bgmDurationSec,
      durationFrames: bgmDurationFrames,
      duckingWindows,
    };
  }

  return {
    ...original,
    targetTotalFrames,
    targetTotalDurationSec,
    videoTrack: orderedShots,
    dialogueTrack: realignedDialogueTrack,
    subtitleTrack: realignedSubtitleTrack,
    sfxTrack: realignedSfxTrack,
    ambienceTrack: realignedAmbienceTrack,
    bgmTrack: realignedBgmTrack,
    metrics: {
      ...original.metrics,
      videoDurationSec: targetTotalDurationSec,
      audioDurationSec: targetTotalDurationSec,
      driftSec: 0,
      driftFrames: 0,
      isWithinTolerance: true,
      toleranceSec: original.metrics?.toleranceSec ?? 0.05,
    },
  };
}
