import {guardFailureStateWrite} from './execution-control.js';
import {assertMediaOwnership} from '../../../platform/processes/media-process-runner.js';
import {WorkflowError,errorCode,failureDisposition,errorMessage} from "../../../platform/workflow-error.js";
import { existsSync } from "node:fs";
import { readFile,rename,unlink } from "node:fs/promises";
import { join } from "node:path";
import { createValidMockMp4File,hasFfmpeg } from "../../media/index.js";
import { type BackendProvider } from "../../../contracts/video.js";
import { atomicCopyFile as copyFile } from "../../../platform/filesystem/atomic-publication.js";
import { runFfmpeg } from "../../media/index.js";
import { probeAudioFile,probeVideoFile } from "../../media/index.js";
import {
buildCrossfadeStitchFilter
} from "../../media/index.js";
import { log } from "../../../platform/observability/logger.js";
import type { EpisodeDependencies } from "../ports/episode-dependencies.js";
import { resolveEffectiveRenderConfig } from "../../media/index.js";
import { type EpisodicScript } from "../../../contracts/episode.js";
export class AssemblyEpisodeUseCase {
constructor(private dependencies:Pick<EpisodeDependencies,"checkpoints"|"bible">){}
public async remuxEpisode(
    outputDirOrOptions:
      | string
      | {
          seriesId: string;
          episodeNumber: number;
          outputDir?: string;
          provider?: BackendProvider;
          skipRender?: boolean;
          transitionDurationSec?: number;
          dryRun?: boolean;
        },
    optionsPositional?: {
      seriesId?: string;
      episodeNumber?: number;
      provider?: BackendProvider;
      skipRender?: boolean;
      transitionDurationSec?: number;
      dryRun?: boolean;
    }
  ): Promise<{ videoPath: string; audioPath: string; episodeNumber?: number }> {
    const ctx=this.dependencies;
    let outputDir: string;
    let seriesId: string | undefined;
    let episodeNumber: number | undefined;
    let provider: BackendProvider | undefined = undefined;
    let skipRender = false;
    let explicitTransitionSec: number | undefined = undefined;
    let dryRun = false;

    if (typeof outputDirOrOptions === "string") {
      outputDir = outputDirOrOptions;
      seriesId = optionsPositional?.seriesId;
      episodeNumber = optionsPositional?.episodeNumber;
      provider = optionsPositional?.provider;
      skipRender = Boolean(optionsPositional?.skipRender);
      explicitTransitionSec = optionsPositional?.transitionDurationSec;
      dryRun = Boolean(optionsPositional?.dryRun);
    } else {
      seriesId = outputDirOrOptions.seriesId;
      episodeNumber = outputDirOrOptions.episodeNumber;
      const epNumStr = String(episodeNumber).padStart(2, "0");
      outputDir =
        outputDirOrOptions.outputDir ||
        join("output", "series", seriesId, `ep-${epNumStr}`);
      provider = outputDirOrOptions.provider;
      skipRender = Boolean(outputDirOrOptions.skipRender);
      explicitTransitionSec = outputDirOrOptions.transitionDurationSec;
      dryRun = Boolean(outputDirOrOptions.dryRun);
    }

    const scriptPath = join(outputDir, "script-normalized.json");
    if (!existsSync(scriptPath)) {
      throw new Error(`Không tìm thấy kịch bản chuẩn hóa tại: ${scriptPath}`);
    }

    const script: EpisodicScript = JSON.parse(await readFile(scriptPath, "utf8"));
    seriesId = seriesId || script.seriesId;
    episodeNumber = episodeNumber || script.episodeNumber;
    const job = await ctx.checkpoints.load(outputDir);
    provider = provider || (job?.isMock ? "mock" : undefined) || (job?.shotProgress?.[0]?.provider as BackendProvider | undefined);

    const seriesMeta = seriesId ? ctx.bible.getSeriesMetadata(seriesId) : undefined;
    // Scope C: Preserve timeline transition duration as single source of truth
    const effectiveRemuxConfig = resolveEffectiveRenderConfig(
      explicitTransitionSec !== undefined ? { transitionDurationSec: explicitTransitionSec } : undefined,
      job ?? undefined,
      seriesMeta ? { aspect_ratio: seriesMeta.aspect_ratio, fps: seriesMeta.fps } : undefined,
      {
        aspectRatio: script.aspectRatio,
        fps: script.fps,
      }
    );
    let transitionDurationSec: number = effectiveRemuxConfig.transitionDurationSec;
    if (!job) {
      const timelinePath = join(outputDir, "timeline.json");
      if (existsSync(timelinePath)) {
        try {
          const tl = JSON.parse(await readFile(timelinePath, "utf8"));
          if (typeof tl.transitionDurationSec === "number") {
            transitionDurationSec = tl.transitionDurationSec;
          }
        } catch (error) { log.warn("[assembly-episode-use-case] Non-fatal operation failed: "+errorMessage(error)); }
      }
    }

    const shotVideos: string[] = [];
    for (const scene of script.scenes) {
      for (const shot of scene.shots) {
        let videoPath: string | undefined = undefined;

        // 1. Prioritize director-approved take from Story Bible
        const approved = ctx.bible.getApprovedTakeForShot(
          seriesId,
          episodeNumber,
          shot.shotId
        );
        const checkpointShot = job?.shots?.[shot.shotId];
        if (approved?.local_path && existsSync(approved.local_path)) {
          videoPath = approved.local_path;
        } else if (checkpointShot?.videoPath && existsSync(checkpointShot.videoPath)) {
          // 2. Fallback to cached checkpoint video path
          videoPath = checkpointShot.videoPath;
        } else {
          // 3. Fallback to default shot filename
          const fallbackPath = join(outputDir, "shots", `${shot.shotId}.mp4`);
          if (existsSync(fallbackPath)) {
            videoPath = fallbackPath;
          }
        }

        if (!videoPath || !existsSync(videoPath)) {
          throw new Error(
            `Không thể remux: Thiếu video cho shot [${shot.shotId}]. Vui lòng sinh shot này trước.`
          );
        }
        shotVideos.push(videoPath);
      }
    }

    const audioPath =
      job?.audioPath && existsSync(job.audioPath)
        ? job.audioPath
        : join(outputDir, "audio", "master-soundtrack.mp3");

    const finalVideoPath = join(outputDir, "video.mp4");
    log.info(`\n=== REMUX TẬP ${episodeNumber}: Ghép ${shotVideos.length} shots với soundtrack ===`);

    if (skipRender) {
      log.info("  [SKIP RENDER] Bỏ qua bước render/remux video theo yêu cầu (--skip-render).");
      if (job) {
        job.status = "unrendered";
        job.currentPhase = "render_skipped";
        job.isRendered = false;
        job.updatedAt = new Date().toISOString();
        await ctx.checkpoints.save(outputDir, job);
      }
      return { videoPath: existsSync(finalVideoPath) ? finalVideoPath : "", audioPath, episodeNumber };
    }

    let targetRemuxDuration = 15.0;
    if (existsSync(audioPath)) {
      const aProbe = await probeAudioFile(audioPath);
      if (aProbe.isValid && aProbe.durationSec > 0) {
        targetRemuxDuration = aProbe.durationSec;
      }
    } else {
      const timelinePath = join(outputDir, "timeline.json");
      if (existsSync(timelinePath)) {
        try {
          const tl = JSON.parse(await readFile(timelinePath, "utf8"));
          const vShots = tl.shots || tl.videoTrack || [];
          if (vShots.length > 0) {
            targetRemuxDuration = vShots.reduce(
              (sum: number, s: any) => sum + (s.durationSec || 0),
              0
            );
          }
        } catch (error) { log.warn("[assembly-episode-use-case] Non-fatal operation failed: "+errorMessage(error)); }
      }
    }

    if (shotVideos.length > 0) {
      for (const v of shotVideos) {
        const vProbe = await probeVideoFile(v);
        if (!vProbe.isValid) {
          throw new Error(`Video shot [${v}] bị hỏng hoặc không hợp lệ: ${vProbe.error}`);
        }
      }

      const tempRemuxPath = join(outputDir, `.tmp_remux_${Date.now()}_${Math.random().toString(36).slice(2, 7)}.mp4`);
      try {
        const ffmpegAvailable = await hasFfmpeg();
        if (ffmpegAvailable) {
          if (shotVideos.length === 1) {
            // Single-shot scene: direct mux without filter_complex, no -shortest
            const singleShot = shotVideos[0];
            const ffmpegArgs = ["-y", "-i", singleShot];
            if (existsSync(audioPath)) {
              ffmpegArgs.push(
                "-i", audioPath,
                "-c:v", "libx264", "-pix_fmt", "yuv420p",
                "-c:a", "aac", "-b:a", "192k",
                tempRemuxPath
              );
            } else {
              ffmpegArgs.push("-c:v", "libx264", "-pix_fmt", "yuv420p", tempRemuxPath);
            }
            await runFfmpeg(ffmpegArgs);
          } else {
            // Multi-shot scene: unified transition duration, no -shortest
            const transitionSec = transitionDurationSec;
            const durations = script.scenes.flatMap((s) => s.shots.map((sh) => sh.durationSec));
            const stitch = buildCrossfadeStitchFilter(shotVideos, durations, {
              crossfadeSec: transitionSec,
              fps: effectiveRemuxConfig.fps || script.fps || 30,
              aspectRatio: (effectiveRemuxConfig.aspectRatio || script.aspectRatio || "9:16") as any,
            });
            const ffmpegArgs = ["-y"];
            for (const v of shotVideos) {
              ffmpegArgs.push("-i", v);
            }
            if (existsSync(audioPath)) {
              ffmpegArgs.push("-i", audioPath);
              ffmpegArgs.push("-filter_complex", stitch.filterComplex);
              ffmpegArgs.push("-map", "[vout]", "-map", `${shotVideos.length}:a`);
              ffmpegArgs.push("-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k");
              ffmpegArgs.push(tempRemuxPath);
            } else {
              ffmpegArgs.push("-filter_complex", stitch.filterComplex);
              ffmpegArgs.push("-map", "[vout]");
              ffmpegArgs.push("-c:v", "libx264", "-pix_fmt", "yuv420p");
              ffmpegArgs.push(tempRemuxPath);
            }
            await runFfmpeg(ffmpegArgs);
          }
        } else if (provider === "mock" || dryRun) {
          await createValidMockMp4File(tempRemuxPath, targetRemuxDuration);
        } else {
          throw new Error(`Không tìm thấy công cụ FFmpeg trên hệ thống để thực hiện remux production.`);
        }

        const probe = await probeVideoFile(tempRemuxPath);
        if (!probe.isValid) {
          throw new Error(`Video sau khi remux không hợp lệ (ffprobe: ${probe.error})`);
        }
        if (targetRemuxDuration > 0 && probe.durationSec < targetRemuxDuration - 0.5) {
          throw new Error(
            `Thời lượng video remux (${probe.durationSec}s) ngắn hơn kỳ vọng (${targetRemuxDuration}s)`
          );
        }
        if (existsSync(audioPath) && ffmpegAvailable) {
          const aProbe = await probeAudioFile(tempRemuxPath);
          if (!aProbe.isValid) {
            throw new Error(`Audio trong video remux không hợp lệ (ffprobe: ${aProbe.error})`);
          }
        }

        // Atomic replace of finalVideoPath
        try {
          await rename(tempRemuxPath, finalVideoPath);
        } catch {
          await copyFile(tempRemuxPath, finalVideoPath);
          await unlink(tempRemuxPath).catch(() => {});
        }
      } catch (remuxErr: unknown) {
        if (existsSync(tempRemuxPath)) {
          await unlink(tempRemuxPath).catch(() => {});
        }
        guardFailureStateWrite({},remuxErr);
        assertMediaOwnership();
        log.error(`[REMUX ERROR] Ghép tập ${episodeNumber} thất bại: ${errorMessage(remuxErr)}`);
        throw new WorkflowError(errorCode(remuxErr)??'REMUX_FAILED',`[REMUX ERROR] Ghép tập ${episodeNumber} thất bại: ${errorMessage(remuxErr)}`,failureDisposition(remuxErr),{cause:remuxErr});
      }
    } else if (dryRun) {
      await createValidMockMp4File(finalVideoPath, targetRemuxDuration);
    } else {
      throw new Error(`[REMUX ERROR] Không có video shot nào để remux cho tập ${episodeNumber}`);
    }

    if (job) {
      job.videoPath = finalVideoPath;
      job.isRendered = true;
      job.updatedAt = new Date().toISOString();
      await ctx.checkpoints.save(outputDir, job);
    }

    log.info(`✅ Remux hoàn tất: ${finalVideoPath}`);
    return { videoPath: finalVideoPath, audioPath, episodeNumber };
  }
}
