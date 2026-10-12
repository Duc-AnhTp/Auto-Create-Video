import type {TrailerAct,CandidateShot,TrailerCutItem,TrailerPacingPlan,TrailerGenerationOptions,TrailerAutoCutResult} from '../../../contracts/media-features.js';
export type {TrailerAct,CandidateShot,TrailerCutItem,TrailerPacingPlan,TrailerGenerationOptions,TrailerAutoCutResult} from '../../../contracts/media-features.js';
import { WorkflowError } from "../../../platform/workflow-error.js";
import { ShotTypeSchema, type ShotType } from "../../../contracts/episode.js";

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { UnifiedTimeline, TimelineVideoShot, TimelineDialogueCue, TimelineSfxCue } from "../../../contracts/timeline.js";
import { generateFcp7Xml, generateCmx3600Edl } from "../adapters/assembly/nle-exporter.js";
import { createValidMockMp4File } from "../adapters/assets/mock-media-generator.js";
import { log } from "../../../platform/observability/logger.js";

/**
 * Trailer Act classification according to Hollywood Teaser Trailer dramatic pacing standard.
 */










function toTimelineShotType(shotType: string): ShotType {
  if (shotType === "two_shot" || shotType === "ots_a_b" || shotType === "ots_b_a") return "over_the_shoulder";
  return ShotTypeSchema.parse(shotType);
}



/**
 * Hollywood Season Trailer Auto-Cut Engine.
 *
 * Automatically composes a high-tension, Hollywood-grade Teaser Trailer from
 * multi-episode season production shots:
 *
 * 1. 4-Act Dramatic Structure:
 *    - Act 1 (The Hook - 0s to 15s): Slow establishing shots, world building, mystery voiceover.
 *    - Act 2 (The Escalation - 15s to 38s): Accelerating rhythm, confrontational dialogues, rising percussion.
 *    - Act 3 (The Climax Montage - 38s to 52s): Rapid action montage, peak close-ups, braam hits, sub-drops.
 *    - Outro (Title & Tagline - 52s to 60s): Hard cut to black, final dialogue whisper, animated logo sting.
 *
 * 2. Algorithmic Candidate Scoring:
 *    Selects optimal cuts based on dramatic tension, shot dynamism, emotional dialogue, and visual variety.
 *
 * 3. Multi-Format Master Export:
 *    Generates video master (MP4), DaVinci Resolve / Premiere Pro FCP7 XML, CMX 3600 EDL, and JSON manifest.
 */
