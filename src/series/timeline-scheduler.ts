import type { EpisodicScript, Shot, DialogueLine } from "./series-schema.js";
import {
  secToFrame,
  frameToSec,
  getFrameToleranceSec,
  CODEC_PADDING_TOLERANCE_SEC,
  DialogueOverflowError,
  type DialogueOverflowPolicy,
  type TimelineVideoShot,
  type TimelineDialogueCue,
  type TimelineSfxCue,
  type TimelineAmbienceCue,
  type TimelineBgmCue,
  type TimelineSubtitleCue,
  type UnifiedTimeline,
} from "./timeline-schema.js";
import { log } from "../utils/logger.js";

export interface ScheduleTimelineOptions {
  fps?: number;
  sampleRate?: number;
  overflowPolicy?: DialogueOverflowPolicy;
  postDialoguePaddingSec?: number; // silence gap after speech within shot
  turnGapSec?: number; // silence gap between dialogue turns in same shot
  transitionDurationSec?: number; // crossfade overlap duration between shots
  transitionType?: "cut" | "crossfade";
  bgmBaseVolume?: number;
  bgmDuckedVolume?: number;
}

export interface MeasuredTtsDurations {
  [dialogueId: string]: number; // dialogueId -> measured duration in seconds
}

/**
 * Unified Timeline Scheduler for Episodic AI Film Series.
 *
 * Implements strict integer-frame timebase, measures TTS before locking timeline,
 * handles dialogue-to-shot overflow policies, schedules frame-accurate silence gaps,
 * computes transition overlaps, and prepares multi-track audio stems.
 */
