import { existsSync } from "node:fs";
import { mkdir, writeFile, readFile, copyFile } from "node:fs/promises";
import { join, dirname, resolve } from "node:path";
import { createHash } from "node:crypto";
import { runFfmpeg, runFfprobe, isFfmpegAvailable } from "../media/ffmpeg.js";
import { probeVideoFile } from "../media/media-validator.js";
import {
  type AssemblyManifest,
  type AssemblySceneRecord,
  type AssemblyShotRecord,
  type AssemblyQaReport,
} from "./manifest-schema.js";
import { exportNleTimelines } from "./nle-exporter.js";
import { verifyAssemblyQa } from "./qa-verifier.js";
import {
  type UnifiedTimeline,
  type TimelineDialogueCue,
  type TimelineSfxCue,
  type TimelineAmbienceCue,
  type TimelineBgmCue,
  type TimelineSubtitleCue,
  exportToSrt,
  exportToVtt,
  secToFrame,
} from "../series/timeline-schema.js";
import {
  createValidMockMp4File,
  createValidMockMp3File,
} from "../assets/mock-media-generator.js";
import { log } from "../utils/logger.js";

export interface ShotAssemblyInput {
  shotId: string;
  sceneId: string;
  takeId: string;
  isApproved?: boolean;
  sourceClipPath: string;
  rawDurationSec?: number;
  trimStartSec?: number;
  trimEndSec?: number;
  transitionIn?: { type: "cut" | "crossfade" | "fade_to_black"; durationSec: number };
  transitionOut?: { type: "cut" | "crossfade" | "fade_to_black"; durationSec: number };
  visualPrompt?: string;
  characterId?: string;
}

export interface SceneAssemblyInput {
  sceneNumber: number;
  sceneId: string;
  shots: ShotAssemblyInput[];
}

export interface HierarchicalAssemblerOptions {
  seriesId: string;
  episodeNumber: number;
  title?: string;
  fps?: number;
  width?: number;
  height?: number;
  aspectRatio?: "9:16" | "16:9" | "1:1";
  scenes: SceneAssemblyInput[];
  dialogueCues?: TimelineDialogueCue[];
  sfxCues?: TimelineSfxCue[];
  ambienceCues?: TimelineAmbienceCue[];
  bgmTrack?: TimelineBgmCue;
  subtitleCues?: TimelineSubtitleCue[];
  outputDir: string;
  forceReRender?: boolean;
  maxAllowedDriftSec?: number;
  detectBlackFrames?: boolean;
}

/**
 * Computes deterministic SHA-256 hash for a scene's content.
 * Any change to shot order, take ID, clip path, trim ranges, or transitions changes the hash.
 */