export class SeasonTrailerAutoCutter {
  /**
   * Builds the 4-act timeline pacing breakdown according to desired trailer duration.
   */
  public static planTrailerPacing(targetDurationSec: number = 60): TrailerPacingPlan {
    if (targetDurationSec === 30) {
      return {
        totalTargetDurationSec: 30,
        actStructure: [
          {
            act: "act_1_hook",
            startSec: 0,
            endSec: 8,
            targetShotDurationRange: [2.5, 3.5],
            intendedPacing: "Thiết lập bối cảnh và câu hỏi bí ẩn",
          },
          {
            act: "act_2_escalation",
            startSec: 8,
            endSec: 18,
            targetShotDurationRange: [1.8, 2.4],
            intendedPacing: "Xung đột tăng tốc, nhịp gõ dồn",
          },
          {
            act: "act_3_climax",
            startSec: 18,
            endSec: 25,
            targetShotDurationRange: [0.8, 1.4],
            intendedPacing: "Montage hành động cực hạn, âm trầm bùng nổ",
          },
          {
            act: "outro_title_card",
            startSec: 25,
            endSec: 30,
            targetShotDurationRange: [2.0, 3.0],
            intendedPacing: "Im lặng kịch tính, hiện logo và khẩu hiệu",
          },
        ],
      };
    }

    if (targetDurationSec === 90) {
      return {
        totalTargetDurationSec: 90,
        actStructure: [
          {
            act: "act_1_hook",
            startSec: 0,
            endSec: 22,
            targetShotDurationRange: [3.5, 5.0],
            intendedPacing: "Khám phá thế giới, thoại dẫn dắt sâu lắng",
          },
          {
            act: "act_2_escalation",
            startSec: 22,
            endSec: 55,
            targetShotDurationRange: [2.0, 3.0],
            intendedPacing: "Xung đột đa tuyến, nhịp cắt tăng dần",
          },
          {
            act: "act_3_climax",
            startSec: 55,
            endSec: 78,
            targetShotDurationRange: [0.9, 1.6],
            intendedPacing: "Đại chiến cao trào, foley dồn dập, braam liên hoàn",
          },
          {
            act: "outro_title_card",
            startSec: 78,
            endSec: 90,
            targetShotDurationRange: [3.0, 6.0],
            intendedPacing: "Khoảnh khắc đọng lại, logo rực sáng và ngày chiếu",
          },
        ],
      };
    }

    // Default 60-Second Hollywood Standard Teaser
    return {
      totalTargetDurationSec: 60,
      actStructure: [
        {
          act: "act_1_hook",
          startSec: 0,
          endSec: 15,
          targetShotDurationRange: [3.0, 4.5],
          intendedPacing: "Thiết lập bối cảnh, câu hỏi bí ẩn, âm thanh drone huyền bí",
        },
        {
          act: "act_2_escalation",
          startSec: 15,
          endSec: 38,
          targetShotDurationRange: [1.8, 2.6],
          intendedPacing: "Xung đột dâng trào, thoại đối đầu kịch liệt, nhịp trống dồn",
        },
        {
          act: "act_3_climax",
          startSec: 38,
          endSec: 52,
          targetShotDurationRange: [0.8, 1.4],
          intendedPacing: "Rapid Action Montage cực độ, âm trầm sub-drop và braam",
        },
        {
          act: "outro_title_card",
          startSec: 52,
          endSec: 60,
          targetShotDurationRange: [2.5, 4.0],
          intendedPacing: "Cut to black 1s tĩnh lặng, lời thì thầm cuối, bung Title Card",
        },
      ],
    };
  }

  /**
   * Scores and ranks candidate shots for cinematic trailer suitability.
   */
  public static scoreCandidateShot(shot: CandidateShot, desiredAct: TrailerAct): number {
    let score = 0;

    // 1. Episode Tension Score (weight: 0.35)
    score += shot.tensionScore * 0.35;

    // 2. Shot Type Dynamism suited for specific Act (weight: 0.30)
    const typeWeights: Record<TrailerAct, Record<CandidateShot["shotType"], number>> = {
      act_1_hook: {
        establishing: 1.0,
        wide: 0.9,
        medium: 0.6,
        two_shot: 0.5,
        ots_a_b: 0.4,
        ots_b_a: 0.4,
        close_up: 0.7,
        extreme_close_up: 0.6,
      },
      act_2_escalation: {
        two_shot: 0.9,
        ots_a_b: 0.85,
        ots_b_a: 0.85,
        medium: 0.8,
        close_up: 0.95,
        extreme_close_up: 0.75,
        wide: 0.5,
        establishing: 0.3,
      },
      act_3_climax: {
        extreme_close_up: 1.0,
        close_up: 0.95,
        medium: 0.8,
        two_shot: 0.7,
        ots_a_b: 0.7,
        ots_b_a: 0.7,
        wide: 0.6,
        establishing: 0.2,
      },
      outro_title_card: {
        close_up: 1.0,
        extreme_close_up: 0.95,
        establishing: 0.7,
        wide: 0.6,
        medium: 0.5,
        two_shot: 0.4,
        ots_a_b: 0.3,
        ots_b_a: 0.3,
      },
    };

    const typeFactor = typeWeights[desiredAct][shot.shotType] ?? 0.5;
    score += typeFactor * 0.3;

    // 3. Dialogue & Emotional punchline (weight: 0.20)
    if (shot.dialogueSnippet) {
      score += (shot.emotionScore ?? 0.7) * 0.2;
    }

    // 4. Action Density (weight: 0.15)
    if (desiredAct === "act_3_climax") {
      if (shot.actionDensity === "peak") score += 0.15;
      else if (shot.actionDensity === "high") score += 0.12;
      else if (shot.actionDensity === "medium") score += 0.08;
    } else {
      score += 0.1;
    }

    return parseFloat(score.toFixed(3));
  }