export class TimelineScheduler {
  /**
   * Builds a frame-locked UnifiedTimeline from a validated EpisodicScript and measured TTS durations.
   */
  public static schedule(
    script: EpisodicScript,
    ttsDurations: MeasuredTtsDurations = {},
    options: ScheduleTimelineOptions = {}
  ): UnifiedTimeline {
    const fps = options.fps ?? script.fps ?? 30;
    const sampleRate = options.sampleRate ?? 48000;
    const overflowPolicy = options.overflowPolicy ?? "extend_shot";
    const postDialoguePaddingSec = options.postDialoguePaddingSec ?? 0.3;
    const turnGapSec = options.turnGapSec ?? 0.15;
    const transitionDurSec = options.transitionDurationSec ?? 0.0;
    const transitionType = options.transitionType ?? (transitionDurSec > 0 ? "crossfade" : "cut");

    const transitionFrames = transitionType === "crossfade" ? secToFrame(transitionDurSec, fps) : 0;
    const effectiveTransSec = frameToSec(transitionFrames, fps);

    const videoTrack: TimelineVideoShot[] = [];
    const dialogueTrack: TimelineDialogueCue[] = [];
    const sfxTrack: TimelineSfxCue[] = [];
    const ambienceTrack: TimelineAmbienceCue[] = [];
    const subtitleTrack: TimelineSubtitleCue[] = [];

    let currentFrameCursor = 0;
    let totalShotsProcessed = 0;

    for (const scene of script.scenes) {
      const sceneStartFrame = currentFrameCursor;

      // Add ambient room tone for the scene
      const sceneAmbienceCue: TimelineAmbienceCue = {
        cueId: `amb_${scene.sceneId}`,
        sceneId: scene.sceneId,
        name: scene.timeOfDay === "day" ? "city_day_ambience" : "cyber_night_ambience",
        startFrame: sceneStartFrame,
        durationFrames: 0, // will be finalized after all shots in scene are placed
        startSec: frameToSec(sceneStartFrame, fps),
        durationSec: 0,
        audioPath: "",
        volume: 0.25,
        fadeInSec: 0.5,
        fadeOutSec: 0.5,
      };

      for (let shotIdx = 0; shotIdx < scene.shots.length; shotIdx++) {
        const shot = scene.shots[shotIdx];
        totalShotsProcessed++;

        // 1. Gather all dialogue lines for this shot
        const dList: DialogueLine[] =
          shot.dialogues && shot.dialogues.length > 0
            ? shot.dialogues
            : shot.dialogue
            ? [shot.dialogue]
            : [];

        // 2. Measure required dialogue duration across turns
        let totalDialogueDurSec = 0;
        const measuredTurns: Array<{ line: DialogueLine; durSec: number }> = [];

        for (let i = 0; i < dList.length; i++) {
          const line = dList[i];
          const lineId = line.dialogueId || `${shot.shotId}_d${String(i + 1).padStart(2, "0")}`;
          let dur = ttsDurations[lineId];

          if (dur === undefined || dur <= 0) {
            // Fallback estimation if not measured beforehand
            const textToMeasure = line.ttsText || line.text;
            const words = textToMeasure.trim().split(/\s+/).length;
            dur = Math.max(1.0, Math.round((words / 2.6) * 10) / 10);
            log.warn(
              `[TIMELINE] Chưa có đo đạc TTS thật cho câu '${lineId}'. Tạm tính thời lượng: ${dur.toFixed(2)}s.`
            );
          }

          measuredTurns.push({ line, durSec: dur });
          totalDialogueDurSec += dur;
          if (i > 0) {
            totalDialogueDurSec += turnGapSec;
          }
        }

        // 3. Apply Dialogue-to-Shot Overflow Policy
        let effectiveShotSec = shot.durationSec;
        const requiredShotSec =
          totalDialogueDurSec > 0
            ? totalDialogueDurSec + postDialoguePaddingSec
            : shot.durationSec;

        if (requiredShotSec > shot.durationSec) {
          if (overflowPolicy === "error") {
            const firstLineId = dList[0]?.dialogueId || `${shot.shotId}_d01`;
            throw new DialogueOverflowError(
              shot.shotId,
              firstLineId,
              shot.durationSec,
              requiredShotSec
            );
          } else if (overflowPolicy === "extend_shot") {
            effectiveShotSec = requiredShotSec;
            log.info(
              `[TIMELINE EXTEND] Kéo dài cú máy '${shot.shotId}' từ ${shot.durationSec}s lên ${effectiveShotSec.toFixed(
                2
              )}s để khớp toàn bộ ${dList.length} câu thoại.`
            );
          } else if (overflowPolicy === "split_shot") {
            // Extend to fit, note split policy
            effectiveShotSec = requiredShotSec;
          }
        }

        // 4. Quantize shot duration into exact integer frames
        const shotDurationFrames = secToFrame(effectiveShotSec, fps);
        const quantizedShotSec = frameToSec(shotDurationFrames, fps);

        // Calculate start frame taking transition overlap into account
        let shotStartFrame = currentFrameCursor;
        if (totalShotsProcessed > 1 && transitionFrames > 0) {
          // Crossfade starts before previous shot finishes
          shotStartFrame = Math.max(0, currentFrameCursor - transitionFrames);
        }

        const shotEndFrame = shotStartFrame + shotDurationFrames;
        const shotStartSec = frameToSec(shotStartFrame, fps);
        const shotEndSec = frameToSec(shotEndFrame, fps);

        // 5. Build Timeline Video Shot
        videoTrack.push({
          shotId: shot.shotId,
          sceneId: scene.sceneId,
          startFrame: shotStartFrame,
          endFrame: shotEndFrame,
          durationFrames: shotDurationFrames,
          startSec: shotStartSec,
          endSec: shotEndSec,
          durationSec: quantizedShotSec,
          shotType: shot.shotType,
          visualPrompt: shot.visualPrompt,
          referenceImage: shot.referenceImage,
          characterId: shot.characterId,
          transitionIn:
            totalShotsProcessed > 1 && transitionFrames > 0
              ? {
                  type: transitionType,
                  durationSec: effectiveTransSec,
                  durationFrames: transitionFrames,
                }
              : undefined,
          transitionOut:
            transitionFrames > 0
              ? {
                  type: transitionType,
                  durationSec: effectiveTransSec,
                  durationFrames: transitionFrames,
                }
              : undefined,
          trimStartSec: 0,
        });

        // 6. Schedule Dialogue Cues inside the shot
        let dialogueFrameCursor = shotStartFrame;
        // In crossfade transitions, offset dialogue start past the transition midpoint to ensure clean audio
        if (totalShotsProcessed > 1 && transitionFrames > 0) {
          dialogueFrameCursor += Math.floor(transitionFrames / 2);
        }

        for (let turnIdx = 0; turnIdx < measuredTurns.length; turnIdx++) {
          const { line, durSec } = measuredTurns[turnIdx];
          const dDurFrames = secToFrame(durSec, fps);
          const dStartFrame = dialogueFrameCursor;
          const dEndFrame = dStartFrame + dDurFrames;

          const dStartSec = frameToSec(dStartFrame, fps);
          const dEndSec = frameToSec(dEndFrame, fps);
          const dDurSec = frameToSec(dDurFrames, fps);

          const cueId = line.dialogueId || `${shot.shotId}_d${String(turnIdx + 1).padStart(2, "0")}`;

          // Dialogue Cue
          dialogueTrack.push({
            dialogueId: cueId,
            shotId: shot.shotId,
            characterId: line.characterId,
            speakerName: line.speakerName,
            rawText: line.rawText || line.text,
            subtitleText: line.subtitleText || line.text,
            ttsText: line.ttsText || line.text,
            actingInstruction: line.actingInstruction,
            type: line.type || "speech",
            isOffScreen: line.type === "voiceover" || line.characterId === "narrator",
            startFrame: dStartFrame,
            endFrame: dEndFrame,
            durationFrames: dDurFrames,
            startSec: dStartSec,
            endSec: dEndSec,
            durationSec: dDurSec,
            voiceProfileId: line.voiceProfileId,
            audioPath: "",
            volume: 1.0,
          });

          // Subtitle Cue - STRICTLY uses subtitleText (clean text), NEVER phonetic ttsText
          subtitleTrack.push({
            subtitleId: `sub_${cueId}`,
            shotId: shot.shotId,
            dialogueId: cueId,
            speakerName: line.speakerName,
            displayText: line.subtitleText || line.text,
            actingInstruction: line.actingInstruction,
            startFrame: dStartFrame,
            endFrame: dEndFrame,
            startSec: dStartSec,
            endSec: dEndSec,
            durationSec: dDurSec,
          });

          dialogueFrameCursor = dEndFrame + secToFrame(turnGapSec, fps);
        }

        // 7. Schedule SFX Cue if present
        if (shot.sfxCue) {
          const offsetFrames = secToFrame(shot.sfxCue.offsetSec || 0, fps);
          const sfxStartFrame = shotStartFrame + offsetFrames;
          const sfxStartSec = frameToSec(sfxStartFrame, fps);
          sfxTrack.push({
            cueId: `sfx_${shot.shotId}_${shot.sfxCue.name}`,
            shotId: shot.shotId,
            name: shot.sfxCue.name,
            startFrame: sfxStartFrame,
            durationFrames: 0,
            startSec: sfxStartSec,
            durationSec: 0,
            volume: shot.sfxCue.volume ?? 0.7,
            audioPath: "",
          });
        }

        currentFrameCursor = shotEndFrame;
      }

      // Finalize scene ambience cue length
      const sceneEndFrame = currentFrameCursor;
      sceneAmbienceCue.durationFrames = sceneEndFrame - sceneStartFrame;
      sceneAmbienceCue.durationSec = frameToSec(sceneAmbienceCue.durationFrames, fps);
      ambienceTrack.push(sceneAmbienceCue);
    }

    const targetTotalFrames = currentFrameCursor;
    const targetTotalDurationSec = frameToSec(targetTotalFrames, fps);

    // 8. Schedule BGM Track & Auto-Ducking Windows
    let bgmCue: TimelineBgmCue | undefined = undefined;
    if (script.bgm && script.bgm !== "none") {
      const duckingWindows: Array<{
        startSec: number;
        endSec: number;
        startFrame: number;
        endFrame: number;
      }> = [];

      // Create ducking window for each dialogue cue (with 0.2s lead-in and 0.4s tail-out)
      for (const d of dialogueTrack) {
        const leadFrames = secToFrame(0.2, fps);
        const tailFrames = secToFrame(0.4, fps);
        const dStartF = Math.max(0, d.startFrame - leadFrames);
        const dEndF = Math.min(targetTotalFrames, d.endFrame + tailFrames);

        duckingWindows.push({
          startFrame: dStartF,
          endFrame: dEndF,
          startSec: frameToSec(dStartF, fps),
          endSec: frameToSec(dEndF, fps),
        });
      }

      bgmCue = {
        audioPath: script.bgm,
        startFrame: 0,
        durationFrames: targetTotalFrames,
        startSec: 0,
        durationSec: targetTotalDurationSec,
        baseVolume: options.bgmBaseVolume ?? 0.2,
        duckedVolume: options.bgmDuckedVolume ?? 0.05,
        duckingWindows,
      };
    }

    // 9. Initial Timeline Metrics
    const toleranceSec = getFrameToleranceSec(fps) + CODEC_PADDING_TOLERANCE_SEC;

    return {
      seriesId: script.seriesId || "series_main",
      episodeNumber: script.episodeNumber,
      fps,
      sampleRate,
      targetTotalFrames,
      targetTotalDurationSec,
      videoTrack,
      dialogueTrack,
      sfxTrack,
      ambienceTrack,
      bgmTrack: bgmCue,
      subtitleTrack,
      stems: {},
      metrics: {
        videoDurationSec: targetTotalDurationSec,
        audioDurationSec: targetTotalDurationSec,
        driftSec: 0,
        driftFrames: 0,
        isWithinTolerance: true,
        toleranceSec,
      },
    };
  }
}
