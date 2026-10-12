import type {ConformedTimelineResult} from '../../../../contracts/media-features.js';
export type {ConformedTimelineResult} from '../../../../contracts/media-features.js';
import type { UnifiedTimeline, TimelineVideoShot, TimelineDialogueCue, TimelineSfxCue } from "../../../../contracts/timeline.js";
import { type IngestedNleTimeline, type NleDiffReport, type ShotTrimDiff, type ShotTakeSwapDiff, extractShotMetadataFromFilename } from "./nle-ingest-parser.js";
import { WorkflowError } from "../../../../platform/workflow-error.js";
import { log } from "../../../../platform/observability/logger.js";



/**
 * DaVinci Resolve & Premiere Pro Round-Trip Conformer.
 *
 * Re-integrates edited NLE timelines back into Studio UnifiedTimeline:
 * 1. Accurately identifies trimmed in/out points per shot.
 * 2. Detects take swaps and file re-linking.
 * 3. Detects clip re-ordering and deletions.
 * 4. Auto-realigns downstream audio tracks (Dialogue, Foley, SFX) and subtitles
 *    by cumulative delta time, preventing audio drift and desynchronization.
 */
export class NleRoundTripConformer {
  /**
   * Conforms an ingested NLE timeline with the master Studio UnifiedTimeline.
   */
  public static conform(
    original: UnifiedTimeline,
    ingested: IngestedNleTimeline
  ): ConformedTimelineResult {
    const fps = Math.round(original.fps || ingested.fps || 24);
    const trimmedShots: ShotTrimDiff[] = [];
    const swappedTakes: ShotTakeSwapDiff[] = [];
    const removedShots: string[] = [];
    const reorderedShots: Array<{ shotId: string; originalIndex: number; newIndex: number }> = [];

    // Clone video track to build conformed timeline
    const conformedVideoTrack: TimelineVideoShot[] = [];


    const originalShotMap = new Map<string, { shot: TimelineVideoShot; index: number }>();
    original.videoTrack.forEach((s, idx) => {
      originalShotMap.set(s.shotId.toLowerCase(), { shot: s, index: idx });
    });

    const shotIds = new Set(original.videoTrack.map(shot => shot.shotId));
    const sceneIds = new Set(original.videoTrack.map(shot => shot.sceneId));
    for (const cue of [...(original.dialogueTrack || []), ...(original.subtitleTrack || []), ...(original.sfxTrack || [])]) {
      if (cue.shotId && !shotIds.has(cue.shotId)) throw new WorkflowError("NLE_ORPHAN_CUE", "Cue tham chiếu shot không xác định.", "needs_review");
    }
    for (const cue of original.ambienceTrack || []) {
      if (cue.sceneId && !sceneIds.has(cue.sceneId)) throw new WorkflowError("NLE_ORPHAN_CUE", "Cue tham chiếu scene không xác định.", "needs_review");
    }
    const seenOriginalIds = new Set<string>();

    for (let newIdx = 0; newIdx < ingested.videoClips.length; newIdx++) {
      const clip = ingested.videoClips[newIdx];
      const meta = extractShotMetadataFromFilename(clip.name || clip.filePath || clip.id);
      const shotIdKey = (meta.shotId || clip.name || clip.id).toLowerCase();

      const origEntry = originalShotMap.get(shotIdKey);
      if (!origEntry) {
        log.warn(`[NLE CONFORM] Clip mới không có trong kịch bản gốc: ${shotIdKey}`);
        continue;
      }

      seenOriginalIds.add(shotIdKey);
      const origShot = origEntry.shot;
      const origIdx = origEntry.index;

      if (origIdx !== newIdx) {
        reorderedShots.push({ shotId: origShot.shotId, originalIndex: origIdx, newIndex: newIdx });
      }

      // 1. Calculate Trim Deltas
      const editedDurationSec = parseFloat((clip.durationFrames / fps).toFixed(3));
      const originalDurationSec = origShot.durationSec;
      const deltaSec = parseFloat((editedDurationSec - originalDurationSec).toFixed(3));

      const trimStartSec = Number((clip.inFrame / fps).toFixed(3));
      const sourceDuration = origShot.fileDurationSec ?? ((origShot.trimStartSec ?? 0) + originalDurationSec + (origShot.trimEndSec ?? 0));
      const trimEndSec = Number(Math.max(0, sourceDuration - trimStartSec - editedDurationSec).toFixed(3));
      if (Math.abs(deltaSec) > 0.04 || Math.abs(trimStartSec - (origShot.trimStartSec ?? 0)) > 0.5 / fps) {
        trimmedShots.push({
          shotId: origShot.shotId,
          originalDurationSec,
          editedDurationSec,
          deltaSec,
        });

      }

      // 2. Detect Take Swaps
      let approvedClipPath = origShot.approvedClipPath;
      if (meta.takeNumber !== undefined && meta.takeNumber !== (origShot as any).takeNumber) {
        swappedTakes.push({
          shotId: origShot.shotId,
          originalTakeNumber: (origShot as any).takeNumber,
          newTakeNumber: meta.takeNumber,
          newClipPath: clip.filePath || `shots/${origShot.shotId}_take${meta.takeNumber}.mp4`,
          durationSec: editedDurationSec,
        });
        approvedClipPath = clip.filePath || `shots/${origShot.shotId}_take${meta.takeNumber}.mp4`;
      }

      // Recalculate start time based on new sequence order
      const newStartSec = conformedVideoTrack.length === 0
        ? 0
        : parseFloat((conformedVideoTrack[conformedVideoTrack.length - 1].endSec).toFixed(3));
      const newEndSec = parseFloat((newStartSec + editedDurationSec).toFixed(3));

      conformedVideoTrack.push({
        ...origShot,
        startSec: newStartSec,
        endSec: newEndSec,
        durationSec: editedDurationSec,
        startFrame: Math.round(newStartSec * fps),
        endFrame: Math.round(newEndSec * fps),
        durationFrames: Math.round(editedDurationSec * fps),
        trimStartSec,
        trimEndSec,
        approvedClipPath,
      });
    }

    // Check for removed shots
    for (const [idKey, entry] of originalShotMap.entries()) {
      if (!seenOriginalIds.has(idKey)) {
        removedShots.push(entry.shot.shotId);
      }
    }

    // 3. Auto-Realign Audio Dialogue Track
    let realignedDialogueCount = 0;
    const retainedShots = new Set(conformedVideoTrack.map(shot => shot.shotId));
    const newTotalDurationSec = conformedVideoTrack.reduce((end, shot) => Math.max(end, shot.endSec), 0);
    const conformedDialogueTrack: TimelineDialogueCue[] = (original.dialogueTrack || []).filter(dia => retainedShots.has(dia.shotId)).map((dia) => {
      // Find corresponding video shot
      const matchedShot = conformedVideoTrack.find((s) => s.shotId === dia.shotId);
      if (matchedShot) {
        const originalShot = original.videoTrack.find((s) => s.shotId === dia.shotId);
        const originalShotStart = originalShot?.startSec ?? dia.startSec;
        const trimDelta = (matchedShot.trimStartSec ?? 0) - (originalShot?.trimStartSec ?? 0);
        const rawStart = matchedShot.startSec + dia.startSec - originalShotStart - trimDelta;
        const newStart = Math.max(matchedShot.startSec, rawStart);
        const clippedEnd = Math.min(matchedShot.endSec, rawStart + dia.durationSec);

        const durationSec = Math.max(0, clippedEnd - newStart);
        const newStartSec = parseFloat((newStart).toFixed(3));
        const newEndSec = parseFloat((newStartSec + durationSec).toFixed(3));
        if (Math.abs(newStartSec - dia.startSec) > 0.02) {
          realignedDialogueCount++;
        }

        return {
          ...dia,
          startSec: newStartSec,
          endSec: newEndSec,
          startFrame: Math.round(newStartSec * fps),
          endFrame: Math.round(newEndSec * fps),
          durationSec,
          durationFrames: Math.round(durationSec * fps),
        };
      }

      // If shot was removed or not found, keep relative position
      return dia;
    }).filter(dia => dia.durationSec > 0);

    // 4. Auto-Realign SFX Track
    let realignedSfxCount = 0;
    const conformedSfxTrack: TimelineSfxCue[] = (original.sfxTrack || []).filter(sfx => !sfx.shotId || retainedShots.has(sfx.shotId)).map((sfx) => {
      if (sfx.shotId) {
        const matchedShot = conformedVideoTrack.find((s) => s.shotId === sfx.shotId);
        if (matchedShot) {
          const originalShot = original.videoTrack.find((s) => s.shotId === sfx.shotId);
          const originalShotStart = originalShot?.startSec ?? sfx.startSec;
          const trimDelta = (matchedShot.trimStartSec ?? 0) - (originalShot?.trimStartSec ?? 0);
          const rawStart = matchedShot.startSec + sfx.startSec - originalShotStart - trimDelta;

          const newStart = Number(Math.max(matchedShot.startSec,rawStart).toFixed(3));
          const durationSec = Math.max(0,Math.min(matchedShot.endSec,rawStart+sfx.durationSec)-newStart);
          if (Math.abs(newStart - sfx.startSec) > 0.02) {
            realignedSfxCount++;
          }
          return {
            ...sfx,
            startSec: newStart, durationSec, durationFrames: Math.round(durationSec*fps),
            startFrame: Math.round(newStart * fps),
          };
        }
      }
      const startSec = Math.min(newTotalDurationSec, sfx.startSec);
      const durationSec=Math.min(sfx.durationSec, Math.max(0, newTotalDurationSec - startSec));
      return {...sfx,startSec,startFrame:Math.round(startSec*fps),durationSec,durationFrames:Math.round(durationSec*fps)};
    }).filter(sfx => sfx.durationSec > 0);

    // 5. Auto-Realign Subtitle Track
    const conformedSubtitleTrack = (original.subtitleTrack || []).filter(sub => retainedShots.has(sub.shotId)).map((sub) => {
      const newShot = conformedVideoTrack.find(shot => shot.shotId === sub.shotId);
      if (!newShot) {
        throw new WorkflowError("NLE_SUBTITLE_ANCHOR_AMBIGUOUS", `Không tìm thấy video shot ${sub.shotId} cho subtitle.`, "needs_review");
      }
      const oldShot = original.videoTrack.find(shot => shot.shotId === sub.shotId);
      const shotDiags = conformedDialogueTrack.filter(d => d.shotId === sub.shotId);

      // 4-Tier Matching Hierarchy
      // Tier 1: Direct ID Match
      let matchedDiag = sub.dialogueId
        ? shotDiags.find(d => d.dialogueId === sub.dialogueId)
        : undefined;

      // Tier 2: Temporal Overlap / Proximity
      if (!matchedDiag && shotDiags.length > 0) {
        let bestDiag = shotDiags[0];
        let maxOverlap = -1;
        let minDiff = Infinity;
        for (const d of shotDiags) {
          const overlap = Math.max(0, Math.min(d.endSec, sub.endSec) - Math.max(d.startSec, sub.startSec));
          const diff = Math.abs(d.startSec - sub.startSec);
          if (overlap > maxOverlap) {
            maxOverlap = overlap;
            minDiff = diff;
            bestDiag = d;
          } else if (overlap === maxOverlap && diff < minDiff) {
            minDiff = diff;
            bestDiag = d;
          }
        }
        matchedDiag = bestDiag;
      }

      // Tier 3: Ordinal Index Alignment
      if (!matchedDiag && shotDiags.length > 0) {
        const shotSubs = (original.subtitleTrack || []).filter(s => s.shotId === sub.shotId);
        const subIndex = shotSubs.indexOf(sub);
        if (subIndex >= 0 && subIndex < shotDiags.length) {
          matchedDiag = shotDiags[subIndex];
        } else {
          matchedDiag = shotDiags[0];
        }
      }

      const oldShotStart = oldShot?.startSec ?? newShot.startSec;
      const oldTrim = oldShot?.trimStartSec ?? 0;
      const newTrim = newShot.trimStartSec ?? 0;
      const rawStart = sub.startSec + newShot.startSec - oldShotStart - newTrim + oldTrim;

      if (matchedDiag) {
        let subDuration = sub.durationSec ?? (sub.endSec - sub.startSec);
        const newStart = Math.max(matchedDiag.startSec, rawStart);
        subDuration = Math.max(0, Math.min(matchedDiag.endSec, rawStart + subDuration) - newStart);
        const newEnd = parseFloat((newStart + subDuration).toFixed(3));
        return {
          ...sub,
          dialogueId: matchedDiag.dialogueId,
          startSec: newStart,
          endSec: newEnd,
          startFrame: Math.round(newStart * fps),
          endFrame: Math.round(newEnd * fps),
          durationSec: subDuration,
        };
      }

      // Tier 4: Direct Shot Fallback (no dialogue cues in shot)
      const newStart = Math.max(newShot.startSec, rawStart);
      const subDuration = Math.max(0, Math.min(newShot.endSec, rawStart + (sub.durationSec ?? (sub.endSec - sub.startSec))) - newStart);
      const newEnd = parseFloat((newStart + subDuration).toFixed(3));
      return {
        ...sub,
        startSec: newStart,
        endSec: newEnd,
        startFrame: Math.round(newStart * fps),
        endFrame: Math.round(newEnd * fps),
        durationSec: subDuration,
      };
    }).filter(sub => sub.durationSec > 0);

    // 6. Auto-Realign Ambience Track
    let realignedAmbienceCount = 0;
    const retainedScenes = new Set(conformedVideoTrack.map(shot => shot.sceneId));
    const conformedAmbienceTrack: import("../../../../contracts/timeline.js").TimelineAmbienceCue[] = [];
    for (const amb of (original.ambienceTrack || [])) {
      if (!amb.sceneId || !retainedScenes.has(amb.sceneId)) {
        if (!amb.sceneId) {
          const newStart = Number(Math.min(newTotalDurationSec, amb.startSec).toFixed(3));
          const newDur = Number(Math.min(Math.max(0, newTotalDurationSec - newStart), amb.durationSec).toFixed(3));
          if (newDur > 0) {
            if (Math.abs(newStart - amb.startSec) > 0.02 || Math.abs(newDur - amb.durationSec) > 0.02) {
              realignedAmbienceCount++;
            }
            conformedAmbienceTrack.push({
              ...amb,
              startSec: newStart,
              durationSec: newDur,
              startFrame: Math.round(newStart * fps),
              durationFrames: Math.round(newDur * fps),
            });
          }
        }
        continue;
      }

      // Group contiguous runs of shots matching amb.sceneId to eliminate cross-scene bleed
      const contiguousBlocks: TimelineVideoShot[][] = [];
      let currentBlock: TimelineVideoShot[] = [];
      for (const shot of conformedVideoTrack) {
        if (shot.sceneId === amb.sceneId) {
          currentBlock.push(shot);
        } else if (currentBlock.length > 0) {
          contiguousBlocks.push(currentBlock);
          currentBlock = [];
        }
      }
      if (currentBlock.length > 0) contiguousBlocks.push(currentBlock);

      contiguousBlocks.forEach((block, idx) => {
        const newStart = block[0].startSec;
        const newEnd = block[block.length - 1].endSec;
        const newDur = parseFloat(Math.max(0, newEnd - newStart).toFixed(3));
        if (newDur > 0) {
          if (Math.abs(newStart - amb.startSec) > 0.02 || Math.abs(newDur - amb.durationSec) > 0.02) {
            realignedAmbienceCount++;
          }
          conformedAmbienceTrack.push({
            ...amb,
            cueId: contiguousBlocks.length > 1 ? `${amb.cueId}_blk${idx + 1}` : amb.cueId,
            startSec: newStart,
            durationSec: newDur,
            startFrame: Math.round(newStart * fps),
            durationFrames: Math.round(newDur * fps),
          });
        }
      });
    }

    const hasModifications =
      trimmedShots.length > 0 ||
      swappedTakes.length > 0 ||
      removedShots.length > 0 ||
      reorderedShots.length > 0;

    const diffReport: NleDiffReport = {
      hasModifications,
      sequenceName: ingested.sequenceName || `Episode_${original.episodeNumber}_Conformed`,
      originalTotalDurationSec: original.targetTotalDurationSec,
      editedTotalDurationSec: newTotalDurationSec,
      totalDurationDeltaSec: parseFloat((newTotalDurationSec - original.targetTotalDurationSec).toFixed(3)),
      trimmedShots,
      swappedTakes,
      removedShots,
      reorderedShots,
    };

    const conformedDuckingWindows = original.bgmTrack
      ? conformedDialogueTrack.map((d) => {
          const leadSec = 0.2;
          const tailSec = 0.4;
          const startSec = parseFloat(Math.max(0, d.startSec - leadSec).toFixed(3));
          const endSec = parseFloat(Math.min(newTotalDurationSec, d.endSec + tailSec).toFixed(3));
          return {
            startSec,
            endSec,
            startFrame: Math.round(startSec * fps),
            endFrame: Math.round(endSec * fps),
          };
        })
      : [];

    const conformedBgmTrack = original.bgmTrack
      ? {
          ...original.bgmTrack,
          startSec: Math.min(original.bgmTrack.startSec, newTotalDurationSec),
          startFrame: Math.round(Math.min(original.bgmTrack.startSec, newTotalDurationSec) * fps),
          durationFrames: Math.round(Math.max(0, newTotalDurationSec - original.bgmTrack.startSec) * fps),
          durationSec: Math.max(0, newTotalDurationSec - original.bgmTrack.startSec),
          duckingWindows: conformedDuckingWindows,
        }
      : undefined;

    const conformedTimeline: UnifiedTimeline = {
      ...original,
      targetTotalDurationSec: newTotalDurationSec,
      targetTotalFrames: Math.round(newTotalDurationSec * fps),
      videoTrack: conformedVideoTrack,
      dialogueTrack: conformedDialogueTrack,
      sfxTrack: conformedSfxTrack,
      subtitleTrack: conformedSubtitleTrack,
      ambienceTrack: conformedAmbienceTrack,
      ...(conformedBgmTrack ? { bgmTrack: conformedBgmTrack } : {}),
    };

    log.info(`[NLE CONFORM] Hoàn tất conform timeline từ NLE (${ingested.sequenceName}):`);
    log.info(`  • Cắt gọt (Trims): ${trimmedShots.length} cú máy`);
    log.info(`  • Đổi Take: ${swappedTakes.length} cú máy`);
    log.info(`  • Tái căn chỉnh thoại: ${realignedDialogueCount} cue | SFX: ${realignedSfxCount} cue | Ambience: ${realignedAmbienceCount} cue`);
    log.info(`  • Độ lệch tổng thời lượng: ${diffReport.totalDurationDeltaSec}s (${original.targetTotalDurationSec}s -> ${newTotalDurationSec}s)`);

    return {
      conformedTimeline,
      diffReport,
      realignedDialogueCount,
      realignedSfxCount,
      realignedAmbienceCount,
      hasModifications,
    };
  }
}