  /**
   * Assembles a cohesive sequence of trailer cuts matching the 4-act pacing plan.
   */
  public static selectTrailerCuts(
    candidates: CandidateShot[],
    pacingPlan: TrailerPacingPlan,
    seriesTitle: string = "CHIẾN BINH THỜI GIAN",
    tagline: string = "Số Phận Đã Được Định Đoạt"
  ): TrailerCutItem[] {
    if (candidates.length === 0) {
      throw new Error("Không có cú máy nào để tạo trailer.");
    }

    const cuts: TrailerCutItem[] = [];
    let currentTimelineTime = 0.0;
    let cutIndex = 1;

    for (const actPlan of pacingPlan.actStructure) {
      const actDuration = actPlan.endSec - actPlan.startSec;
      let actRemainingTime = actDuration;

      if (actPlan.act === "outro_title_card") {
        // Outro structure: Dramatic final whisper shot (1.8s) + Silence cut (0.8s) + Title Card (3.0s)
        const finalWhisperCandidates = [...candidates].sort(
          (a, b) => this.scoreCandidateShot(b, "outro_title_card") - this.scoreCandidateShot(a, "outro_title_card")
        );
        const finalShot = finalWhisperCandidates[0] || candidates[0];

        // Shot 1: The Final Whisper Shot
        const whisperDur = 1.8;
        cuts.push({
          cutIndex: cutIndex++,
          act: "outro_title_card",
          shotId: `${finalShot.shotId}_whisper`,
          episodeNumber: finalShot.episodeNumber,
          shotType: finalShot.shotType,
          sourceClipPath: finalShot.clipPath,
          timelineStartSec: parseFloat(currentTimelineTime.toFixed(2)),
          timelineEndSec: parseFloat((currentTimelineTime + whisperDur).toFixed(2)),
          cutDurationSec: whisperDur,
          sourceTrimStartSec: 0.5,
          sourceTrimEndSec: 0.5 + whisperDur,
          dialogue: {
            speaker: finalShot.speakerName || "Nhân vật chính",
            text: finalShot.dialogueSnippet || "Mọi thứ... chỉ mới bắt đầu.",
            startSec: 0.2,
            durationSec: 1.4,
          },
          audioHit: "silence_breath",
          transitionToNext: "dip_to_black",
        });
        currentTimelineTime += whisperDur;

        // Shot 2: Logo Title Card with Trailer Braam / Sting
        const titleDur = Math.max(2.5, actRemainingTime - whisperDur);
        cuts.push({
          cutIndex: cutIndex++,
          act: "outro_title_card",
          shotId: "trailer_title_card",
          episodeNumber: 1,
          shotType: "close_up",
          sourceClipPath: finalShot.clipPath, // Backed by dark cinematic backdrop
          timelineStartSec: parseFloat(currentTimelineTime.toFixed(2)),
          timelineEndSec: parseFloat((currentTimelineTime + titleDur).toFixed(2)),
          cutDurationSec: parseFloat(titleDur.toFixed(2)),
          sourceTrimStartSec: 0,
          sourceTrimEndSec: titleDur,
          dialogue: {
            speaker: "Narrator",
            text: `${seriesTitle.toUpperCase()} - ${tagline}`,
            startSec: 0.4,
            durationSec: 2.2,
          },
          audioHit: "title_sting",
          transitionToNext: "impact_cut",
        });
        currentTimelineTime += titleDur;
        continue;
      }

      // For Act 1, 2, 3: Sort candidate shots for this act
      const scoredPool = candidates
        .map((c) => ({ shot: c, score: this.scoreCandidateShot(c, actPlan.act) }))
        .sort((a, b) => b.score - a.score);

      if (scoredPool.length === 0) {
        log.warn(`[TRAILER AUTO-CUT] Không có cú máy ứng viên cho ${actPlan.act}. Bỏ qua.`);
        continue;
      }

      let poolIdx = 0;
      while (actRemainingTime > 0.6) {
        const candidate = scoredPool[poolIdx % scoredPool.length].shot;
        poolIdx++;

        // Determine cut duration within the act's target range
        const [minDur, maxDur] = actPlan.targetShotDurationRange;
        let cutDur = parseFloat((minDur + Math.random() * (maxDur - minDur)).toFixed(2));
        if (cutDur > actRemainingTime) {
          cutDur = parseFloat(actRemainingTime.toFixed(2));
        }
        if (cutDur < 0.6) {
          // If remainder too small, merge with previous cut or stop
          if (cuts.length > 0) {
            cuts[cuts.length - 1].cutDurationSec += actRemainingTime;
            cuts[cuts.length - 1].timelineEndSec += actRemainingTime;
            currentTimelineTime += actRemainingTime;
          }
          break;
        }

        // Determine audio hit design
        let audioHit: TrailerCutItem["audioHit"] = undefined;
        let transition: TrailerCutItem["transitionToNext"] = "impact_cut";

        if (actPlan.act === "act_1_hook") {
          audioHit = cuts.length === 0 ? "drone_riser" : undefined;
          transition = "quick_crossfade";
        } else if (actPlan.act === "act_2_escalation") {
          audioHit = poolIdx % 2 === 0 ? "tension_hit" : "whoosh_impact";
          transition = "impact_cut";
        } else if (actPlan.act === "act_3_climax") {
          audioHit = poolIdx % 2 === 1 ? "braam_sub_drop" : "whoosh_impact";
          transition = poolIdx % 3 === 0 ? "flash_to_white" : "impact_cut";
        }

        cuts.push({
          cutIndex: cutIndex++,
          act: actPlan.act,
          shotId: candidate.shotId,
          episodeNumber: candidate.episodeNumber,
          shotType: candidate.shotType,
          sourceClipPath: candidate.clipPath,
          timelineStartSec: parseFloat(currentTimelineTime.toFixed(2)),
          timelineEndSec: parseFloat((currentTimelineTime + cutDur).toFixed(2)),
          cutDurationSec: cutDur,
          sourceTrimStartSec: 0.2,
          sourceTrimEndSec: parseFloat((0.2 + cutDur).toFixed(2)),
          dialogue: candidate.dialogueSnippet
            ? {
                speaker: candidate.speakerName || "Nhân vật",
                text: candidate.dialogueSnippet,
                startSec: 0.1,
                durationSec: Math.min(cutDur, 2.0),
              }
            : undefined,
          audioHit,
          transitionToNext: transition,
        });

        currentTimelineTime += cutDur;
        actRemainingTime -= cutDur;
      }

      // The pacing loop intentionally stops before sub-beat fragments. Preserve
      // the requested runtime with a short picture beat instead of truncating the act.
      if (actRemainingTime > 0.005) {
        const tailDuration = parseFloat(actRemainingTime.toFixed(2));
        const tailCandidate = scoredPool[Math.max(0, (poolIdx - 1) % scoredPool.length)].shot;
        const tailStart = parseFloat(currentTimelineTime.toFixed(2));
        const tailShotId = `${tailCandidate.shotId}_tail_${cutIndex}`;
        cuts.push({
          cutIndex: cutIndex++,
          act: actPlan.act,
          shotId: tailShotId,
          episodeNumber: tailCandidate.episodeNumber,
          shotType: tailCandidate.shotType,
          sourceClipPath: tailCandidate.clipPath,
          timelineStartSec: tailStart,
          timelineEndSec: parseFloat((tailStart + tailDuration).toFixed(2)),
          cutDurationSec: tailDuration,
          sourceTrimStartSec: 0,
          sourceTrimEndSec: tailDuration,
          transitionToNext: "impact_cut",
        });
        currentTimelineTime = parseFloat((tailStart + tailDuration).toFixed(2));
      }
    }

    return cuts;
  }