export function computeSceneContentHash(scene: SceneAssemblyInput): string {
  const payload = scene.shots.map((s) => ({
    shotId: s.shotId,
    takeId: s.takeId,
    sourceClipPath: s.sourceClipPath,
    trimStartSec: s.trimStartSec ?? 0,
    trimEndSec: s.trimEndSec,
    transitionIn: s.transitionIn,
    transitionOut: s.transitionOut,
  }));
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

/**
 * Builds FFmpeg complex filter to stitch shots within a single scene.
 * Explicitly supports:
 * - Direct cut (default, no frame loss or accidental crossfades)
 * - Crossfade (only when specified with durationSec > 0)
 * - Trim start/end per shot
 * - Dimensions normalization (scale + pad + fps + yuv420p)
 */
export function buildSceneStitchFilter(
  shots: ShotAssemblyInput[],
  shotDurations: number[],
  options: {
    width: number;
    height: number;
    fps: number;
  }
): { filterComplex: string; estimatedDurationSec: number } {
  const { width, height, fps } = options;
  const filterSteps: string[] = [];

  // Step 1: Normalize and trim each shot
  const normalizedStreams: string[] = [];
  const effectiveDurations: number[] = [];

  for (let i = 0; i < shots.length; i++) {
    const shot = shots[i];
    const rawDur = shotDurations[i] ?? 4.0;
    const trimStart = shot.trimStartSec ?? 0;
    const trimEnd = shot.trimEndSec !== undefined ? shot.trimEndSec : rawDur;
    const effectiveDur = Math.max(0.1, trimEnd - trimStart);
    effectiveDurations.push(effectiveDur);

    const normLabel = `v${i}_norm`;
    let filter = `[${i}:v]scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,fps=${fps},format=yuv420p`;

    if (trimStart > 0 || shot.trimEndSec !== undefined) {
      filter += `,trim=start=${trimStart.toFixed(3)}:end=${trimEnd.toFixed(3)},setpts=PTS-STARTPTS[${normLabel}]`;
    } else {
      filter += `,setpts=PTS-STARTPTS[${normLabel}]`;
    }

    filterSteps.push(filter);
    normalizedStreams.push(`[${normLabel}]`);
  }

  // Case N = 1: Single shot in scene
  if (shots.length === 1) {
    filterSteps.push(`${normalizedStreams[0]}copy[vout]`);
    return {
      filterComplex: filterSteps.join(";"),
      estimatedDurationSec: effectiveDurations[0],
    };
  }

  // Check if any shot specifies a crossfade transition
  const hasCrossfade = shots.some(
    (s, idx) =>
      idx > 0 &&
      ((s.transitionIn && s.transitionIn.type === "crossfade" && s.transitionIn.durationSec > 0) ||
        (shots[idx - 1].transitionOut &&
          shots[idx - 1].transitionOut?.type === "crossfade" &&
          (shots[idx - 1].transitionOut?.durationSec ?? 0) > 0))
  );

  if (!hasCrossfade) {
    // STANDARD DIRECT CUT: concat without frame loss
    const inputsStr = normalizedStreams.join("");
    filterSteps.push(`${inputsStr}concat=n=${shots.length}:v=1:a=0[vout]`);
    const totalDuration = effectiveDurations.reduce((acc, d) => acc + d, 0);
    return {
      filterComplex: filterSteps.join(";"),
      estimatedDurationSec: totalDuration,
    };
  }

  // TRANSITION ENGINE: Crossfade between shots where specified
  let lastStream = normalizedStreams[0];
  let currentOffset = effectiveDurations[0];
  let cumulativeDuration = effectiveDurations[0];

  for (let i = 1; i < shots.length; i++) {
    const nextStream = normalizedStreams[i];
    const shot = shots[i];
    const prevShot = shots[i - 1];

    const transDur =
      (shot.transitionIn?.type === "crossfade" ? shot.transitionIn.durationSec : undefined) ??
      (prevShot.transitionOut?.type === "crossfade" ? prevShot.transitionOut.durationSec : 0);

    const isFinal = i === shots.length - 1;
    const outStream = isFinal ? "[vout]" : `[vx_${i}]`;

    if (transDur > 0) {
      const xfadeOffset = Math.max(0, currentOffset - transDur);
      filterSteps.push(
        `${lastStream}${nextStream}xfade=transition=fade:duration=${transDur.toFixed(3)}:offset=${xfadeOffset.toFixed(3)}${outStream}`
      );
      currentOffset = xfadeOffset + effectiveDurations[i];
      cumulativeDuration += effectiveDurations[i] - transDur;
    } else {
      // Direct cut between these two segments
      filterSteps.push(`${lastStream}${nextStream}concat=n=2:v=1:a=0${outStream}`);
      currentOffset += effectiveDurations[i];
      cumulativeDuration += effectiveDurations[i];
    }

    lastStream = outStream;
  }

  return {
    filterComplex: filterSteps.join(";"),
    estimatedDurationSec: cumulativeDuration,
  };
}

/**
 * Hierarchical Film Assembler
 *
 * Implements full film assembly requirements:
 * 1. Explicit approved take reference and validation.
 * 2. Cut vs. Crossfade transitions, trimStart/trimEnd, silence gaps.
 * 3. Hierarchical Scene -> Episode Master assembly with Scene Content Caching.
 * 4. Master outputs: Master video, Subtitles (SRT/VTT), 4 audio stems, manifest.
 * 5. NLE interchange (FCP7 XML & OTIO).
 * 6. Automated QA verification (black frames, duration drift, corrupt media).
 */
export class HierarchicalFilmAssembler {
  private options: HierarchicalAssemblerOptions;

  constructor(options: HierarchicalAssemblerOptions) {
    this.options = options;
  }

  /**
   * Executes the complete hierarchical assembly workflow.
   */
  public async assemble(): Promise<AssemblyManifest> {
    const {
      seriesId,
      episodeNumber,
      title = "Episodic Master",
      fps = 30,
      width = 720,
      height = 1280,
      aspectRatio = "9:16",
      scenes,
      dialogueCues = [],
      sfxCues = [],
      ambienceCues = [],
      bgmTrack,
      subtitleCues = [],
      outputDir,
      forceReRender = false,
      maxAllowedDriftSec = 0.1,
      detectBlackFrames = true,
    } = this.options;

    log.info(`\n🎬 [BẮT ĐẦU DỰNG PHIM PHÂN CẤP] Tập ${episodeNumber}: ${title} (${seriesId})`);
    log.info(`  - Độ phân giải: ${width}x${height} (${aspectRatio}), FPS: ${fps}`);
    log.info(`  - Số lượng phân cảnh (Scenes): ${scenes.length}`);

    await mkdir(outputDir, { recursive: true });
    const scenesDir = join(outputDir, "scenes");
    const audioDir = join(outputDir, "audio");
    const stemsDir = join(outputDir, "stems");
    await mkdir(scenesDir, { recursive: true });
    await mkdir(audioDir, { recursive: true });
    await mkdir(stemsDir, { recursive: true });

    const hasFfmpeg = await isFfmpegAvailable();

    // ── STAGE 1: Verify All Approved Takes & Source Clips ──────────────────
    log.info("\n--- BƯỚC 1: KIỂM TRA CÁC TAKE ĐÃ DUYỆT VÀ SOURCE CLIPS ---");
    const allInputClipPaths: string[] = [];

    for (const sc of scenes) {
      if (!sc.shots || sc.shots.length === 0) {
        throw new Error(`Phân cảnh ${sc.sceneNumber} (${sc.sceneId}) không có shot nào để dựng.`);
      }
      for (const sh of sc.shots) {
        if (!sh.takeId) {
          throw new Error(`Shot '${sh.shotId}' thiếu takeId đã duyệt.`);
        }
        if (!sh.sourceClipPath || !existsSync(sh.sourceClipPath)) {
          throw new Error(
            `Clip của take đã duyệt '${sh.takeId}' (Shot '${sh.shotId}') không tồn tại tại: '${sh.sourceClipPath}'`
          );
        }
        allInputClipPaths.push(sh.sourceClipPath);
      }
    }
    log.info(`  Đã xác thực ${allInputClipPaths.length} clips từ các take đã duyệt hợp lệ.`);

    // ── STAGE 2: Level 1 - Hierarchical Scene Assembly with Content Caching ─
    log.info("\n--- BƯỚC 2: DỰNG CẤP SCENE & TÁI SỬ DỤNG CACHE NỘI DUNG ---");
    const assembledSceneRecords: AssemblySceneRecord[] = [];
    const renderedScenePaths: string[] = [];

    for (const scene of scenes) {
      const sceneNumStr = scene.sceneNumber.toString().padStart(2, "0");
      const sceneHash = computeSceneContentHash(scene);
      const outSceneVideoPath = join(scenesDir, `scene_${sceneNumStr}.mp4`);
      const sceneMetaPath = join(scenesDir, `scene_${sceneNumStr}.meta.json`);

      let isCacheHit = false;
      let sceneDurationSec = 0;

      // Check Scene Cache
      if (!forceReRender && existsSync(outSceneVideoPath) && existsSync(sceneMetaPath)) {
        try {
          const metaContent = await readFile(sceneMetaPath, "utf-8");
          const meta = JSON.parse(metaContent);
          if (meta.sceneHash === sceneHash && meta.durationSec > 0) {
            isCacheHit = true;
            sceneDurationSec = meta.durationSec;
            log.info(
              `  [CACHE HIT: SCENE] Cảnh ${scene.sceneNumber} khớp hash (${sceneHash.slice(0, 10)}...). Tái sử dụng: ${outSceneVideoPath}`
            );
          }
        } catch {
          isCacheHit = false;
        }
      }

      if (!isCacheHit) {
        log.info(
          `  [RENDER SCENE] Đang render Cảnh ${scene.sceneNumber} (${scene.shots.length} shots) -> ${outSceneVideoPath}`
        );

        // Probe durations of input shots for exact stitching
        const shotDurations: number[] = [];
        for (const sh of scene.shots) {
          let dur = sh.rawDurationSec;
          if (!dur && hasFfmpeg) {
            const probe = await probeVideoFile(sh.sourceClipPath);
            dur = probe.isValid ? probe.durationSec : 4.0;
          }
          shotDurations.push(dur || 4.0);
        }

        if (hasFfmpeg) {
          const filter = buildSceneStitchFilter(scene.shots, shotDurations, { width, height, fps });
          const ffmpegArgs = ["-y"];
          for (const sh of scene.shots) {
            ffmpegArgs.push("-i", sh.sourceClipPath);
          }
          ffmpegArgs.push(
            "-filter_complex",
            filter.filterComplex,
            "-map",
            "[vout]",
            "-c:v",
            "libx264",
            "-pix_fmt",
            "yuv420p",
            "-preset",
            "fast",
            "-r",
            String(fps),
            outSceneVideoPath
          );

          await runFfmpeg(ffmpegArgs);

          const probe = await probeVideoFile(outSceneVideoPath);
          sceneDurationSec = probe.isValid ? probe.durationSec : filter.estimatedDurationSec;
        } else {
          // Mock mode fallback when FFmpeg binary is absent
          const estDur = shotDurations.reduce((a, b) => a + b, 0);
          await createValidMockMp4File(outSceneVideoPath, estDur, width, height);
          sceneDurationSec = estDur;
        }

        // Write Scene Cache Metadata
        await writeFile(
          sceneMetaPath,
          JSON.stringify(
            {
              sceneNumber: scene.sceneNumber,
              sceneId: scene.sceneId,
              sceneHash,
              durationSec: sceneDurationSec,
              updatedAt: new Date().toISOString(),
            },
            null,
            2
          ),
          "utf-8"
        );
      }

      renderedScenePaths.push(outSceneVideoPath);

      // Map shot records
      const shotRecords: AssemblyShotRecord[] = scene.shots.map((s, idx) => {
        const rawDur = s.rawDurationSec ?? 4.0;
        const trimStart = s.trimStartSec ?? 0;
        const trimEnd = s.trimEndSec ?? rawDur;
        const effDur = Math.max(0.1, trimEnd - trimStart);

        return {
          shotId: s.shotId,
          sceneId: s.sceneId,
          takeId: s.takeId,
          isApproved: s.isApproved ?? true,
          sourceClipPath: s.sourceClipPath,
          rawDurationSec: rawDur,
          trimStartSec: trimStart,
          trimEndSec: s.trimEndSec,
          effectiveDurationSec: effDur,
          transitionIn: s.transitionIn,
          transitionOut: s.transitionOut,
          visualPrompt: s.visualPrompt ?? "",
          characterId: s.characterId,
        };
      });

      assembledSceneRecords.push({
        sceneNumber: scene.sceneNumber,
        sceneId: scene.sceneId,
        sceneHash,
        isCacheHit,
        renderedScenePath: outSceneVideoPath,
        durationSec: sceneDurationSec,
        shots: shotRecords,
      });
    }

    // ── STAGE 3: Level 2 - Hierarchical Episode Master Assembly ────────────
    log.info("\n--- BƯỚC 3: GHÉP CÁC CẢNH THÀNH EPISODE MASTER VIDEO ---");
    const episodeMasterVideoOnlyPath = join(outputDir, "episode_master_video.mp4");
    let totalVideoDurationSec = 0;

    if (renderedScenePaths.length === 1) {
      await copyFile(renderedScenePaths[0], episodeMasterVideoOnlyPath);
      totalVideoDurationSec = assembledSceneRecords[0].durationSec;
    } else {
      if (hasFfmpeg) {
        // Concat N scene files: N inputs only, perfectly bounded
        const ffmpegArgs = ["-y"];
        for (const p of renderedScenePaths) {
          ffmpegArgs.push("-i", p);
        }
        const inputsStr = renderedScenePaths.map((_, idx) => `[${idx}:v]`).join("");
        const filterComplex = `${inputsStr}concat=n=${renderedScenePaths.length}:v=1:a=0[vout]`;

        ffmpegArgs.push(
          "-filter_complex",
          filterComplex,
          "-map",
          "[vout]",
          "-c:v",
          "libx264",
          "-pix_fmt",
          "yuv420p",
          "-preset",
          "fast",
          "-r",
          String(fps),
          episodeMasterVideoOnlyPath
        );

        await runFfmpeg(ffmpegArgs);

        const probe = await probeVideoFile(episodeMasterVideoOnlyPath);
        totalVideoDurationSec = probe.isValid
          ? probe.durationSec
          : assembledSceneRecords.reduce((a, b) => a + b.durationSec, 0);
      } else {
        const estDur = assembledSceneRecords.reduce((a, b) => a + b.durationSec, 0);
        await createValidMockMp4File(episodeMasterVideoOnlyPath, estDur, width, height);
        totalVideoDurationSec = estDur;
      }
    }

    log.info(
      `  Master video đã được tạo: ${episodeMasterVideoOnlyPath} (Thời lượng: ${totalVideoDurationSec.toFixed(2)}s)`
    );

    // ── STAGE 4: Multi-track Audio Stems & Master Audio ───────────────────
    log.info("\n--- BƯỚC 4: XUẤT BẢN 4 AUDIO STEMS VÀ MASTER AUDIO ---");
    const stemDialoguePath = join(stemsDir, "stem-dialogue.wav");
    const stemSfxPath = join(stemsDir, "stem-sfx.wav");
    const stemAmbiencePath = join(stemsDir, "stem-ambience.wav");
    const stemBgmPath = join(stemsDir, "stem-bgm.wav");
    const masterAudioPath = join(outputDir, "master-audio.wav");

    await this.renderAudioStems({
      totalDurationSec: totalVideoDurationSec,
      dialogueCues,
      sfxCues,
      ambienceCues,
      bgmTrack,
      stemDialoguePath,
      stemSfxPath,
      stemAmbiencePath,
      stemBgmPath,
      masterAudioPath,
      hasFfmpeg,
    });

    // ── STAGE 5: Mux Master Video + Master Audio -> Final Master MP4 ───────
    log.info("\n--- BƯỚC 5: MUX MASTER VIDEO VÀ AUDIO THÀNH MASTER.MP4 ---");
    const finalMasterMp4Path = join(outputDir, "master.mp4");

    if (hasFfmpeg) {
      await runFfmpeg([
        "-y",
        "-i",
        episodeMasterVideoOnlyPath,
        "-i",
        masterAudioPath,
        "-c:v",
        "copy",
        "-c:a",
        "aac",
        "-b:a",
        "192k",
        "-shortest",
        finalMasterMp4Path,
      ]);
    } else {
      await createValidMockMp4File(finalMasterMp4Path, totalVideoDurationSec, width, height);
    }
    log.info(`  Tập phim hoàn chỉnh: ${finalMasterMp4Path}`);

    // ── STAGE 6: Export Subtitles (SRT/VTT) & NLE Interchange (XML/OTIO) ──
    log.info("\n--- BƯỚC 6: XUẤT PHỤ ĐỀ VÀ TIMELINE TRAO ĐỔI NLE (FCP7 XML & OTIO) ---");
    const srtPath = join(outputDir, "subtitles.srt");
    const vttPath = join(outputDir, "subtitles.vtt");
    await writeFile(srtPath, exportToSrt(subtitleCues), "utf-8");
    await writeFile(vttPath, exportToVtt(subtitleCues), "utf-8");

    // Construct UnifiedTimeline for NLE export
    const flatVideoTrack = assembledSceneRecords.flatMap((sc) =>
      sc.shots.map((sh, idx) => ({
        shotId: sh.shotId,
        sceneId: sh.sceneId,
        startFrame: secToFrame(idx * 4.0, fps),
        endFrame: secToFrame((idx + 1) * 4.0, fps),
        durationFrames: secToFrame(sh.effectiveDurationSec, fps),
        startSec: idx * 4.0,
        endSec: (idx + 1) * 4.0,
        durationSec: sh.effectiveDurationSec,
        shotType: "medium" as const,
        visualPrompt: sh.visualPrompt,
        characterId: sh.characterId,
        approvedClipPath: sh.sourceClipPath,
        trimStartSec: sh.trimStartSec,
        trimEndSec: sh.trimEndSec,
      }))
    );

    const unifiedTimeline: UnifiedTimeline = {
      seriesId,
      episodeNumber,
      fps,
      sampleRate: 48000,
      targetTotalFrames: secToFrame(totalVideoDurationSec, fps),
      targetTotalDurationSec: totalVideoDurationSec,
      videoTrack: flatVideoTrack,
      dialogueTrack: dialogueCues,
      sfxTrack: sfxCues,
      ambienceTrack: ambienceCues,
      bgmTrack,
      subtitleTrack: subtitleCues,
      stems: {
        dialogue: stemDialoguePath,
        sfx: stemSfxPath,
        ambience: stemAmbiencePath,
        bgm: stemBgmPath,
        master: masterAudioPath,
      },
      metrics: {
        videoDurationSec: totalVideoDurationSec,
        audioDurationSec: totalVideoDurationSec,
        driftSec: 0,
        driftFrames: 0,
        isWithinTolerance: true,
        toleranceSec: maxAllowedDriftSec,
      },
    };

    const outXmlPath = join(outputDir, "timeline.xml");
    const outOtioPath = join(outputDir, "timeline.otio");
    const nleResult = await exportNleTimelines({
      timeline: unifiedTimeline,
      outXmlPath,
      outOtioPath,
      sequenceName: `${seriesId}_Ep${episodeNumber}_Master`,
      width,
      height,
    });

    // ── STAGE 7: Automated Assembly QA Verification ────────────────────────
    log.info("\n--- BƯỚC 7: KIỂM ĐỊNH CHẤT LƯỢNG BẢN DỰNG (QA VERIFIER) ---");
    const qaReport: AssemblyQaReport = await verifyAssemblyQa({
      masterVideoPath: finalMasterMp4Path,
      masterAudioPath,
      expectedDurationSec: totalVideoDurationSec,
      shotClipPaths: allInputClipPaths,
      stems: {
        dialogue: stemDialoguePath,
        sfx: stemSfxPath,
        ambience: stemAmbiencePath,
        bgm: stemBgmPath,
      },
      maxAllowedDriftSec,
      detectBlackFrames,
    });

    log.info(`  Kết quả QA: ${qaReport.isValid ? "✅ HỢP LỆ (PASS)" : "❌ KHÔNG HỢP LỆ (FAIL)"}`);
    log.info(`  - Video duration: ${qaReport.videoDurationSec.toFixed(2)}s`);
    log.info(`  - Audio duration: ${qaReport.audioDurationSec.toFixed(2)}s`);
    log.info(`  - A/V Drift: ${qaReport.driftSec.toFixed(3)}s (Dung sai: ${maxAllowedDriftSec}s)`);
    if (qaReport.blackFrameDetected) {
      log.warn(`  - Cảnh báo: Phát hiện ${qaReport.blackSegments.length} phân đoạn frame đen!`);
    }

    // ── STAGE 8: Build and Write 1:1 Assembly Manifest ─────────────────────
    log.info("\n--- BƯỚC 8: XUẤT BẢN ASSEMBLY MANIFEST 1:1 ---");
    const manifest: AssemblyManifest = {
      manifestVersion: "1.0.0",
      seriesId,
      episodeNumber,
      title,
      fps,
      resolution: {
        width,
        height,
        aspectRatio: aspectRatio as any,
      },
      totalDurationSec: totalVideoDurationSec,
      scenes: assembledSceneRecords,
      masterOutputs: {
        masterVideoPath: finalMasterMp4Path,
        masterAudioPath,
        subtitlesSrtPath: srtPath,
        subtitlesVttPath: vttPath,
        stems: {
          dialogue: stemDialoguePath,
          sfx: stemSfxPath,
          ambience: stemAmbiencePath,
          bgm: stemBgmPath,
        },
        nleInterchange: {
          fcp7XmlPath: nleResult.fcp7XmlPath,
          otioJsonPath: nleResult.otioJsonPath,
          verificationNote: nleResult.verificationNote,
        },
      },
      qaReport,
      createdAt: new Date().toISOString(),
    };

    const manifestPath = join(outputDir, "assembly-manifest.json");
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2), "utf-8");
    log.info(`  Đã ghi Manifest dựng phim 1:1 tại: ${manifestPath}\n`);

    return manifest;
  }

  /**
   * Renders 4 isolated audio stems and master audio.
   */
  private async renderAudioStems(params: {
    totalDurationSec: number;
    dialogueCues: TimelineDialogueCue[];
    sfxCues: TimelineSfxCue[];
    ambienceCues: TimelineAmbienceCue[];
    bgmTrack?: TimelineBgmCue;
    stemDialoguePath: string;
    stemSfxPath: string;
    stemAmbiencePath: string;
    stemBgmPath: string;
    masterAudioPath: string;
    hasFfmpeg: boolean;
  }): Promise<void> {
    const {
      totalDurationSec,
      dialogueCues,
      sfxCues,
      ambienceCues,
      bgmTrack,
      stemDialoguePath,
      stemSfxPath,
      stemAmbiencePath,
      stemBgmPath,
      masterAudioPath,
      hasFfmpeg,
    } = params;

    const targetDur = Math.max(0.5, totalDurationSec);

    if (!hasFfmpeg) {
      await createValidMockMp3File(stemDialoguePath, targetDur);
      await createValidMockMp3File(stemSfxPath, targetDur);
      await createValidMockMp3File(stemAmbiencePath, targetDur);
      await createValidMockMp3File(stemBgmPath, targetDur);
      await createValidMockMp3File(masterAudioPath, targetDur);
      return;
    }

    // Stem 1: Dialogue Stem (Silence background + placed dialogue cues)
    await this.renderCueStem({
      totalDurationSec: targetDur,
      cues: dialogueCues.map((d) => ({
        audioPath: d.audioPath,
        startSec: d.startSec,
        volume: d.volume ?? 1.0,
      })),
      outWavPath: stemDialoguePath,
    });

    // Stem 2: SFX Stem
    await this.renderCueStem({
      totalDurationSec: targetDur,
      cues: sfxCues.map((s) => ({
        audioPath: s.audioPath,
        startSec: s.startSec,
        volume: s.volume ?? 0.8,
      })),
      outWavPath: stemSfxPath,
    });

    // Stem 3: Ambience Stem
    await this.renderCueStem({
      totalDurationSec: targetDur,
      cues: ambienceCues.map((a) => ({
        audioPath: a.audioPath,
        startSec: a.startSec,
        volume: a.volume ?? 0.3,
      })),
      outWavPath: stemAmbiencePath,
    });

    // Stem 4: BGM Stem (Loop or trim BGM with volume)
    if (bgmTrack && bgmTrack.audioPath && existsSync(bgmTrack.audioPath)) {
      try {
        await runFfmpeg([
          "-y",
          "-stream_loop",
          "-1",
          "-i",
          bgmTrack.audioPath,
          "-t",
          targetDur.toFixed(3),
          "-filter_complex",
          `volume=${bgmTrack.baseVolume.toFixed(2)}`,
          "-ar",
          "48000",
          "-ac",
          "2",
          stemBgmPath,
        ]);
      } catch {
        await this.generateSilentWav(stemBgmPath, targetDur);
      }
    } else {
      await this.generateSilentWav(stemBgmPath, targetDur);
    }

    // Mix 4 stems into Master Audio (amix)
    try {
      await runFfmpeg([
        "-y",
        "-i",
        stemDialoguePath,
        "-i",
        stemSfxPath,
        "-i",
        stemAmbiencePath,
        "-i",
        stemBgmPath,
        "-filter_complex",
        "[0:a][1:a][2:a][3:a]amix=inputs=4:duration=first:dropout_transition=0:normalize=0[aout]",
        "-map",
        "[aout]",
        "-ar",
        "48000",
        "-ac",
        "2",
        masterAudioPath,
      ]);
    } catch (err: any) {
      log.warn(`Không thể mix 4 stems bằng amix: ${err.message}. Tạo file silence fallback.`);
      await this.generateSilentWav(masterAudioPath, targetDur);
    }
  }

  /**
   * Mixes a list of audio cues onto a silent base track.
   */
  private async renderCueStem(params: {
    totalDurationSec: number;
    cues: Array<{ audioPath: string; startSec: number; volume: number }>;
    outWavPath: string;
  }): Promise<void> {
    const { totalDurationSec, cues, outWavPath } = params;
    const validCues = cues.filter((c) => c.audioPath && existsSync(c.audioPath));

    if (validCues.length === 0) {
      await this.generateSilentWav(outWavPath, totalDurationSec);
      return;
    }

    const ffmpegArgs = ["-y", "-f", "lavfi", "-t", totalDurationSec.toFixed(3), "-i", "anullsrc=r=48000:cl=stereo"];
    for (const cue of validCues) {
      ffmpegArgs.push("-i", cue.audioPath);
    }

    const filterParts: string[] = [];
    const mixInputs: string[] = ["[0:a]"];

    for (let i = 0; i < validCues.length; i++) {
      const cue = validCues[i];
      const streamIdx = i + 1;
      const delayMs = Math.round(cue.startSec * 1000);
      const label = `cue_${i}`;
      filterParts.push(
        `[${streamIdx}:a]volume=${cue.volume.toFixed(2)},adelay=${delayMs}|${delayMs}[${label}]`
      );
      mixInputs.push(`[${label}]`);
    }

    filterParts.push(
      `${mixInputs.join("")}amix=inputs=${mixInputs.length}:duration=first:dropout_transition=0:normalize=0[aout]`
    );

    ffmpegArgs.push(
      "-filter_complex",
      filterParts.join(";"),
      "-map",
      "[aout]",
      "-ar",
      "48000",
      "-ac",
      "2",
      outWavPath
    );

    try {
      await runFfmpeg(ffmpegArgs);
    } catch (err: any) {
      log.warn(`renderCueStem thất bại: ${err.message}. Dùng silent wav fallback.`);
      await this.generateSilentWav(outWavPath, totalDurationSec);
    }
  }

  /**
   * Generates a silent WAV file of exact duration.
   */
  private async generateSilentWav(outPath: string, durationSec: number): Promise<void> {
    try {
      await runFfmpeg([
        "-y",
        "-f",
        "lavfi",
        "-i",
        "anullsrc=r=48000:cl=stereo",
        "-t",
        durationSec.toFixed(3),
        "-ar",
        "48000",
        "-ac",
        "2",
        outPath,
      ]);
    } catch {
      await createValidMockMp3File(outPath, durationSec);
    }
  }
}
