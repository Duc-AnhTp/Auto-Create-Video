import {checkExecution,guardFailureStateWrite} from './execution-control.js';
import {WorkflowError,errorCode,failureDisposition} from '../../../platform/workflow-error.js';
import {errorMessage} from "../../../platform/workflow-error.js";

import { existsSync } from "node:fs";
import { unlink } from "node:fs/promises";
import { join } from "node:path";
import { type SceneAssemblyInput } from "../../media/index.js";
import { createValidMockMp4File, hasFfmpeg } from "../../media/index.js";

import { renderFingerprint } from "../../media/index.js";
import { hashFile } from "../../media/index.js";
import { atomicCopyFile as copyFile } from "../../../platform/filesystem/atomic-publication.js";
import { resolveVideoDimensions } from "../../media/index.js";
import { runFfmpeg } from "../../media/index.js";
import { assertMediaOwnership, publishMediaRename } from "../../../platform/processes/media-process-runner.js";
import { probeAudioFile, probeVideoFile } from "../../media/index.js";

import { buildCrossfadeStitchFilter } from "../../media/index.js";

import { log } from "../../../platform/observability/logger.js";

import { CoverageLedgerManager } from "../../story/index.js";

import type { EpisodeDependencies } from "../ports/episode-dependencies.js";

import { type EpisodeOptions, type QaEvaluationStatus } from "../ports/episode-options.js";