  /**
   * Converts trailer cut items into a fully-qualified UnifiedMasterTimeline.
   */
  public static buildUnifiedTimeline(
    seriesId: string,
    cuts: TrailerCutItem[],
    fps: number = 30
  ): UnifiedTimeline {
    const totalDurationSec = cuts.length > 0 ? cuts[cuts.length - 1].timelineEndSec : 60;
    const targetTotalFrames = Math.round(totalDurationSec * fps);

    let accumulatedFrames = 0;
    const videoTrack: TimelineVideoShot[] = cuts.map((cut, idx) => {
      const startFrame = accumulatedFrames;
      const expectedEndFrame =
        idx === cuts.length - 1
          ? targetTotalFrames
          : Math.round(cut.timelineEndSec * fps);
      const durationFrames = Math.max(1, expectedEndFrame - startFrame);
      const endFrame = startFrame + durationFrames;
      accumulatedFrames = endFrame;

      return {
        shotId: cut.shotId,
        sceneId: `trailer_${cut.act}`,
        approvedClipPath: cut.sourceClipPath,
        startFrame,
        endFrame,
        durationFrames,
        startSec: parseFloat((startFrame / fps).toFixed(3)),
        endSec: parseFloat((endFrame / fps).toFixed(3)),
        durationSec: parseFloat((durationFrames / fps).toFixed(3)),
        shotType: toTimelineShotType(cut.shotType),
        trimStartSec: 0,
        visualPrompt: `Trailer cinematic shot: ${cut.shotId} (${cut.act})`,
      };
    });

    const dialogueTrack: TimelineDialogueCue[] = [];
    const sfxTrack: TimelineSfxCue[] = [];
    const dialogueShotsAdded = new Set<string>();
    const dialogueCuts: TrailerCutItem[] = [];

    cuts.forEach((cut) => {
      // Add dialogue cue if present
      const dialogueKey = cut.dialogue
        ? `${cut.sourceClipPath}\u0000${cut.dialogue.speaker}\u0000${cut.dialogue.text}`
        : "";
      if (cut.dialogue && !dialogueShotsAdded.has(dialogueKey)) {
        dialogueShotsAdded.add(dialogueKey);
        dialogueCuts.push(cut);
        const dStart = cut.timelineStartSec + cut.dialogue.startSec;
        const dEnd = dStart + cut.dialogue.durationSec;
        dialogueTrack.push({
          type: "speech", isOffScreen: false, volume: 1,
          dialogueId: `diag_${cut.shotId}`,
          shotId: cut.shotId,
          characterId: cut.dialogue.speaker.toLowerCase().replace(/\s+/g, "_"),
          speakerName: cut.dialogue.speaker,
          rawText: cut.dialogue.text,
          subtitleText: cut.dialogue.text,
          ttsText: cut.dialogue.text,
          startFrame: Math.round(dStart * fps),
          endFrame: Math.round(dEnd * fps),
          durationFrames: Math.max(1, Math.round(cut.dialogue.durationSec * fps)),
          startSec: parseFloat(dStart.toFixed(2)),
          endSec: parseFloat(dEnd.toFixed(2)),
          durationSec: cut.dialogue.durationSec,
          audioPath: join("data", "audio", "dialogue", `${cut.shotId}.mp3`),
        });
      }

      // Add trailer sound effect hit
      if (cut.audioHit) {
        sfxTrack.push({
          volume: 0.7,
          cueId: `sfx_${cut.audioHit}_${cut.shotId}`,
          shotId: cut.shotId,
          name: cut.audioHit,
          startFrame: Math.round(cut.timelineStartSec * fps),
          durationFrames: Math.round(2.5 * fps),
          startSec: cut.timelineStartSec,
          durationSec: 2.5,
          audioPath: join("assets", "sfx", "trailer", `${cut.audioHit}.mp3`),
        });
      }
    });

    return {
      seriesId,
      episodeNumber: 0, // Trailer convention
      fps,
      sampleRate: 48000,
      targetTotalFrames,
      targetTotalDurationSec: totalDurationSec,
      videoTrack,
      dialogueTrack,
      sfxTrack,
      ambienceTrack: [
        {
          volume: 0.5, fadeInSec: 0, fadeOutSec: 0,
          cueId: "amb_trailer_bed",
          sceneId: "trailer_master",
          name: "Cinematic Drone Bed",
          startFrame: 0,
          durationFrames: targetTotalFrames,
          startSec: 0,
          durationSec: totalDurationSec,
          audioPath: join("assets", "audio", "trailer_sub_drone.mp3"),
        },
      ],
      bgmTrack: {
        audioPath: join("assets", "music", "trailer_hybrid_epic.mp3"),
        startFrame: 0,
        durationFrames: targetTotalFrames,
        startSec: 0,
        durationSec: totalDurationSec,
        baseVolume: 0.95,
        duckedVolume: 0.25,
        duckingWindows: [],
      },
      subtitleTrack: dialogueCuts
        .map((c) => ({
          subtitleId: `sub_${c.shotId}`,
          shotId: c.shotId,
          dialogueId: `diag_${c.shotId}`,
          speakerName: c.dialogue!.speaker,
          displayText: c.dialogue!.text,
          startFrame: Math.round((c.timelineStartSec + c.dialogue!.startSec) * fps),
          endFrame: Math.round((c.timelineStartSec + c.dialogue!.startSec + c.dialogue!.durationSec) * fps),
          startSec: c.timelineStartSec + c.dialogue!.startSec,
          endSec: c.timelineStartSec + c.dialogue!.startSec + c.dialogue!.durationSec,
          durationSec: c.dialogue!.durationSec,
        })),
      stems: {
        dialogue: "trailer_dialogue_stem.wav",
        sfx: "trailer_sfx_stem.wav",
        ambience: "trailer_ambience_stem.wav",
        bgm: "trailer_bgm_stem.wav",
        master: "trailer_master_audio.wav",
      },
      metrics: {
        videoDurationSec: totalDurationSec,
        audioDurationSec: totalDurationSec,
        driftSec: 0,
        driftFrames: 0,
        isWithinTolerance: true,
        toleranceSec: 0.05,
      },
    };
  }

