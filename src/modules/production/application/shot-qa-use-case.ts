import {errorMessage} from "../../../platform/workflow-error.js";
import { WorkflowError } from "../../../platform/workflow-error.js";
import { createHash } from "node:crypto";
import { isOwnershipError, failureDisposition } from "../../../platform/workflow-error.js";
import type { RerollReservationStore } from "../ports/reroll-reservation-store.js";
import { existsSync } from "node:fs";
import { mkdir,readFile } from "node:fs/promises";
import { join } from "node:path";
import { createValidMockMp4File } from "../../media/index.js";
import { type BackendProvider, type ShotExecutionSpec, type VideoJobStatus } from "../../../contracts/video.js";
import { readReference } from "../../media/index.js";
import { atomicCopyFile as copyFile } from "../../../platform/filesystem/atomic-publication.js";
import { downloadVideoSafely,probeVideoFile,hashFile } from "../../media/index.js";
import {
FaceQaEvaluator
} from "../adapters/qa/face-evaluator.js";
import { log } from "../../../platform/observability/logger.js";
import { CharacterTurnaroundBridge } from "./character-turnaround-bridge.js";
import { ConceptArtGenerator } from "./concept-art-generator.js";
import type { EpisodeDependencies } from "../ports/episode-dependencies.js";
import { type EpisodeOptions } from "../ports/episode-options.js";
import { type EpisodicScript } from "../../../contracts/episode.js";
export class ShotQaUseCase {
constructor(private dependencies:Pick<EpisodeDependencies,"bible"|"faceQa"|"checkpoints"|"orchestrator"|"gateway"|"remux">, private reservations?: RerollReservationStore){}
public async resolveCharacterFaceReference(
    characterId: string,
    seriesId: string,
    autoGenerate = false,
    allowMock = true
  ): Promise<string | undefined> {
    const ctx=this.dependencies;
    const charRec = ctx.bible.getCharacter(characterId, seriesId);
    if (!charRec) return undefined;
    if (charRec.face_reference_image && existsSync(charRec.face_reference_image) && (allowMock || await readReference(ctx.bible,charRec.face_reference_image,false))) {
      return charRec.face_reference_image;
    }
    if (!autoGenerate) {
      return undefined;
    }
    try {
      const artGen = new ConceptArtGenerator(ctx.bible);
      const artRes = await artGen.generateCharacterConceptArt({
        seriesId,
        characterId,
        allowMock,
      });
      log.info(`[PIPELINE] Đã tự động tạo chân dung chuẩn cho nhân vật '${characterId}': ${artRes.imagePath}`);
      return artRes.imagePath;
    } catch (err: unknown) {
      log.warn(`[PIPELINE] Không thể tự tạo chân dung cho nhân vật '${characterId}': ${errorMessage(err)}`);
      return undefined;
    }
  }

public async validateHedgeCandidate(path:string,spec:ShotExecutionSpec,options:EpisodeOptions):Promise<"PASS"|"FAIL"|"UNAVAILABLE"> {
    const ctx=this.dependencies;
    if(!(await probeVideoFile(path)).isValid)return "FAIL";
    if(!spec.characterId)return "PASS";
    const backend=options.visualQaBackend??ctx.faceQa.backend;
    const readiness=await backend.checkReadiness();
    const reference=spec.characterReferenceImage;
    if(backend.isMockBackend||readiness.availability!=="AVAILABLE"||!reference||!backend.extractImageEmbedding||!await readReference(ctx.bible,reference,false))return "UNAVAILABLE";
    const embedding=await backend.extractImageEmbedding(reference);
    if(!embedding.embedding?.length)return "UNAVAILABLE";
    const frames=await backend.extractFramesAndEmbeddings(path,{sampleRateFps:2,maxFrames:8});
    if(frames.error)return "UNAVAILABLE";
    const qa=new FaceQaEvaluator({backend,styleCategory:options.styleCategory});
    const report=await qa.evaluateMultiFrame(spec.shotId,spec.characterId,frames.frames,embedding.embedding,readiness,reference);
    return report.status==="PASS"?"PASS":report.status==="UNAVAILABLE"?"UNAVAILABLE":"FAIL";
  }

public async rerollShot(options: {
    operationId?: string;
    seriesId: string;
    episodeNumber: number;
    shotId: string;
    provider?: BackendProvider;
    dryRun?: boolean;
    outputDir?: string;
    promptOverride?: string;
    remuxAfterReroll?: boolean;
    transitionDurationSec?: number;
    budgetCapUsd?: number;
    hedge?:EpisodeOptions["hedge"];
    maxReRolls?:number;
    preserveExistingApproval?: boolean;
    forceApprove?: boolean;
    autoGenerateMissingConceptArt?: boolean;
  }): Promise<{ shotId: string; takeId: string; videoPath: string; isApproved: boolean }> {
    const ctx=this.dependencies;
    const provider = options.dryRun ? "mock" : (options.provider || "mock");
    const epNumStr = String(options.episodeNumber).padStart(2, "0");
    const outputDir =
      options.outputDir || join("output", "series", options.seriesId, `ep-${epNumStr}`);
    const scriptPath = join(outputDir, "script-normalized.json");
    if (!existsSync(scriptPath)) {
      throw new Error(`Không tìm thấy kịch bản tập tại: ${scriptPath}`);
    }

    const script: EpisodicScript = JSON.parse(await readFile(scriptPath, "utf8"));
    const isEquivalentShot = (a: string, b: string) => {
      if (a === b) return true;
      const ma = a.match(/^sc0*(\d+)_sh0*(\d+)$/i);
      const mb = b.match(/^sc0*(\d+)_sh0*(\d+)$/i);
      return Boolean(ma && mb && ma[1] === mb[1] && ma[2] === mb[2]);
    };
    const shot = script.scenes.flatMap((s) => s.shots).find((sh) => isEquivalentShot(sh.shotId, options.shotId));
    if (!shot) {
      throw new Error(`Không tìm thấy shot [${options.shotId}] trong kịch bản tập ${options.episodeNumber}`);
    }

    log.info(`\n=== TÁI TẠO SHOT [${options.shotId}] (Provider: ${provider}) ===`);
    const job = (await ctx.checkpoints.load(outputDir)) || {
      jobId: `job_${options.seriesId}_ep${epNumStr}_reroll`,
      seriesId: options.seriesId,
      episodeNumber: options.episodeNumber,
      title: script.title,
      status: "in_progress" as const,
      currentPhase: "video_generation" as const,
      shots: {},
      totalCostUsd: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const ckptShot = job?.shots?.[options.shotId] || Object.entries(job?.shots || {}).find(([k]) => isEquivalentShot(k, options.shotId))?.[1];
    const ckptTakes = (ckptShot?.allTakes?.length || 0) + 1;
    const videoShotsDir = join(outputDir, "shots");
    await mkdir(videoShotsDir, { recursive: true });

    if(provider!=="mock"&&shot.referenceImage&&!await readReference(ctx.bible,shot.referenceImage,false))throw new WorkflowError("REFERENCE_PROVENANCE_REQUIRED", "REFERENCE_PROVENANCE_REQUIRED", "failed");
    const prompt = options.promptOverride || shot.visualPrompt;

    const requestHash = createHash("sha256").update(JSON.stringify({ seriesId: options.seriesId, episode: options.episodeNumber, shot, prompt, provider, hedge: options.hedge })).digest("hex");
    if (options.operationId && !this.reservations) throw new WorkflowError("REROLL_STORE_REQUIRED", "Reroll recovery store is required");
    let reserved = options.operationId ? await this.reservations!.load(outputDir, options.operationId) : null;
    if (reserved && reserved.requestHash !== requestHash) throw new WorkflowError("REROLL_REQUEST_CHANGED", "Queued reroll inputs have changed", "needs_review");
    if (reserved && !ctx.bible.listShotTakes(options.seriesId, options.episodeNumber, options.shotId).some(take => take.id === reserved!.takeId)) {
      throw new WorkflowError("REROLL_RESERVATION_MISSING", "Reserved take is missing", "needs_review");
    }
    if (reserved?.sha256) {
      if (!existsSync(reserved.localPath) || await hashFile(reserved.localPath) !== reserved.sha256 || !(await probeVideoFile(reserved.localPath)).isValid) {
        throw new WorkflowError("REROLL_MEDIA_CHANGED", "Completed reroll media has changed", "needs_review");
      }
      const take = ctx.bible.listShotTakes(options.seriesId, options.episodeNumber, options.shotId).find(take => take.id === reserved!.takeId)!;
      return { shotId: options.shotId, takeId: reserved.takeId, videoPath: reserved.localPath, isApproved: Boolean(take.is_approved) };
    }
    if (!reserved) {
      if (options.budgetCapUsd !== undefined) {
        const summary = ctx.bible.getSeriesCostAndTakesSummary(options.seriesId);
        if (summary.totalCostUsd >= options.budgetCapUsd) {
          throw new WorkflowError("BUDGET_EXCEEDED", `Chi phí series ($${summary.totalCostUsd.toFixed(4)}) đã chạm trần ngân sách ($${options.budgetCapUsd.toFixed(4)}).`, "needs_review");
        }
      }
      const take = ctx.bible.atomicReserveShotTake({
        seriesId: options.seriesId,
        episodeNumber: options.episodeNumber,
        shotId: options.shotId,
        provider,
        prompt,
        durationSec: shot.durationSec,
        minTakeNumber: ckptTakes,
        localPathBuilder: (_num, numStr) => join(videoShotsDir, `${options.shotId}_take${numStr}.mp4`),
      });
      reserved = { requestHash, takeId: take.takeId, takeNumber: take.takeNumber, takeNumStr: take.takeNumStr, localPath: take.localPath };
      if (options.operationId) await this.reservations!.save(outputDir, options.operationId, reserved);
    }

    const takeNumber = reserved.takeNumber;
    const takeNumStr = reserved.takeNumStr;
    const takeId = reserved.takeId;
    const takeLocalPath = reserved.localPath;

    log.info(`  Đang sinh Take ${takeNumber}: "${prompt.slice(0, 60)}..."`);

    let charFaceRef: string | undefined = undefined;
    if (shot.characterId) {
      charFaceRef = await this.resolveCharacterFaceReference(
        shot.characterId,
        options.seriesId,
        options.autoGenerateMissingConceptArt ?? false,
              provider === "mock"
      );
    }

    const parentScene = script.scenes.find((sc) => sc.shots.some((sh) => isEquivalentShot(sh.shotId, options.shotId)));
    let secondaryCharFaceRef: string | undefined = undefined;
    let secondaryCharId: string | undefined = undefined;
    let regionalCond: any = undefined;

    if (parentScene?.charactersPresent && parentScene.charactersPresent.length >= 2) {
      const charIds = parentScene.charactersPresent.map((cp) =>
        typeof cp === "string" ? cp : cp.characterId
      );
      const charAId = shot.characterId || charIds[0];
      const charBId = charIds.find((id) => id !== charAId) || charIds[1];
      if (charBId) {
        secondaryCharId = charBId;
        secondaryCharFaceRef = await this.resolveCharacterFaceReference(
          charBId,
          options.seriesId,
          options.autoGenerateMissingConceptArt ?? false,
              provider === "mock"
        );
      }
      const isMultiCharShot =
        shot.shotType === "medium" ||
        shot.shotType === "over_the_shoulder" ||
        prompt.includes("Two-Shot") ||
        prompt.includes("180") ||
        prompt.includes("đối diện") ||
        prompt.includes("hai nhân vật");

      if (isMultiCharShot && charBId) {
        const charARec = ctx.bible.getCharacter(charAId, options.seriesId);
        const charBRec = ctx.bible.getCharacter(charBId, options.seriesId);
        regionalCond = {
          enabled: true,
          characterAPrompt: `${charARec?.name || "Nhân vật 1"}: ${charARec?.visual_summary || "Ánh mắt sắc bén"}`,
          characterBPrompt: `${charBRec?.name || "Nhân vật 2"}: ${charBRec?.visual_summary || "Biểu cảm tập trung"}`,
          characterASide: "left",
          characterBSide: "right",
        };
      }
    }

    const spec: ShotExecutionSpec = {
      shotId: `${options.shotId}_take${takeNumStr}`,
      backend: provider,
      priority: "hero",
      durationSec: shot.durationSec,
      prompt,
      aspectRatio: script.aspectRatio,
      referenceImage: shot.referenceImage,
      characterReferenceImage: shot.characterId ? (charFaceRef || shot.referenceImage) : undefined,
      characterId: shot.characterId,
      secondaryCharacterReferenceImage: secondaryCharFaceRef,
      secondaryCharacterId: secondaryCharId,
      regionalConditioning: regionalCond,
      applyFaceConsistency: false,
      enableHedge:options.hedge?.enabled??false,hedgeFallbackProvider:options.hedge?.fallbackProvider,hedgeDelayMs:options.hedge?.delayMs,
      destinationLocalPath: takeLocalPath,
    };

    const enrichedTakeSpec = await CharacterTurnaroundBridge.bindTurnaroundToSpec(
      spec,
      ctx.bible,
      options.seriesId,
      { autoGenerate: options.autoGenerateMissingConceptArt === true, allowMock: provider === "mock" }
    );

    let result: VideoJobStatus;
    let executedCostUsd = 0;
    try {
      const orchRes = await ctx.orchestrator.executeShot(
        options.seriesId,
        options.episodeNumber,
        enrichedTakeSpec,
        {
          destinationPath: takeLocalPath,
          cacheScope: options.operationId ? reserved.takeId : undefined,
          forceReRender: !options.operationId,maxReRolls:options.maxReRolls,validateCandidate:(path,candidate)=>this.validateHedgeCandidate(path,candidate,{}),
          budgetCapUsd: options.budgetCapUsd,
        }
      );
      executedCostUsd = orchRes.costUsd || 0;
      result = {
        jobId: orchRes.providerJobId || orchRes.jobId,
        status: "completed",
        localPath: orchRes.videoPath,
        videoUrl: orchRes.videoUrl,
      };
    } catch (execErr: unknown) {
      if (isOwnershipError(execErr) || ["lease_lost", "cancelled"].includes(failureDisposition(execErr))) throw execErr;
      if (provider !== "mock") {
        throw execErr;
      }
      log.warn(`Execute reroll shot [${options.shotId}] thất bại trên provider '${provider}': ${errorMessage(execErr)}`);
      result = await ctx.gateway.executeShot(spec, takeLocalPath);
    }
    if (result.localPath && result.localPath !== takeLocalPath && existsSync(result.localPath)) {
      await copyFile(result.localPath, takeLocalPath);
    } else if (result.videoUrl && !existsSync(takeLocalPath)) {
      try {
        await downloadVideoSafely(result.videoUrl, takeLocalPath, {
          validateWithProbe: provider !== "mock",
        });
      } catch (dlErr: unknown) {
        if (provider !== "mock") {
          throw new Error(
            `[PRODUCTION ERROR] Không thể tải video take mới cho shot [${options.shotId}]: ${errorMessage(dlErr)}`
          );
        }
        log.warn(`Không thể tải video từ URL ${result.videoUrl}: ${errorMessage(dlErr)}`);
      }
    }
    if (!existsSync(takeLocalPath)) {
      if (provider !== "mock") {
        throw new Error(
          `[PRODUCTION ERROR] Provider '${provider}' không tạo được file video cho shot [${options.shotId}]`
        );
      }
      await createValidMockMp4File(takeLocalPath, shot.durationSec);
    } else if (provider !== "mock") {
      const probe = await probeVideoFile(takeLocalPath);
      if (!probe.isValid) {
        throw new Error(
          `[PRODUCTION ERROR] Take mới của shot [${options.shotId}] không hợp lệ: ${probe.error}`
        );
      }
    }

    // Preserve previously approved takes unless explicit forceApprove is requested
    const existingApproved = ctx.bible.getApprovedTakeForShot(
      options.seriesId,
      options.episodeNumber,
      options.shotId
    );

    // Requirement F.5: Do NOT auto-approve newly generated take without review clearance / forceApprove
    const shouldApproveNewTake = Boolean(options.forceApprove);

    // Look up approved storyboard keyframe
    const approvedSb = ctx.bible.getApprovedStoryboardForShot(
      options.seriesId,
      options.episodeNumber,
      options.shotId
    );

    // Record new take in Bible SQLite
    ctx.bible.recordShotTake({
      id: takeId,
      series_id: options.seriesId,
      episode_number: options.episodeNumber,
      shot_id: options.shotId,
      take_number: takeNumber,
      provider,
      prompt,
      local_path: takeLocalPath,
      duration_sec: shot.durationSec,
      qa_status: "NOT_RUN",
      storyboard_keyframe_id: approvedSb?.id,
      used_references_json: approvedSb?.used_references_json || "[]",
      is_approved: shouldApproveNewTake,
      cost_usd: executedCostUsd,
      created_at: new Date().toISOString(),
    });

    if (shouldApproveNewTake) {
      ctx.bible.approveShotTake(takeId);
      log.info(`  Take mới [${takeId}] đã được kích hoạt làm take chính thức.`);
      const canonicalShotPath = join(videoShotsDir, `${options.shotId}.mp4`);
      try {
        await copyFile(takeLocalPath, canonicalShotPath);
      } catch (error) { log.warn("[shot-qa-use-case] Non-fatal operation failed: "+errorMessage(error)); }
      if (shot.shotId !== options.shotId) {
        const canonicalShotPathNorm = join(videoShotsDir, `${shot.shotId}.mp4`);
        try {
          await copyFile(takeLocalPath, canonicalShotPathNorm);
        } catch (error) { log.warn("[shot-qa-use-case] Non-fatal operation failed: "+errorMessage(error)); }
      }
    } else {
      log.info(`  Bảo lưu take đã duyệt trước đó [${existingApproved?.id}]; Take mới [${takeId}] được lưu trữ an toàn chờ review.`);
    }

    // Update job checkpoint
    const currentShotProg = job.shots[options.shotId] || ckptShot || {
      shotId: options.shotId,
      status: "pending" as const,
      allTakes: [],
      retryCount: 0,
    };
    const dbTakes = ctx.bible.listShotTakes(options.seriesId, options.episodeNumber, options.shotId);
    const dbTakeIds = dbTakes.map((t) => t.id);
    const mergedTakes = Array.from(new Set([...(currentShotProg.allTakes || []), ...dbTakeIds, takeId]));

    const updatedProg = {
      ...currentShotProg,
      shotId: options.shotId,
      status: "completed" as const,
      activeTakeId: shouldApproveNewTake ? takeId : (existingApproved ? existingApproved.id : currentShotProg.activeTakeId || takeId),
      allTakes: mergedTakes,
      videoPath: shouldApproveNewTake ? takeLocalPath : (existingApproved ? existingApproved.local_path : currentShotProg.videoPath || takeLocalPath),
      durationSec: shot.durationSec,
      retryCount: (currentShotProg.retryCount || 0) + 1,
    };
    job.shots[options.shotId] = updatedProg;
    if (shot.shotId !== options.shotId) {
      job.shots[shot.shotId] = { ...updatedProg, shotId: shot.shotId };
    }
    job.shotProgress = script.scenes
      .flatMap((s) => s.shots)
      .map((s) => job.shots[s.shotId])
      .filter(Boolean);
    job.totalCostUsd = (job.totalCostUsd || 0) + executedCostUsd;
    job.updatedAt = new Date().toISOString();
    await ctx.checkpoints.save(outputDir, job);
    if (options.operationId) await this.reservations!.save(outputDir, options.operationId, { ...reserved, sha256: await hashFile(takeLocalPath) });

    log.info(`✅ Tái tạo shot [${options.shotId}] thành công: Take ID ${takeId}`);
    log.info(`   File: ${takeLocalPath} (Đã duyệt: ${shouldApproveNewTake})`);

    if (options.remuxAfterReroll !== false) {
      await ctx.remux({
        seriesId: options.seriesId,
        episodeNumber: options.episodeNumber,
        outputDir,
        transitionDurationSec: options.transitionDurationSec,
      });
    }

    return {
      shotId: options.shotId,
      takeId,
      videoPath: takeLocalPath,
      isApproved: shouldApproveNewTake,
    };
  }
}