import type { AssembleProductionInput, AssemblyResult } from "./phases/contracts.js";
export class AssembleProduction {
constructor(private dependencies:Pick<EpisodeDependencies,"media"|"checkpoints"|"bible">){}
async execute(input:AssembleProductionInput,options:EpisodeOptions):Promise<AssemblyResult> {
const ctx=this.dependencies;
let script = structuredClone(input.script);
let job = structuredClone(input.job);
let provider = input.provider;
let seriesId = input.seriesId;
let outputDir = input.outputDir;
let videoShotsDir = input.videoShotsDir;
let shotVideos = [...input.shotVideos];
let visualDurations = new Map(input.visualDurations);
let effectiveConfig = input.effectiveConfig;
let audioPath = input.audioPath;
let audioRes = input.audioRes;
let audioDurationSec = input.audioDurationSec;
let pacingReport = input.pacingReport;
let auditPassed = input.auditPassed;
let beatCoverageStatus:QaEvaluationStatus="NOT_APPLICABLE";
let beatCoveragePassed=true;
let missingMandatoryBeatIds:string[]=[];
log.step(6, 8, "Hậu kỳ: Ghép shot xfade & mux soundtrack tổng thể");
    await checkExecution(options);
    options.onProgress?.(6, 8, "Hậu kỳ: Ghép shot xfade & mux soundtrack tổng thể");
    const finalVideoPath = join(outputDir, "video.mp4");

    if (options.skipRender) {
      log.info("  [SKIP RENDER] Bỏ qua bước render video theo yêu cầu (--skip-render).");
      job.status = "unrendered";
      job.currentPhase = "render_skipped";
      job.isRendered = false;
      await ctx.checkpoints.save(outputDir, job);

      return {kind:"skipped" as const,result:{
        episodeNumber: script.episodeNumber,
        title: script.title,
        script,
        videoPath: "",
        audioPath: audioPath || "",
        outputDir,
        auditPassed,
        isMock: provider === "mock",
        committedCanon: false,
      }};
    }

    job.currentPhase = "timeline_assembly";
    await ctx.checkpoints.save(outputDir, job);

    // Collect approved takes for all shots in sequence (Take ID -> File -> QA -> Approval -> Assembly)
    shotVideos.length = 0;
    const shotVideoEntries: Array<{ shot: typeof script.scenes[0]["shots"][0]; videoPath: string }> = [];
    const unapprovedShots: Array<{ shotId: string; reason?: string }> = [];

    for (const scene of script.scenes) {
      for (const shot of scene.shots) {
        const approved = ctx.bible.getApprovedTakeForShot(seriesId, script.episodeNumber, shot.shotId);
        if (!approved || provider!=="mock"&&approved.provider==="mock") {
          unapprovedShots.push({ shotId: shot.shotId, reason: "Chưa có take được phê duyệt" });
        }
        const vPath = (provider!=="mock"&&approved?.provider==="mock"?undefined:approved?.local_path) || (provider === "mock" ? job.shots[shot.shotId]?.videoPath : undefined);
        if (vPath && existsSync(vPath)) {
          shotVideos.push(vPath);
          shotVideoEntries.push({ shot, videoPath: vPath });
        } else if (approved) {
          unapprovedShots.push({ shotId: shot.shotId, reason: `File take đã duyệt không tồn tại trên đĩa: ${vPath}` });
        } else if (provider === "mock") {
          const fallbackPath = join(videoShotsDir, `${shot.shotId}.mp4`);
          if (existsSync(fallbackPath)) {
            shotVideos.push(fallbackPath);
            shotVideoEntries.push({ shot, videoPath: fallbackPath });
          }
        }
      }
    }

    const retimedShots=script.scenes.flatMap(scene=>scene.shots).filter(shot=>shot.durationSec>(visualDurations.get(shot.shotId)??shot.durationSec)+1/(effectiveConfig.fps||30));
    if(provider!=="mock"&&retimedShots.length) unapprovedShots.push(...retimedShots.map(shot=>({shotId:shot.shotId,reason:"DIALOGUE_RETIMING_REVIEW_REQUIRED: approve delivery timing before assembly"})));
    const deliveryCache=ctx.media.createCache(join(outputDir,"episode-delivery-cache.json"));
    const deliveryFingerprint=renderFingerprint({clips:await Promise.all(shotVideos.map(hashFile)),audio:audioPath&&existsSync(audioPath)?await hashFile(audioPath):null,script,config:effectiveConfig,hierarchical:options.useHierarchicalAssembly??false});
    const deliveryHit=options.resume===true&&await deliveryCache.hit(deliveryFingerprint);
    if (provider !== "mock") {
      if (unapprovedShots.length > 0) {
        throw new WorkflowError("TAKE_APPROVAL_REQUIRED",
          `[PRODUCTION GATEWAY ERROR] Cấm dựng master video: Còn ${unapprovedShots.length} shot chưa có take hợp lệ (${unapprovedShots.map((s) => `${s.shotId}${s.reason ? `: ${s.reason}` : ""}`).join("; ")}).`, "needs_review"
        );
      }
      if (shotVideos.length === 0) {
        throw new Error("[PRODUCTION ERROR] Không có video shot nào được kết xuất thành công.");
      }

      // Verify mandatory beat coverage in Story Bible if a series plan exists
      missingMandatoryBeatIds = [];
      try {
        const activePlan = ctx.bible.getActiveSeriesPlan(seriesId);
        if (activePlan) {
          const beatAudit = CoverageLedgerManager.verifyBeatCoverageInAssembly(
            ctx.bible,
            seriesId,
            activePlan.id,
            script.episodeNumber
          );
          if (!beatAudit.isValid) {
            beatCoverageStatus = "FAIL";
            beatCoveragePassed = false;
            missingMandatoryBeatIds = beatAudit.missingBeatIds;
            for (const w of beatAudit.warnings) {
              log.warn(`⚠️ [BEAT TRACEABILITY WARNING] ${w}`);
            }
          } else {
            beatCoverageStatus = "PASS";
            beatCoveragePassed = true;
          }
        } else {
          beatCoverageStatus = "NOT_APPLICABLE";
          beatCoveragePassed = true;
        }
      } catch (err: unknown) {
        beatCoverageStatus = "ERROR";
        beatCoveragePassed = false;
        log.error(`[BEAT AUDIT ERROR] Could not verify beat coverage (Fail-Closed): ${errorMessage(err)}`);
      }

      if(!deliveryHit){
      const tempFinalVideoPath = `${finalVideoPath}.tmp.mp4`;
      try {
        if (options.useHierarchicalAssembly) {
          log.info("  🏗️ [HIERARCHICAL ASSEMBLY] Ghép phim phân cấp theo Scene Content Caching...");
          const scenesInput: SceneAssemblyInput[] = script.scenes.map((sc, scIdx) => ({
            sceneNumber: sc.sceneNumber ?? (scIdx + 1),
            sceneId: sc.sceneId || `scene_${scIdx + 1}`,
            shots: sc.shots.map((sh) => {
              const approved = ctx.bible.getApprovedTakeForShot(seriesId, script.episodeNumber, sh.shotId);
              const vPath = approved?.local_path || "";
              return {
                shotId: sh.shotId,
                sceneId: sc.sceneId || `scene_${scIdx + 1}`,
                takeId: approved?.id || `take_${sh.shotId}`,
                sourceClipPath: vPath,
                rawDurationSec: sh.durationSec,
                trimStartSec: 0,
                isApproved: Boolean(approved ? approved.is_approved : false),
              };
            }),
          }));

          const effectiveAspect = effectiveConfig.aspectRatio || script.aspectRatio || "9:16";
          const dims = resolveVideoDimensions(effectiveAspect, options.exportResolution);

          const hierarchicalAssembler = ctx.media.createFilmAssembler({
            seriesId,
            episodeNumber: script.episodeNumber,
            title: script.title,
            fps: effectiveConfig.fps || script.fps || 30,
            aspectRatio: dims.aspectRatio as any,
            width: dims.width,
            height: dims.height,
            scenes: scenesInput,
            outputDir: join(outputDir, "assembly"),
            requireApprovedShots: true,
            allowMockMedia: Boolean(options.allowMockMedia),
            enableColorMatch: (effectiveConfig as any).enableColorMatch ?? true,
            dialogueCues: audioRes?.unifiedTimeline?.dialogueTrack || [],
            sfxCues: audioRes?.unifiedTimeline?.sfxTrack || [],
            ambienceCues: audioRes?.unifiedTimeline?.ambienceTrack || [],
            bgmTrack: audioRes?.unifiedTimeline?.bgmTrack,
            subtitleCues: audioRes?.unifiedTimeline?.subtitleTrack || [],
            pacingReport: pacingReport
              ? {
                  overallAverageShotDurationSec: pacingReport.overallAverageShotDurationSec,
                  overallCutsPerMinute: pacingReport.overallCutsPerMinute,
                  pacingDynamismScore: pacingReport.pacingDynamismScore,
                  warnings: pacingReport.warnings,
                }
              : undefined,
          });

          const manifest = await hierarchicalAssembler.assemble();
          if (manifest.masterOutputs.masterVideoPath && existsSync(manifest.masterOutputs.masterVideoPath)) {
            const hasMasteredAudioMix =
              Boolean(manifest.masterOutputs.masterAudioPath && existsSync(manifest.masterOutputs.masterAudioPath));
            if (hasMasteredAudioMix) {
              // Master video output already includes the loudness-mastered 4-track stem mix; preserve it
              await copyFile(manifest.masterOutputs.masterVideoPath, tempFinalVideoPath);
            } else if (audioPath && existsSync(audioPath)) {
              if (await hasFfmpeg()) {
                await runFfmpeg([
                  "-y",
                  "-i",
                  manifest.masterOutputs.masterVideoPath,
                  "-i",
                  audioPath,
                  "-map",
                  "0:v:0",
                  "-map",
                  "1:a:0",
                  "-c:v",
                  "copy",
                  "-c:a",
                  "aac",
                  "-b:a",
                  "192k",
                  tempFinalVideoPath,
                ]);
              } else {
                await copyFile(manifest.masterOutputs.masterVideoPath, tempFinalVideoPath);
              }
            } else {
              await copyFile(manifest.masterOutputs.masterVideoPath, tempFinalVideoPath);
            }
          }
        } else if (shotVideos.length === 1) {
          // Single-shot scene: direct mux, no -shortest used
          const singleShot = shotVideos[0];
          if (await hasFfmpeg()) {
            const ffmpegArgs = ["-y", "-i", singleShot];
            const visualDuration=(await probeVideoFile(singleShot)).durationSec;
            const targetDuration=shotVideoEntries[0].shot.durationSec;
            if(targetDuration>visualDuration+1/(effectiveConfig.fps||30))ffmpegArgs.push("-vf",`tpad=stop_mode=clone:stop_duration=${targetDuration-visualDuration}`);
            if (audioPath && existsSync(audioPath)) {
              ffmpegArgs.push(
                "-i", audioPath,
                "-c:v", "libx264", "-pix_fmt", "yuv420p",
                "-c:a", "aac", "-b:a", "192k",
                tempFinalVideoPath
              );
            } else {
              ffmpegArgs.push("-c:v", "libx264", "-pix_fmt", "yuv420p", tempFinalVideoPath);
            }
            await runFfmpeg(ffmpegArgs);
          } else {
            await copyFile(singleShot, tempFinalVideoPath);
          }
        } else if (shotVideos.length > 1) {
          // Multi-shot scene: crossfade stitch filter with explicit transition duration
          if (await hasFfmpeg()) {
            const transitionSec = effectiveConfig.transitionDurationSec;
            const durations = shotVideoEntries.map((e) => e.shot.durationSec);
            const stitch = buildCrossfadeStitchFilter(shotVideos, durations, {
              crossfadeSec: transitionSec,
              targetDurationSec: audioDurationSec > 0 ? audioDurationSec : undefined,
              fps: effectiveConfig.fps || script.fps || 30,
              aspectRatio: (effectiveConfig.aspectRatio || script.aspectRatio || "9:16") as any,
            });
            const ffmpegArgs = ["-y"];
            for (const v of shotVideos) {
              ffmpegArgs.push("-i", v);
            }
            if (audioPath && existsSync(audioPath)) {
              ffmpegArgs.push("-i", audioPath);
              ffmpegArgs.push("-filter_complex", stitch.filterComplex);
              ffmpegArgs.push("-map", "[vout]", "-map", `${shotVideos.length}:a`);
              ffmpegArgs.push("-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k");
              ffmpegArgs.push(tempFinalVideoPath);
            } else {
              ffmpegArgs.push("-filter_complex", stitch.filterComplex);
              ffmpegArgs.push("-map", "[vout]");
              ffmpegArgs.push("-c:v", "libx264", "-pix_fmt", "yuv420p");
              ffmpegArgs.push(tempFinalVideoPath);
            }
            await runFfmpeg(ffmpegArgs);
          } else {
            await copyFile(shotVideos[0], tempFinalVideoPath);
          }
        } else {
          throw new Error("[PRODUCTION ERROR] Không có video shot hợp lệ nào để ghép nối.");
        }

        // Validate final assembled video with ffprobe and check elementary stream drift
        const probe = await probeVideoFile(tempFinalVideoPath);
        if (!probe.isValid) {
          throw new Error(`Video sau khi ghép không hợp lệ (ffprobe: ${probe.error})`);
        }

        // Check elementary stream drift without masking via -shortest (Requirement D.6, D.8, D.9)
        if (audioPath && existsSync(audioPath)) {
          const videoElementaryDur = probe.videoStream?.durationSec ?? probe.durationSec;
          const audioElementaryDur = probe.audioStream?.durationSec ?? audioDurationSec;
          const fps = effectiveConfig.fps || script.fps || 30;
          const frameTolSec = 1.0 / fps;
          const codecTolSec = 0.05; // ~50ms AAC/MP3 priming
          const maxTolSec = frameTolSec + codecTolSec;
          const drift = Math.abs(videoElementaryDur - audioElementaryDur);

          if (drift > maxTolSec) {
            const warnMsg = `[TIMELINE DRIFT] Phát hiện sai lệch elementary stream hình-tiếng: VideoStream=${videoElementaryDur.toFixed(3)}s, AudioStream=${audioElementaryDur.toFixed(3)}s (chênh lệch ${drift.toFixed(3)}s > dung sai ${maxTolSec.toFixed(3)}s).`;
            log.warn(warnMsg);
          } else {
            log.info(`  [TIMELINE SYNC] Độ chênh lệch hình-tiếng trong ngưỡng cho phép: ${(drift * 1000).toFixed(1)}ms (dung sai ${(maxTolSec * 1000).toFixed(1)}ms).`);
          }
          log.info("  [TIMELINE NOTE] Đã neo mốc thời gian audio đúng khung hình cú máy (Lưu ý: đây là timecode sync, không phải lip-sync khẩu hình).");
        }

        // Atomic replace of final video
        assertMediaOwnership();publishMediaRename(tempFinalVideoPath, finalVideoPath);
      } catch (assembleErr: unknown) {
        if (existsSync(tempFinalVideoPath)) {
          await unlink(tempFinalVideoPath).catch(() => {});
        }
        guardFailureStateWrite(options,assembleErr);
        // PRODUCTION ERROR: Do not swallow, do not replace with mock file!
        job.status = "failed";
        job.currentPhase = "failed";
        await ctx.checkpoints.save(outputDir, job);
        throw new WorkflowError(errorCode(assembleErr)??'ASSEMBLY_FAILED',`[PRODUCTION ERROR] Ghép nối và xuất xưởng video thất bại: ${errorMessage(assembleErr)}`,failureDisposition(assembleErr),{cause:assembleErr});
      }
      }
    } else if(!deliveryHit) {
      const effectiveAspect = effectiveConfig.aspectRatio || script.aspectRatio || "9:16";
      const dims = resolveVideoDimensions(effectiveAspect, options.exportResolution);
      if (options.useHierarchicalAssembly) {
        log.info("  🏗️ [HIERARCHICAL ASSEMBLY] Ghép phim phân cấp mô phỏng...");
        const scenesInput: SceneAssemblyInput[] = script.scenes.map((sc, scIdx) => ({
          sceneNumber: sc.sceneNumber ?? (scIdx + 1),
          sceneId: sc.sceneId || `scene_${scIdx + 1}`,
          shots: sc.shots.map((sh) => {
            const vPath = join(videoShotsDir, `${sh.shotId}.mp4`);
            return {
              shotId: sh.shotId,
              sceneId: sc.sceneId || `scene_${scIdx + 1}`,
              takeId: `take_${sh.shotId}_mock`,
              sourceClipPath: vPath,
              rawDurationSec: sh.durationSec,
              trimStartSec: 0,
              isApproved: true,
            };
          }),
        }));

        const hierarchicalAssembler = ctx.media.createFilmAssembler({
          seriesId,
          episodeNumber: script.episodeNumber,
          title: script.title,
          fps: effectiveConfig.fps || script.fps || 30,
          aspectRatio: dims.aspectRatio as any,
          width: dims.width,
          height: dims.height,
          scenes: scenesInput,
          outputDir: join(outputDir, "assembly"),
          allowMockMedia: provider === "mock" || Boolean(options.allowMockMedia),
          enableColorMatch: (effectiveConfig as any).enableColorMatch ?? true,
          dialogueCues: audioRes?.unifiedTimeline?.dialogueTrack || [],
          sfxCues: audioRes?.unifiedTimeline?.sfxTrack || [],
          ambienceCues: audioRes?.unifiedTimeline?.ambienceTrack || [],
          bgmTrack: audioRes?.unifiedTimeline?.bgmTrack,
          subtitleCues: audioRes?.unifiedTimeline?.subtitleTrack || [],
          pacingReport: pacingReport
            ? {
                overallAverageShotDurationSec: pacingReport.overallAverageShotDurationSec,
                overallCutsPerMinute: pacingReport.overallCutsPerMinute,
                pacingDynamismScore: pacingReport.pacingDynamismScore,
                warnings: pacingReport.warnings,
              }
            : undefined,
        });

        const manifest = await hierarchicalAssembler.assemble();
        if (manifest.masterOutputs.masterVideoPath && existsSync(manifest.masterOutputs.masterVideoPath)) {
          await copyFile(manifest.masterOutputs.masterVideoPath, finalVideoPath);
        } else {
          await createValidMockMp4File(finalVideoPath, audioDurationSec || 15.0, dims.width, dims.height, audioPath && existsSync(audioPath) ? audioPath : undefined);
        }
      } else {
        if (audioPath && existsSync(audioPath)) {
          const aProbe = await probeAudioFile(audioPath);
          if (aProbe.isValid && aProbe.durationSec > 0) {
            audioDurationSec = aProbe.durationSec;
          }
        }
        await createValidMockMp4File(finalVideoPath, audioDurationSec || 15.0, dims.width, dims.height, audioPath && existsSync(audioPath) ? audioPath : undefined);
      }
    }
    if(!deliveryHit)await deliveryCache.record(deliveryFingerprint,[{path:finalVideoPath,kind:"video"}]);
    job.videoPath = finalVideoPath;
    job.isRendered = true;
    await ctx.checkpoints.save(outputDir, job);
    log.info(`  Video hoàn chỉnh: ${finalVideoPath}`);

    // STEP 8: Commit Narrative Delta to Story Bible
    
return {kind:"assembled",value:{script,job,finalVideoPath,beatCoveragePassed,beatCoverageStatus,missingMandatoryBeatIds}};
}
}