  /**
   * Executes the complete Trailer Auto-Cut pipeline from Season candidates to final delivery.
   */
  public static async generateSeasonTrailer(
    candidates: CandidateShot[],
    options: TrailerGenerationOptions
  ): Promise<TrailerAutoCutResult> {
    if (!options.mockVideo) throw new WorkflowError("TRAILER_RENDER_UNAVAILABLE", "TRAILER_RENDER_UNAVAILABLE: Real trailer assembly is not implemented", "needs_review");
    const { seriesId } = options;
    const seriesTitle = options.seriesTitle || `Series ${seriesId}`;
    const tagline = options.tagline || "Định Mệnh Không Thể Trì Hoãn";
    const targetDurationSec = options.targetDurationSec || 60;
    const outDir = options.outputDir || join("data", "series", seriesId, "trailer_delivery");
    await mkdir(outDir, { recursive: true });

    log.info(`[TRAILER AUTO-CUT] 🎬 Đang tự động cắt Trailer cho Mùa Phim [${seriesTitle}] (${targetDurationSec}s)...`);
    log.info(`  • Tổng số cú máy ứng viên từ toàn bộ Mùa Phim: ${candidates.length}`);

    // 1. Plan 4-Act Pacing and Select Cuts
    const pacingPlan = this.planTrailerPacing(targetDurationSec);
    const cuts = this.selectTrailerCuts(candidates, pacingPlan, seriesTitle, tagline);
    log.info(`  • Đã chọn và biên tập ${cuts.length} cuts cao trào cho 4 Hồi Trailer.`);

    // 2. Build Unified Timeline
    const timeline = this.buildUnifiedTimeline(seriesId, cuts, 30);

    // 3. Export DaVinci Resolve & Premiere Pro FCP7 XML
    const fcp7XmlPath = join(outDir, `trailer_${targetDurationSec}s_fcp7.xml`);
    const xmlContent = generateFcp7Xml({
      timeline,
      sequenceName: `${seriesTitle} - Official ${targetDurationSec}s Trailer`,
      width: 1920,
      height: 1080,
    });
    await writeFile(fcp7XmlPath, xmlContent, "utf8");

    // 4. Export CMX 3600 EDL
    const cmx3600EdlPath = join(outDir, `trailer_${targetDurationSec}s.edl`);
    const edlContent = generateCmx3600Edl({
      timeline,
      sequenceName: `TRAILER_${targetDurationSec}S`,
    });
    await writeFile(cmx3600EdlPath, edlContent, "utf8");

    // 5. Render Video File (Mock or FFmpeg)
    const trailerVideoPath = join(outDir, `trailer_${targetDurationSec}s.mp4`);
    await createValidMockMp4File(trailerVideoPath, timeline.targetTotalDurationSec);

    // 6. Save Trailer Manifest JSON
    const manifestPath = join(outDir, "trailer_manifest.json");
    const result: TrailerAutoCutResult = {
      seriesId,
      isMock: true,
      trailerTitle: `${seriesTitle} - Official Teaser Trailer (${targetDurationSec}s)`,
      totalDurationSec: timeline.targetTotalDurationSec,
      targetDurationSec,
      cutsCount: cuts.length,
      cuts,
      trailerVideoPath,
      fcp7XmlPath,
      cmx3600EdlPath,
      manifestPath,
      timeline,
    };

    await writeFile(manifestPath, JSON.stringify(result, null, 2), "utf8");
    log.info(`[TRAILER AUTO-CUT] ✓ Đã xuất bản Trailer Mùa Phim thành công!`);
    log.info(`  • Video Trailer: ${trailerVideoPath}`);
    log.info(`  • DaVinci XML: ${fcp7XmlPath}`);
    log.info(`  • CMX 3600 EDL: ${cmx3600EdlPath}`);

    return result;
  }

