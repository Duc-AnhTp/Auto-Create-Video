import {checkExecution,guardFailureStateWrite} from './execution-control.js';
import {WorkflowError,errorCode,failureDisposition} from '../../../platform/workflow-error.js';
import {errorMessage} from "../../../platform/workflow-error.js";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";

import {
  createValidMockMp4File,
  hashFile,
  downloadVideoSafely,
  probeVideoFile,
  decomposeShotDuration,
  extractLastFrame,
  stitchPassClips,
  CinematicDirectorEngine,
} from "../../media/index.js";
import { type ShotExecutionSpec, type VideoJobStatus } from "../../../contracts/video.js";
import { atomicCopyFile as copyFile } from "../../../platform/filesystem/atomic-publication.js";

import { log } from "../../../platform/observability/logger.js";
import { CharacterTurnaroundBridge } from "./character-turnaround-bridge.js";

import { computeShotSpecHash } from "./episode-fingerprints.js";
import type { EpisodeDependencies } from "../ports/episode-dependencies.js";

import { type EpisodeOptions } from "../ports/episode-options.js";

import type { ProduceShotsInput, ProduceShotsOutput } from "./phases/contracts.js";
export class ProduceShots {
constructor(private dependencies:Pick<EpisodeDependencies,"checkpoints"|"bible"|"shots"|"orchestrator">){}
async execute(input:ProduceShotsInput,options:EpisodeOptions):Promise<ProduceShotsOutput> {
const ctx=this.dependencies;
let script = structuredClone(input.script);
let job = structuredClone(input.job);
let visualDurations = new Map(input.visualDurations);
let planningDurations = new Map(input.planningDurations);
let provider = input.provider;
let outputDir = input.outputDir;
let seriesId = input.seriesId;
    for (const shot of script.scenes.flatMap((scene) => scene.shots)) {
      const existing = job.shots[shot.shotId];
      const targetPlanningDuration = planningDurations.get(shot.shotId) ?? shot.durationSec;
      const isPlanningDurationMatched =
        existing?.planningDurationSec !== undefined
          ? existing.planningDurationSec === targetPlanningDuration
          : (existing?.durationSec ?? shot.durationSec) === targetPlanningDuration;

      visualDurations.set(
        shot.shotId,
        options.resume && existing?.videoSha256 && isPlanningDurationMatched
          ? existing.durationSec ?? shot.durationSec
          : shot.durationSec
      );
    }
    // STEP 5: AI Video Generation & Shot Chaining
    log.step(4, 8, `Tạo các shot video qua AI Model Gateway (${provider})`);
    await checkExecution(options);
    options.onProgress?.(4, 8, `Tạo các shot video qua AI Model Gateway (${provider})`);
    job.currentPhase = "video_generation";
    await ctx.checkpoints.save(outputDir, job);

    const shotVideos: string[] = [];
    const videoShotsDir = join(outputDir, "shots");
    await mkdir(videoShotsDir, { recursive: true });
    const reusedShotIds = new Set<string>();

    for (const scene of script.scenes) {
      for (const plannedShot of scene.shots) {
        const shot = {...plannedShot, durationSec: visualDurations.get(plannedShot.shotId)!};
        if (!job.shots[shot.shotId]) {
          job.shots[shot.shotId] = {
            shotId: shot.shotId,
            status: "pending",
            allTakes: [],
            durationSec: shot.durationSec,
            retryCount: 0,
          };
        }
        const shotProg = job.shots[shot.shotId];
        let refImageContentHash: string | undefined;
        if (shot.referenceImage && existsSync(shot.referenceImage)) {
          try {
            const buf = readFileSync(shot.referenceImage);
            refImageContentHash = createHash("sha256").update(buf).digest("hex");
          } catch (error) { log.warn("[produce-shots] Non-fatal operation failed: "+errorMessage(error)); }
        }
        const specHash = computeShotSpecHash(
          shot,
          script.aspectRatio,
          provider,
          "default",
          JSON.stringify({image:refImageContentHash || shot.referenceImage,characterReferences:ctx.bible.listReferences(seriesId).filter(ref=>ref.entityId===shot.characterId).map(ref=>({path:ref.path,sha256:ref.sha256,mode:ref.mode})).sort((a,b)=>a.path.localeCompare(b.path))})
        );

        const canonicalShotPath = join(videoShotsDir, `${shot.shotId}.mp4`);

        // Resume validation: specHash matching, mock media detection, media probe (Requirements C.2, C.4, C.6, A.3)
        let canReuseShot = false;
        if (
          options.resume &&
          shotProg &&
          (shotProg.status === "completed" || shotProg.status === "approved") &&
          shotProg.videoPath &&
          existsSync(shotProg.videoPath)
        ) {
          if (shotProg.specHash && shotProg.specHash !== specHash) {
            log.info(`  [SPEC MISMATCH] Shot [${shot.shotId}] có prompt/reference/duration/provider thay đổi, tiến hành sinh mới.`);
          } else if (provider !== "mock" && shotProg.isMock) {
            log.warn(`  [MOCK MEDIA DETECTED] Shot [${shot.shotId}] là mock clip, không được tái sử dụng cho production (${provider}).`);
          } else {
            const probe = await probeVideoFile(shotProg.videoPath);
            const canonicalProbe = existsSync(canonicalShotPath) ? await probeVideoFile(canonicalShotPath) : null;
            if (!shotProg.videoSha256 || shotProg.videoSha256 !== await hashFile(shotProg.videoPath) || !probe.isValid) {
              log.warn(`  [CORRUPT MEDIA] Clip [${shotProg.videoPath}] không hợp lệ (${probe.error}), tiến hành sinh lại.`);
            } else if (!canonicalProbe?.isValid) {
              await copyFile(shotProg.videoPath, canonicalShotPath);
              canReuseShot = true;
            } else {
              canReuseShot = true;
            }
          }
        }

        if (canReuseShot) {
          log.info(`  [RESUME] Shot [${shot.shotId}] đã hoàn thành và khớp spec, bỏ qua sinh lại.`);
          shotVideos.push(shotProg.videoPath!);
          reusedShotIds.add(shot.shotId);
          continue;
        }

        log.info(`  Đang sinh shot [${shot.shotId}] (${shot.durationSec}s): "${shot.visualPrompt.slice(0, 60)}..."`);
        shotProg.status = "generating";
        await ctx.checkpoints.save(outputDir, job);

        // Handle shot chaining if duration > 5s
        const decomp = decomposeShotDuration(shot.shotId, shot.durationSec, { maxChunkSec: 5.0, crossfadeSec: 0.3 });
        const passVideos: string[] = [];
        let shotTotalCostUsd = 0;

        for (const pass of decomp.passes) {
          const shotLocalPath = join(videoShotsDir, `${shot.shotId}_p${pass.passIndex}.mp4`);
          let firstFrameImage: string | undefined = undefined;
          if (pass.conditionFromPass && passVideos[pass.conditionFromPass - 1]) {
            const prevVideo = passVideos[pass.conditionFromPass - 1];
            const lastFramePath = prevVideo.replace(/\.mp4$/, "_lastframe.jpg");
            try {
              // Extract real final frame using FFmpeg (Rule 4)
              firstFrameImage = await extractLastFrame(prevVideo, lastFramePath);
            } catch (frameErr: unknown) {
              log.warn(`Không thể trích xuất frame cuối từ '${prevVideo}': ${errorMessage(frameErr)}`);
              firstFrameImage = undefined;
            }
          }

          // Lookup character face reference image from Story Bible for visual consistency
          let charFaceRef: string | undefined = undefined;
          if (shot.characterId) {
            charFaceRef = await ctx.shots.resolveCharacterFaceReference(
              shot.characterId,
              seriesId,
              options.autoGenerateMissingConceptArt ?? false,
              provider === "mock"
            );
          }

          // Phase 3: Secondary Character Face Reference & Multi-Subject Regional Conditioning
          let secondaryCharFaceRef: string | undefined = undefined;
          let secondaryCharId: string | undefined = undefined;
          let regionalCond: ShotExecutionSpec["regionalConditioning"] = undefined;

          if (scene.charactersPresent && scene.charactersPresent.length >= 2) {
            const charIds = scene.charactersPresent.map((cp) =>
              typeof cp === "string" ? cp : cp.characterId
            );
            const charAId = shot.characterId || charIds[0];
            const charBId = charIds.find((id) => id !== charAId) || charIds[1];
            if (charBId) {
              secondaryCharId = charBId;
              secondaryCharFaceRef = await ctx.shots.resolveCharacterFaceReference(
                charBId,
                seriesId,
                options.autoGenerateMissingConceptArt ?? false,
              provider === "mock"
              );
            }

            const isMultiCharShot =
              shot.shotType === "medium" ||
              shot.shotType === "over_the_shoulder" ||
              shot.visualPrompt.includes("Two-Shot") ||
              shot.visualPrompt.includes("180") ||
              shot.visualPrompt.includes("đối diện") ||
              shot.visualPrompt.includes("hai nhân vật");

            if (isMultiCharShot && charBId) {
              const charARec = ctx.bible.getCharacter(charAId, seriesId);
              const charBRec = ctx.bible.getCharacter(charBId, seriesId);
              const isVertical = script.aspectRatio === "9:16";
              regionalCond = {
                enabled: true,
                characterAPrompt: `${charARec?.name || "Nhân vật 1"}: ${charARec?.visual_summary || "Ánh mắt sắc bén"}`,
                characterBPrompt: `${charBRec?.name || "Nhân vật 2"}: ${charBRec?.visual_summary || "Biểu cảm tập trung"}`,
                characterASide: isVertical ? "bottom" : "left",
                characterBSide: isVertical ? "top" : "right",
              };
            }
          }

          const spec: ShotExecutionSpec = {
            shotId: `${shot.shotId}_p${pass.passIndex}`,
            backend: provider,
            priority: shot.shotType === "close_up" || shot.shotType === "action" ? "hero" : "standard",
            durationSec: pass.durationSec,
            prompt: CinematicDirectorEngine.sanitizeVisualPrompt(shot.visualPrompt, script.aspectRatio),
            aspectRatio: script.aspectRatio,
            referenceImage: shot.referenceImage,
            characterReferenceImage: charFaceRef,
            characterId: shot.characterId,
            secondaryCharacterReferenceImage: secondaryCharFaceRef,
            secondaryCharacterId: secondaryCharId,
            regionalConditioning: regionalCond,
            applyFaceConsistency: false,
            firstFrameCondition: firstFrameImage,
            destinationLocalPath: shotLocalPath,
            enableHedge:options.hedge?.enabled??false,hedgeDelayMs:options.hedge?.delayMs,hedgeFallbackProvider:options.hedge?.fallbackProvider,
          };

          // Enrich spec with Character Turnaround 4-angle visual consistency & ArcFace embeddings
          const enrichedSpec = await CharacterTurnaroundBridge.bindTurnaroundToSpec(
            spec,
            ctx.bible,
            seriesId,
            { autoGenerate: options.autoGenerateMissingConceptArt === true, allowMock: provider === "mock" }
          );

          let shotResult: VideoJobStatus;
          try {
            await checkExecution(options);
            const orchRes = await ctx.orchestrator.executeShot(
              seriesId,
              script.episodeNumber,
              enrichedSpec,
              { destinationPath: shotLocalPath, budgetCapUsd: options.budgetCapUsd,validateCandidate:(path,candidate)=>ctx.shots.validateHedgeCandidate(path,candidate,options) }
            );
            shotTotalCostUsd += orchRes.costUsd || 0;
            shotResult = {
              jobId: orchRes.providerJobId || orchRes.jobId,
              status: "completed",
              localPath: orchRes.videoPath,
              videoUrl: orchRes.videoUrl,
            };
          } catch (execErr: unknown) {
            guardFailureStateWrite(options,execErr);
            if (provider !== "mock") {
              shotProg.status = "failed";
              shotProg.error = `Sinh shot qua provider '${provider}' thất bại: ${errorMessage(execErr)}`;
              job.status = "failed";
              await ctx.checkpoints.save(outputDir, job);
              throw new WorkflowError(errorCode(execErr)??'SHOT_PRODUCTION_FAILED',`[PRODUCTION ERROR] Sinh shot [${spec.shotId}] thất bại trên provider '${provider}': ${errorMessage(execErr)}`,failureDisposition(execErr),{cause:execErr});
            }
            log.warn(`Execute shot [${spec.shotId}] thất bại trên provider '${provider}': ${errorMessage(execErr)}`);
            shotResult = {
              jobId: `fallback_${spec.shotId}`,
              status: "failed",
              error: errorMessage(execErr),
            };
          }
          if (shotResult.localPath && shotResult.localPath !== shotLocalPath && existsSync(shotResult.localPath)) {
            await copyFile(shotResult.localPath, shotLocalPath);
          } else if (shotResult.videoUrl && !existsSync(shotLocalPath)) {
            try {
              await downloadVideoSafely(shotResult.videoUrl, shotLocalPath, {
                validateWithProbe: provider !== "mock",
              });
            } catch (dlErr: unknown) {
              if (provider !== "mock") {
                shotProg.status = "failed";
                shotProg.error = `Tải video thất bại: ${errorMessage(dlErr)}`;
                job.status = "failed";
                job.currentPhase = "failed";
                await ctx.checkpoints.save(outputDir, job);
                throw new Error(
                  `[PRODUCTION ERROR] Không thể tải video cho shot [${spec.shotId}] từ '${shotResult.videoUrl}': ${errorMessage(dlErr)}`
                );
              }
              log.warn(`Không thể tải video từ URL ${shotResult.videoUrl}: ${errorMessage(dlErr)}`);
            }
          }

          if (!existsSync(shotLocalPath)) {
            if (provider !== "mock") {
              shotProg.status = "failed";
              shotProg.error = `File video không tồn tại sau khi sinh từ provider '${provider}'`;
              job.status = "failed";
              job.currentPhase = "failed";
              await ctx.checkpoints.save(outputDir, job);
              throw new Error(
                `[PRODUCTION ERROR] Provider '${provider}' không trả về file video hợp lệ cho shot [${spec.shotId}]`
              );
            }
            await createValidMockMp4File(shotLocalPath, pass.durationSec);
          } else if (provider !== "mock") {
            const probe = await probeVideoFile(shotLocalPath);
            if (!probe.isValid) {
              shotProg.status = "failed";
              shotProg.error = `Video không hợp lệ: ${probe.error}`;
              job.status = "failed";
              job.currentPhase = "failed";
              await ctx.checkpoints.save(outputDir, job);
              throw new Error(
                `[PRODUCTION ERROR] Video cho shot [${spec.shotId}] bị hỏng hoặc thiếu video stream (ffprobe: ${probe.error})`
              );
            }
          }
          passVideos.push(shotLocalPath);
        }

        // Look up approved storyboard keyframe for this shot (decoupled from character identity)
        const approvedSb = ctx.bible.getApprovedStoryboardForShot(seriesId, script.episodeNumber, shot.shotId);
        const storyboardKeyframeId = approvedSb?.id;
        const usedReferencesJson = approvedSb?.used_references_json || "[]";

        // Dedicated take isolation: each take gets its own immutable file path (Requirement 3)
        const reservation = ctx.bible.atomicReserveShotTake({
          seriesId,
          episodeNumber: script.episodeNumber,
          shotId: shot.shotId,
          provider,
          prompt: shot.visualPrompt,
          durationSec: shot.durationSec,
          minTakeNumber: (shotProg?.allTakes?.length || 0) + 1,
          storyboardKeyframeId,
          usedReferencesJson,
          localPathBuilder: (_takeNum, takeNumStr) =>
            join(videoShotsDir, `${shot.shotId}_take${takeNumStr}.mp4`),
        });
        const takeNumber = reservation.takeNumber;
        const takeNumStr = String(takeNumber).padStart(2, "0");
        const takeId = reservation.takeId;
        const takeVideoPath = reservation.localPath;

        let resolvedShotPath = takeVideoPath;

        // If multiple passes were generated, stitch them with standardized crossfade and normalization
        // skipRender skips the final master, but a take still needs a valid clip.
        if (passVideos.length > 1) {
          const stitchedShotPath = takeVideoPath;
          // Measure actual probed durations of each pass video (Rule 5)
          const actualPassDurations: number[] = [];
          for (let i = 0; i < passVideos.length; i++) {
            const pProbe = await probeVideoFile(passVideos[i]);
            actualPassDurations.push(
              pProbe.isValid && pProbe.durationSec > 0 ? pProbe.durationSec : decomp.passes[i].durationSec
            );
          }

          try {
            const stitchResult = await stitchPassClips(passVideos, actualPassDurations, stitchedShotPath, {
              crossfadeSec: 0.3,
              targetDurationSec: shot.durationSec,
              fps: script.fps || 30,
              aspectRatio: script.aspectRatio || "9:16",
            });
            resolvedShotPath = stitchResult.outputPath;
          } catch (stitchErr: unknown) {
            // Strictly do NOT silently fallback to passVideos[0] (Rule 8)
            shotProg.status = "failed";
            shotProg.error = `Lỗi FFmpeg khi ghép đa pass cho shot [${shot.shotId}]: ${errorMessage(stitchErr)}`;
            await ctx.checkpoints.save(outputDir, job);
            throw new Error(
              `[PRODUCTION ERROR] Không thể ghép các pass của shot [${shot.shotId}]: ${errorMessage(stitchErr)}`
            );
          }
        } else if (passVideos.length === 1) {
          if (passVideos[0] !== takeVideoPath && existsSync(passVideos[0])) {
            await copyFile(passVideos[0], takeVideoPath);
          }
          resolvedShotPath = takeVideoPath;
        }

        // Initialize or restore canonical shot path with the baseline take if it doesn't exist or is invalid
        const isCanonicalValid = existsSync(canonicalShotPath) && (await probeVideoFile(canonicalShotPath)).isValid;
        if (!isCanonicalValid && existsSync(resolvedShotPath)) {
          try {
            await copyFile(resolvedShotPath, canonicalShotPath);
          } catch (error) { log.warn("[produce-shots] Non-fatal operation failed: "+errorMessage(error)); }
        }

        const previousApproved = ctx.bible.getApprovedTakeForShot(seriesId, script.episodeNumber, shot.shotId);
        const existingApproved = provider!=="mock"&&previousApproved?.provider==="mock"?null:previousApproved;
        // Requirement F.5: Do NOT auto-approve new take before QA verification
        const shouldAutoApprove = false;

        ctx.bible.recordShotTake({
          id: takeId,
          series_id: seriesId,
          episode_number: script.episodeNumber,
          shot_id: shot.shotId,
          take_number: takeNumber,
          provider,
          prompt: shot.visualPrompt,
          local_path: resolvedShotPath,
          duration_sec: shot.durationSec,
          qa_status: "NOT_RUN",
          storyboard_keyframe_id: storyboardKeyframeId,
          used_references_json: usedReferencesJson,
          is_approved: shouldAutoApprove,
          cost_usd: shotTotalCostUsd,
          created_at: new Date().toISOString(),
        });

        // Update shot progress in job checkpoint
        job.shots[shot.shotId] = {
          shotId: shot.shotId,
          status: "completed",
          candidateTakeId: takeId,
          activeTakeId: existingApproved ? existingApproved.id : undefined,
          allTakes: [...(shotProg?.allTakes || []), takeId],
          videoPath: existingApproved?.local_path || canonicalShotPath,
          planningDurationSec:planningDurations.get(shot.shotId),
          videoSha256: await hashFile(existingApproved?.local_path || canonicalShotPath),
          durationSec: shot.durationSec,
          retryCount: shotProg?.retryCount || 0,
          specHash,
          provider,
          isMock: provider === "mock",
        };
        job.shotProgress = script.scenes
          .flatMap((s) => s.shots)
          .map((s) => job.shots[s.shotId])
          .filter(Boolean);
        job.totalCostUsd = (job.totalCostUsd || 0) + shotTotalCostUsd;
        shotVideos.push(existingApproved?.local_path || canonicalShotPath);
        await ctx.checkpoints.save(outputDir, job);
      }
    }

    // STEP 6: Visual QA & Multi-Frame Continuity Evaluation
    
return {script, job, reusedShotIds, videoShotsDir, shotVideos, visualDurations};
}
}
