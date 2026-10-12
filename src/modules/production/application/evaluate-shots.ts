import {checkExecution} from './execution-control.js';
import {errorMessage} from "../../../platform/workflow-error.js";

import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { basename, join, normalize, resolve } from "node:path";

import { hashFile, readReference } from "../../media/index.js";
import { atomicCopyFile as copyFile } from "../../../platform/filesystem/atomic-publication.js";

import { computeEvidenceFingerprint, cosineSimilarity, generateDeterministicEmbedding, getCachedReferenceEmbedding, setCachedReferenceEmbedding, type FrameEvaluationSample, type ShotQaReport } from "../adapters/qa/face-evaluator.js";
import { log } from "../../../platform/observability/logger.js";

import { computeFileSha256 } from "./episode-fingerprints.js";
import type { EpisodeDependencies } from "../ports/episode-dependencies.js";

import { type EpisodeOptions } from "../ports/episode-options.js";

import type { EvaluateShotsInput, EvaluateShotsOutput } from "./phases/contracts.js";
export class EvaluateShots {
constructor(private dependencies:Pick<EpisodeDependencies,"checkpoints"|"faceQa"|"bible"|"shots">){}
async execute(input:EvaluateShotsInput,options:EpisodeOptions):Promise<EvaluateShotsOutput> {
const ctx=this.dependencies;
let script = structuredClone(input.script);
let job = structuredClone(input.job);
let provider = input.provider;
let seriesId = input.seriesId;
let outputDir = input.outputDir;
let reusedShotIds = input.reusedShotIds;
let videoShotsDir = input.videoShotsDir;
let shotVideos = [...input.shotVideos];
log.step(5, 8, "Kiểm định nhất quán thị giác & Đa frame (Visual QA)");
    await checkExecution(options);
    options.onProgress?.(5, 8, "Kiểm định nhất quán thị giác & Đa frame (Visual QA)");
    job.currentPhase = "qa_review";
    await ctx.checkpoints.save(outputDir, job);

    let faceQaPassedCount = 0;
    let faceQaWarnCount = 0;
    let faceQaFailCount = 0;
    let faceQaUnavailableCount = 0;
    let totalEvaluated = 0;
    const originalVisualBackend = ctx.faceQa.backend;
    try {
      if (options.visualQaBackend) {
        ctx.faceQa.backend = options.visualQaBackend;
      }
      const visualBackend = ctx.faceQa.backend;
    const backendStatus = await visualBackend.checkReadiness();
    log.info(`  Visual QA Backend: [${backendStatus.backendName}] Trạng thái: ${backendStatus.availability}`);
    log.info(`  Khẩu hình (Lip-sync): ${backendStatus.lipSyncStatus} (capability riêng biệt)`);

    if (options.styleCategory) {
      ctx.faceQa.setStyleCategory(options.styleCategory);
    }
    log.info(`  Phong cách hiệu chỉnh: [${ctx.faceQa.styleCategory}] (tPass=${ctx.faceQa.tPass}, tWarn=${ctx.faceQa.tWarn})`);

    if (options.faceQaThresholds) {
      if (options.faceQaThresholds.tPass !== undefined) ctx.faceQa.tPass = options.faceQaThresholds.tPass;
      if (options.faceQaThresholds.tWarn !== undefined) ctx.faceQa.tWarn = options.faceQaThresholds.tWarn;
      if (options.faceQaThresholds.maxReRolls !== undefined) ctx.faceQa.maxReRolls = options.faceQaThresholds.maxReRolls;
    }
    if (options.maxReRolls !== undefined) {
      ctx.faceQa.maxReRolls = options.maxReRolls;
    }

    const qaEvidenceDir = join(outputDir, "qa_evidence");
    await mkdir(qaEvidenceDir, { recursive: true });

    for (const scene of script.scenes) {
      for (const shot of scene.shots) {
        if (options.resume && reusedShotIds.has(shot.shotId)) {
          const candidateTakeId = job.shots[shot.shotId]?.candidateTakeId;
          const candidateTake = candidateTakeId ? ctx.bible.getShotTake(candidateTakeId) : null;
          const activeTake = ctx.bible.getApprovedTakeForShot(seriesId, script.episodeNumber, shot.shotId);

          const qaStatus = candidateTake?.qa_status || activeTake?.qa_status;
          const isPendingOrUnavailable = !qaStatus || qaStatus === "UNAVAILABLE" || qaStatus === "NOT_RUN";

          // Scope D: Re-evaluate QA dynamically when backend becomes AVAILABLE, without re-rendering video
          if (isPendingOrUnavailable && backendStatus.availability === "AVAILABLE") {
            log.info(`  🔄 [RESUME QA] Tái đánh giá QA cho shot tái sử dụng [${shot.shotId}] vì Backend QA hiện đã khả dụng (trước đó: ${qaStatus || "chưa chạy"})...`);
            // Do NOT continue: proceed to evaluateMultiFrame below using existing media file
          } else {
            // Verify cryptographic evidence fingerprint against media file on disk (F03)
            const takeToCheck = candidateTake || activeTake;
            let evidenceValid = true;
            if (takeToCheck?.local_path && existsSync(takeToCheck.local_path)) {
              try {
                const currentMediaSha256 = await computeFileSha256(takeToCheck.local_path);
                let oldReport: ShotQaReport | null = null;
                if (takeToCheck.qa_report_json) {
                  try {
                    oldReport = JSON.parse(takeToCheck.qa_report_json);
                  } catch (error) { log.warn("[evaluate-shots] Non-fatal operation failed: "+errorMessage(error)); }
                }
                if (oldReport?.mediaSha256 && oldReport.mediaSha256 !== currentMediaSha256) {
                  log.warn(`  ⚠️ [RESUME QA INVALIDATED] Media file của shot [${shot.shotId}] đã bị sửa đổi byte trên đĩa (SHA-256 cũ: ${oldReport.mediaSha256.slice(0, 8)}..., mới: ${currentMediaSha256.slice(0, 8)}...). Hủy bỏ QA PASS cũ.`);
                  evidenceValid = false;
                }
              } catch (error) { log.warn("[evaluate-shots] Non-fatal operation failed: "+errorMessage(error)); }
            }

            if (!evidenceValid) {
              log.info(`  🔄 [RESUME QA] Kích hoạt đánh giá lại QA cho shot [${shot.shotId}] do media file đã thay đổi...`);
              // Fall through to evaluateMultiFrame below
            } else {
              totalEvaluated++;
              if (qaStatus === "FAIL" || candidateTake?.qa_status === "FAIL" || activeTake?.qa_status === "FAIL") {
                faceQaFailCount++;
                log.warn(`  ❌ Shot tái sử dụng [${shot.shotId}]: QA trạng thái FAIL`);
              } else if (qaStatus === "PASS") {
                faceQaPassedCount++;
              } else if (qaStatus === "WARN") {
                faceQaWarnCount++;
              } else if (qaStatus === "UNAVAILABLE" || qaStatus === "NOT_RUN") {
                faceQaUnavailableCount++;
              }
              continue;
            }
          }
        }
        if (!shot.characterId) {
          const candidateTakeId =
            job.shots[shot.shotId]?.candidateTakeId ||
            job.shots[shot.shotId]?.allTakes?.slice(-1)[0];
          if (candidateTakeId) {
            ctx.bible.approveShotTake(candidateTakeId);
            if (job.shots[shot.shotId]) {
              job.shots[shot.shotId].activeTakeId = candidateTakeId;
              job.shots[shot.shotId].status = "approved";
              const appTake = ctx.bible.getShotTake(candidateTakeId);
              if (appTake?.local_path && existsSync(appTake.local_path)) {
                job.shots[shot.shotId].videoPath = appTake.local_path;
                const canonicalShotPath = join(videoShotsDir, `${shot.shotId}.mp4`);
                try {
                  if (
                    !existsSync(canonicalShotPath) ||
                    normalize(resolve(appTake.local_path)) !== normalize(resolve(canonicalShotPath))
                  ) {
                    await copyFile(appTake.local_path, canonicalShotPath);
                  }
                } catch (error) { log.warn("[evaluate-shots] Non-fatal operation failed: "+errorMessage(error)); }
              }
            }
          }
          continue;
        }
        const char = ctx.bible.getCharacter(shot.characterId);
        const candidateReference = shot.referenceImage || char?.face_reference_image;
        const refImage=candidateReference&&(provider==="mock"||await readReference(ctx.bible,candidateReference,false))?candidateReference:undefined;
        if (!refImage) {
          totalEvaluated++;
          faceQaUnavailableCount++;
          const candidateTakeId =
            job.shots[shot.shotId]?.candidateTakeId ||
            job.shots[shot.shotId]?.allTakes?.slice(-1)[0];
          const activeTake = ctx.bible.getApprovedTakeForShot(seriesId, script.episodeNumber, shot.shotId);
          const currentTakeId = candidateTakeId || activeTake?.id || job.shots[shot.shotId]?.activeTakeId;
          const unavailReport: ShotQaReport = {
            shotId: shot.shotId,
            characterId: shot.characterId,
            maxSimilarity: 0,
            status: "UNAVAILABLE",
            reRollAttempt: 0,
            shouldReRoll: false,
            styleCategory: ctx.faceQa.styleCategory,
            backendName: backendStatus.backendName,
            backendAvailability: backendStatus.availability,
            lipSyncStatus: backendStatus.lipSyncStatus,
            notes: `Không tìm thấy ảnh tham chiếu khuôn mặt cho nhân vật '${shot.characterId}'. Escalating to review.`,
            reviewEscalation: {
              required: true,
              reason: "NO_FACE",
              directorInstructions: `Thiếu ảnh tham chiếu cho nhân vật ${shot.characterId}. Cần đạo diễn bổ sung ảnh chân dung chuẩn vào Story Bible.`,
            },
            disclaimer: "Chưa có ảnh tham chiếu để đánh giá nhất quán sinh trắc học.",
          };
          unavailReport.takeId = currentTakeId;
          unavailReport.isMockVector = false;
          if (currentTakeId) {
            ctx.bible.updateShotTakeQa(currentTakeId, {
              qa_status: "UNAVAILABLE",
              qa_score: 0,
              qa_notes: unavailReport.notes,
              qa_report_json: JSON.stringify(unavailReport),
            });
          }
          await writeFile(join(qaEvidenceDir, `${shot.shotId}_qa.json`), JSON.stringify(unavailReport, null, 2));
          log.warn(`  ⚠️ Shot [${shot.shotId}]: Face QA UNAVAILABLE (${unavailReport.notes})`);
          continue;
        }

        totalEvaluated++;
        const candidateTakeId =
          job.shots[shot.shotId]?.candidateTakeId ||
          job.shots[shot.shotId]?.allTakes?.slice(-1)[0];
        const candidateTake = candidateTakeId ? ctx.bible.getShotTake(candidateTakeId) : null;
        const activeTake = ctx.bible.getApprovedTakeForShot(seriesId, script.episodeNumber, shot.shotId);
        const videoPath =
          candidateTake?.local_path ||
          job.shots[shot.shotId]?.videoPath ||
          activeTake?.local_path ||
          join(videoShotsDir, `${shot.shotId}.mp4`);

        let qaReport: ShotQaReport;

        // RULE: If Visual QA Backend is NOT_INSTALLED or UNAVAILABLE, or if production video is run with mock visual QA backend, NEVER forge PASS (Requirement 2)
        if (
          backendStatus.availability !== "AVAILABLE" ||
          (provider !== "mock" && (backendStatus.backendName.includes("mock") || visualBackend.name.includes("mock")))
        ) {
          qaReport = {
            shotId: shot.shotId,
            characterId: shot.characterId,
            referenceAssetId: refImage,
            maxSimilarity: 0,
            status: "UNAVAILABLE",
            reRollAttempt: 0,
            shouldReRoll: false,
            styleCategory: ctx.faceQa.styleCategory,
            backendName: visualBackend.name || backendStatus.backendName,
            backendAvailability: "UNAVAILABLE",
            lipSyncStatus: "NOT_SUPPORTED",
            notes:
              provider !== "mock" && (backendStatus.backendName.includes("mock") || visualBackend.name.includes("mock"))
                ? "Production video generation requires real visual QA backend. Mock visual QA backend cannot auto-evaluate or approve production takes."
                : `Visual QA Backend '${backendStatus.backendName}' không khả dụng (${backendStatus.availability}). Nghiêm cấm giả mạo PASS.`,
            reviewEscalation: {
              required: true,
              reason: "BACKEND_UNAVAILABLE",
              directorInstructions: "Chưa cấu hình backend Visual QA thực tế cho production. Cần duyệt thủ công.",
            },
            disclaimer: "Visual QA backend is mock simulator. Evaluation of real provider takes is strictly UNAVAILABLE.",
          };
          qaReport.isMockVector = true;
        } else {
          // Requirement E: Extract real reference image embedding & cache by hash/model
          let referenceEmbedding: number[] | undefined;
          const cached = getCachedReferenceEmbedding(refImage, "facenet_512_v1");
          if (cached) {
            referenceEmbedding = cached;
          } else if (typeof visualBackend.extractImageEmbedding === "function") {
            try {
              const res = await visualBackend.extractImageEmbedding(refImage);
              if (res && Array.isArray(res)) {
                referenceEmbedding = res;
              } else if (res && Array.isArray(res.embedding)) {
                referenceEmbedding = res.embedding;
              }
              if (referenceEmbedding && referenceEmbedding.length > 0) {
                setCachedReferenceEmbedding(refImage, "facenet_512_v1", referenceEmbedding);
              }
            } catch {
              referenceEmbedding = undefined;
            }
          }

          if (options.faceFeatureExtractor) {
            const extracted = await options.faceFeatureExtractor(videoPath, refImage);
            const samples: FrameEvaluationSample[] = extracted.frameEmbeddings.map((emb, idx) => ({
              frameIndex: idx,
              timestampSec: idx * 0.5,
              detectedFaces: [
                {
                  box: [0, 0, 100, 100],
                  confidence: 0.99,
                  embedding: emb,
                  faceAreaRatio: 0.08,
                },
              ],
            }));
            qaReport = await ctx.faceQa.evaluateMultiFrame(
              shot.shotId,
              shot.characterId,
              samples,
              extracted.referenceEmbedding,
              backendStatus,
              refImage
            );
          } else {
            // Extract multi-frame samples through Visual QA Backend
            const extraction = await visualBackend.extractFramesAndEmbeddings(videoPath, {
              sampleRateFps: 2,
              maxFrames: 8,
            });
            if (!referenceEmbedding || referenceEmbedding.length === 0) {
              if (provider === "mock" || backendStatus.backendName.includes("mock")) {
                referenceEmbedding = generateDeterministicEmbedding(`char_${shot.characterId}`);
              } else {
                referenceEmbedding = [];
              }
            }

            // Synthetic frame vector perturbation strictly restricted to mock provider test mode (Requirement 2)
            if (provider === "mock") {
              if (referenceEmbedding && referenceEmbedding.length > 0) {
                if (!("hasCustomMockFrames" in visualBackend) || !visualBackend.hasCustomMockFrames) {
                  extraction.frames = Array.from({ length: 6 }, (_, idx) => {
                    const perturbed = referenceEmbedding!.map(
                      (val, dim) => val + Math.sin(dim * 1.5 + idx) * 0.001
                    );
                    const norm = Math.sqrt(perturbed.reduce((acc, v) => acc + v * v, 0));
                    const normalized = norm > 0 ? perturbed.map((v) => v / norm) : referenceEmbedding!;
                    return {
                      frameIndex: idx,
                      timestampSec: idx * 0.5,
                      detectedFaces: [
                        {
                          box: [100, 100, 200, 200] as [number, number, number, number],
                          confidence: 0.99,
                          embedding: normalized,
                          faceAreaRatio: 0.08,
                        },
                      ],
                    };
                  });
                }
              }
            }

            qaReport = await ctx.faceQa.evaluateMultiFrame(
              shot.shotId,
              shot.characterId,
              extraction.frames,
              referenceEmbedding,
              backendStatus,
              refImage
            );
          }
        }

        // Bind QA evidence to take ID, media hash, and reference version (Requirement E.5 & F03)
        const currentTakeId =
          candidateTakeId ||
          activeTake?.id ||
          job.shots[shot.shotId]?.activeTakeId ||
          job.shots[shot.shotId]?.allTakes?.slice(-1)[0];
        let mediaHash: string | undefined;
        let mediaSha256: string | undefined;
        try {
          mediaSha256=await hashFile(videoPath);
          mediaHash=mediaSha256;
        } catch (error) { log.warn("[evaluate-shots] Non-fatal operation failed: "+errorMessage(error)); }

        let refSha256: string | undefined;
        if (refImage && existsSync(refImage)) {
          try {
            refSha256 = await hashFile(refImage);
          } catch (error) { log.warn("[evaluate-shots] Non-fatal operation failed: "+errorMessage(error)); }
        }

        qaReport.takeId = currentTakeId;
        qaReport.mediaHash = mediaHash;
        qaReport.mediaSha256 = mediaSha256;
        qaReport.referenceSha256 = refSha256;
        qaReport.backendVersion = backendStatus.version || backendStatus.backendName;
        if (mediaSha256) {
          qaReport.evidenceFingerprint = computeEvidenceFingerprint({
            mediaSha256,
            referenceSha256: refSha256,
            backendVersion: qaReport.backendVersion,
            backendName: backendStatus.backendName,
            tPass: ctx.faceQa.tPass,
            tWarn: ctx.faceQa.tWarn,
          });
        }
        qaReport.referenceVersion = "v1";
        qaReport.isMockVector =
          backendStatus.availability !== "AVAILABLE" ||
          provider === "mock" ||
          backendStatus.backendName.includes("mock") ||
          visualBackend.name.includes("mock");

        // Persist QA evidence report into Story Bible SQLite & filesystem
        const reportJsonStr = JSON.stringify(qaReport);
        await writeFile(join(qaEvidenceDir, `${shot.shotId}_qa.json`), JSON.stringify(qaReport, null, 2));

        if (currentTakeId) {
          ctx.bible.updateShotTakeQa(currentTakeId, {
            qa_status: qaReport.status,
            qa_score: qaReport.maxSimilarity,
            qa_notes: qaReport.notes,
            qa_report_json: reportJsonStr,
          });
        }

        if (qaReport.status === "PASS") {
          faceQaPassedCount++;
          log.info(`  ✅ Shot [${shot.shotId}]: Face QA PASS (Mean: ${qaReport.metrics?.meanSimilarity ?? qaReport.maxSimilarity} >= ${ctx.faceQa.tPass}, Stability: ${qaReport.metrics?.stabilityScore ?? 1.0})`);
          // Approve take upon verified QA PASS (Requirement F.1 & Requirement 3)
          if (currentTakeId) {
            ctx.bible.approveShotTake(currentTakeId);
            if (job.shots[shot.shotId]) {
              job.shots[shot.shotId].activeTakeId = currentTakeId;
              job.shots[shot.shotId].status = "approved";
              const approvedTake = ctx.bible.getShotTake(currentTakeId);
              if (approvedTake?.local_path && existsSync(approvedTake.local_path)) {
                job.shots[shot.shotId].videoPath = approvedTake.local_path;
                const canonicalShotPath = join(videoShotsDir, `${shot.shotId}.mp4`);
                try {
                  if (
                    !existsSync(canonicalShotPath) ||
                    approvedTake.local_path !== canonicalShotPath
                  ) {
                    await copyFile(approvedTake.local_path, canonicalShotPath);
                  }
                } catch (error) { log.warn("[evaluate-shots] Non-fatal operation failed: "+errorMessage(error)); }
              }
            }
          }
        } else if (qaReport.status === "WARN") {
          faceQaWarnCount++;
          log.warn(`  ⚠️ Shot [${shot.shotId}]: Face QA WARN (${qaReport.notes}). Chuyển sang review thủ công.`);
        } else if (qaReport.status === "UNAVAILABLE" || qaReport.status === "NOT_RUN") {
          faceQaUnavailableCount++;
          log.warn(`  ⚠️ Shot [${shot.shotId}]: Face QA ${qaReport.status} (${qaReport.notes})`);
        } else {
          faceQaFailCount++;
          log.warn(`  ❌ Shot [${shot.shotId}]: Face QA FAIL (${qaReport.notes})`);

          // Bounded Re-roll loop: check budget cap and maxReRolls
          const currentSummary = ctx.bible.getSeriesCostAndTakesSummary(seriesId);
          const isBudgetExceeded = options.budgetCapUsd !== undefined && currentSummary.totalCostUsd >= options.budgetCapUsd;

          if (isBudgetExceeded) {
            log.warn(`  [BUDGET CAP] Chi phí series ($${currentSummary.totalCostUsd}) đạt trần ngân sách ($${options.budgetCapUsd}). Dừng tự động re-roll cho shot [${shot.shotId}].`);
            qaReport.shouldReRoll = false;
          }

          if (qaReport.shouldReRoll) {
            log.info(`  🔄 [AUTO RE-ROLL] Đang tự động tái tạo shot [${shot.shotId}] (lần ${qaReport.reRollAttempt}/${ctx.faceQa.maxReRolls})...`);
            await checkExecution(options);
            const rerollRes = await ctx.shots.rerollShot({
              seriesId,
              episodeNumber: script.episodeNumber,
              shotId: shot.shotId,
              outputDir,
              provider,
              remuxAfterReroll: false,
              budgetCapUsd: options.budgetCapUsd,
              preserveExistingApproval: true,
            });

            // Re-evaluate the new take BEFORE deciding to update shotVideos (Requirement F.1)
            let rerollFrames: FrameEvaluationSample[];
            let rerollRefEmb: number[] = [];
            const cachedReroll = getCachedReferenceEmbedding(refImage, "facenet_512_v1");
            if (cachedReroll) {
              rerollRefEmb = cachedReroll;
            } else if (typeof visualBackend.extractImageEmbedding === "function") {
              try {
                const res = await visualBackend.extractImageEmbedding(refImage);
                if (res && Array.isArray(res)) {
                  rerollRefEmb = res;
                } else if (res && Array.isArray(res.embedding)) {
                  rerollRefEmb = res.embedding;
                }
                if (rerollRefEmb.length > 0) {
                  setCachedReferenceEmbedding(refImage, "facenet_512_v1", rerollRefEmb);
                }
              } catch (error) { log.warn("[evaluate-shots] Non-fatal operation failed: "+errorMessage(error)); }
            }
            if (rerollRefEmb.length === 0) {
              if (provider === "mock" || backendStatus.backendName.includes("mock")) {
                rerollRefEmb = generateDeterministicEmbedding(`char_${shot.characterId}`);
              }
            }

            if (options.faceFeatureExtractor) {
              const reExtracted = await options.faceFeatureExtractor(rerollRes.videoPath, refImage);
              rerollFrames = reExtracted.frameEmbeddings.map((emb, idx) => ({
                frameIndex: idx,
                timestampSec: idx * 0.5,
                detectedFaces: [{ box: [0, 0, 100, 100], confidence: 0.99, embedding: emb, faceAreaRatio: 0.08 }],
              }));
              if (reExtracted.referenceEmbedding && reExtracted.referenceEmbedding.length > 0) {
                rerollRefEmb = reExtracted.referenceEmbedding;
              }
            } else {
              const reExt = await visualBackend.extractFramesAndEmbeddings(rerollRes.videoPath, { sampleRateFps: 2, maxFrames: 8 });
              rerollFrames = reExt.frames;
              if (provider === "mock") {
                if (rerollRefEmb && rerollRefEmb.length > 0) {
                  const firstFace = rerollFrames?.[0]?.detectedFaces?.[0];
                  if (firstFace && (!("hasCustomMockFrames" in visualBackend) || !visualBackend.hasCustomMockFrames)) {
                    const firstSim = cosineSimilarity(firstFace.embedding, rerollRefEmb);
                    if (firstSim < 0.75) {
                      rerollFrames = Array.from({ length: 6 }, (_, idx) => {
                        const perturbed = rerollRefEmb.map(
                          (val, dim) => val + Math.sin(dim * 1.5 + idx) * 0.001
                        );
                        const norm = Math.sqrt(perturbed.reduce((acc, v) => acc + v * v, 0));
                        const normalized = norm > 0 ? perturbed.map((v) => v / norm) : rerollRefEmb;
                        return {
                          frameIndex: idx,
                          timestampSec: idx * 0.5,
                          detectedFaces: [
                            {
                              box: [100, 100, 200, 200] as [number, number, number, number],
                              confidence: 0.99,
                              embedding: normalized,
                              faceAreaRatio: 0.08,
                            },
                          ],
                        };
                      });
                    }
                  }
                }
              }
            }

            let rerollQa: ShotQaReport;
            if (
              backendStatus.availability !== "AVAILABLE" ||
              (provider !== "mock" && (backendStatus.backendName.includes("mock") || visualBackend.name.includes("mock")))
            ) {
              rerollQa = {
                shotId: shot.shotId,
                characterId: shot.characterId,
                referenceAssetId: refImage,
                maxSimilarity: 0,
                status: "UNAVAILABLE",
                reRollAttempt: 1,
                shouldReRoll: false,
                styleCategory: ctx.faceQa.styleCategory,
                backendName: visualBackend.name || backendStatus.backendName,
                backendAvailability: "UNAVAILABLE",
                lipSyncStatus: "NOT_SUPPORTED",
                notes:
                  provider !== "mock" && (backendStatus.backendName.includes("mock") || visualBackend.name.includes("mock"))
                    ? "Production video generation requires real visual QA backend. Mock visual QA backend cannot auto-evaluate or approve production takes."
                    : `Visual QA Backend '${backendStatus.backendName}' không khả dụng (${backendStatus.availability}). Nghiêm cấm giả mạo PASS.`,
                reviewEscalation: {
                  required: true,
                  reason: "BACKEND_UNAVAILABLE",
                  directorInstructions: "Chưa cấu hình backend Visual QA thực tế cho production. Cần duyệt thủ công.",
                },
                disclaimer: "Visual QA backend is mock simulator. Evaluation of real provider takes is strictly UNAVAILABLE.",
              };
              rerollQa.isMockVector = true;
            } else {
              rerollQa = await ctx.faceQa.evaluateMultiFrame(
                shot.shotId,
                shot.characterId,
                rerollFrames,
                rerollRefEmb,
                backendStatus,
                refImage
              );
              rerollQa.isMockVector =
                backendStatus.availability !== "AVAILABLE" ||
                provider === "mock" ||
                backendStatus.backendName.includes("mock") ||
                visualBackend.name.includes("mock");
            }

            rerollQa.takeId = rerollRes.takeId;
            rerollQa.referenceVersion = "v1";

            if (existsSync(rerollRes.videoPath)) {
              try {
                rerollQa.mediaSha256=await hashFile(rerollRes.videoPath);
                rerollQa.mediaHash=rerollQa.mediaSha256;
                let rRefSha: string | undefined;
                if (refImage && existsSync(refImage)) {
                  rRefSha = await hashFile(refImage);
                }
                rerollQa.referenceSha256 = rRefSha;
                rerollQa.backendVersion = backendStatus.version || backendStatus.backendName;
                rerollQa.evidenceFingerprint = computeEvidenceFingerprint({
                  mediaSha256: rerollQa.mediaSha256,
                  referenceSha256: rRefSha,
                  backendVersion: rerollQa.backendVersion,
                  backendName: backendStatus.backendName,
                  tPass: ctx.faceQa.tPass,
                  tWarn: ctx.faceQa.tWarn,
                });
              } catch (error) { log.warn("[evaluate-shots] Non-fatal operation failed: "+errorMessage(error)); }
            }

            ctx.bible.updateShotTakeQa(rerollRes.takeId, {
              qa_status: rerollQa.status,
              qa_score: rerollQa.maxSimilarity,
              qa_notes: rerollQa.notes,
              qa_report_json: JSON.stringify(rerollQa),
            });
            await writeFile(join(qaEvidenceDir, `${rerollRes.takeId}_qa.json`), JSON.stringify(rerollQa, null, 2));

            // Strictly update selection ONLY if reroll take passes QA (Requirement F.1 & F.2)
            if (rerollQa.status === "PASS") {
              faceQaPassedCount++;
              ctx.bible.approveShotTake(rerollRes.takeId);
              if (job.shots[shot.shotId]) {
                job.shots[shot.shotId].activeTakeId = rerollRes.takeId;
                job.shots[shot.shotId].videoPath = rerollRes.videoPath;
                job.shots[shot.shotId].status = "approved";
                const canonicalShotPath = join(videoShotsDir, `${shot.shotId}.mp4`);
                try {
                  await copyFile(rerollRes.videoPath, canonicalShotPath);
                } catch (error) { log.warn("[evaluate-shots] Non-fatal operation failed: "+errorMessage(error)); }
              }
              const shotIdx = shotVideos.findIndex((v) => {
                const base = basename(v, ".mp4");
                return base === shot.shotId || base.startsWith(`${shot.shotId}_`);
              });
              if (shotIdx >= 0) {
                shotVideos[shotIdx] = rerollRes.videoPath;
              }
            } else {
              log.warn(`  ⚠️ Take mới [${rerollRes.takeId}] có kết quả QA là ${rerollQa.status} (chưa PASS). Giữ nguyên take cũ.`);
            }
          }
        }
      }
    }
  } finally {
      if (options.visualQaBackend) {
        ctx.faceQa.backend = originalVisualBackend;
      }
    }

    log.info(`  📊 Kết quả Face QA: ${faceQaPassedCount} PASS, ${faceQaWarnCount} WARN, ${faceQaFailCount} FAIL, ${faceQaUnavailableCount} UNAVAILABLE (Tổng số shot có nhân vật: ${totalEvaluated})`);

    // STEP 7: Master Assembly (Video Stitching + Audio Muxing)
    
return {script, job, shotVideos, faceQaWarnCount, faceQaFailCount, faceQaUnavailableCount};
}
}