  /**
   * Helper: Extracts candidate shots from completed episode production records.
   */
  public static extractCandidatesFromEpisodes(episodes: any[]): CandidateShot[] {
    const candidates: CandidateShot[] = [];

    for (const ep of episodes) {
      const epNum = ep.episodeNumber;
      const tension = ep.tensionScore ?? 0.5;
      const isClimax = ep.act === "act_3_climax" || ep.act === "midpoint_reversal";

      // Shot 1: Establishing / World setup
      candidates.push({
        shotId: `ep${epNum}_shot_1_est`,
        episodeNumber: epNum,
        episodeTitle: ep.title,
        shotType: "establishing",
        clipPath: ep.masterVideoPath || join("data", "mock_clips", `ep${epNum}_1.mp4`),
        sourceDurationSec: 4.5,
        tensionScore: tension,
        actionDensity: "low",
        dialogueSnippet: epNum === 1 ? "Thế giới này không cho phép kẻ yếu tồn tại." : undefined,
        speakerName: "Minh",
        emotionScore: 0.65,
      });

      // Shot 2: Medium / Two-shot tension
      candidates.push({
        shotId: `ep${epNum}_shot_2_two`,
        episodeNumber: epNum,
        episodeTitle: ep.title,
        shotType: "two_shot",
        clipPath: ep.masterVideoPath || join("data", "mock_clips", `ep${epNum}_2.mp4`),
        sourceDurationSec: 3.5,
        tensionScore: Math.min(1.0, tension + 0.1),
        actionDensity: "medium",
        dialogueSnippet: `Chúng ta chỉ có một cơ hội duy nhất trong Tập ${epNum}!`,
        speakerName: "Lan",
        emotionScore: 0.8,
      });

      // Shot 3: Close-Up High Emotion
      candidates.push({
        shotId: `ep${epNum}_shot_3_cu`,
        episodeNumber: epNum,
        episodeTitle: ep.title,
        shotType: "close_up",
        clipPath: ep.masterVideoPath || join("data", "mock_clips", `ep${epNum}_3.mp4`),
        sourceDurationSec: 2.8,
        tensionScore: Math.min(1.0, tension + 0.15),
        actionDensity: isClimax ? "high" : "medium",
        dialogueSnippet: isClimax ? "Dù phải trả giá bằng cả tính mạng!" : "Hãy tin tôi lần này.",
        speakerName: "Minh",
        emotionScore: 0.95,
      });

      // Shot 4: Extreme Close-Up / Action Climax
      if (isClimax || epNum >= 3) {
        candidates.push({
          shotId: `ep${epNum}_shot_4_action`,
          episodeNumber: epNum,
          episodeTitle: ep.title,
          shotType: "extreme_close_up",
          clipPath: ep.masterVideoPath || join("data", "mock_clips", `ep${epNum}_4.mp4`),
          sourceDurationSec: 2.0,
          tensionScore: 1.0,
          actionDensity: "peak",
          dialogueSnippet: "Tấn công ngay!",
          speakerName: "Minh",
          emotionScore: 1.0,
        });
      }
    }

    return candidates;
  }
}
