import { readFile, writeFile, mkdir, copyFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, dirname, resolve, basename } from "node:path";
import { spawn } from "node:child_process";
import { BibleManager, type NarrativeDelta, type EpisodeSummaryRecord } from "../bible/bible-manager.js";
import { normalizeScript } from "./script-normalizer.js";
import { AudioAssembler } from "./audio-assembler.js";
import {
  VideoModelGateway,
  downloadVideoFromUrl,
  type BackendProvider,
  type ShotExecutionSpec,
} from "../gateway/video-gateway.js";
import { downloadVideoSafely, probeVideoFile } from "../media/media-validator.js";
import { MockVideoAdapter } from "../gateway/adapters/mock-adapter.js";
import { KlingAdapter } from "../gateway/adapters/kling-adapter.js";
import { RunwayAdapter } from "../gateway/adapters/runway-adapter.js";
import { ComfyUiAdapter } from "../gateway/adapters/comfyui-adapter.js";
import { VeoAdapter } from "../gateway/adapters/veo-adapter.js";
import { SeedanceAdapter } from "../gateway/adapters/seedance-adapter.js";
import { ResilientJobOrchestrator } from "../orchestration/job-orchestrator.js";
import {
  decomposeShotDuration,
  buildCrossfadeStitchFilter,
  extractLastFrame,
  stitchPassClips,
} from "../pipeline/shot-chaining.js";
import {
  FaceQaEvaluator,
  generateDeterministicEmbedding,
  type VisualQaBackend,
  type VisualStyleCategory,
  type ShotQaReport,
  type FrameEvaluationSample,
  STYLE_CALIBRATION_PROFILES,
  MockVisualQaBackend,
  UninstalledVisualQaBackend,
} from "../qa/face-evaluator.js";
import type {
  EpisodicScript,
  EpisodeProductionJob,
  ShotProgress,
} from "./series-schema.js";
import { log } from "../utils/logger.js";
import { createValidMockMp4File } from "../assets/mock-media-generator.js";

function runFfmpeg(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn("ffmpeg", args);
    let out = "", err = "";
    proc.stdout.on("data", (d) => (out += d.toString()));
    proc.stderr.on("data", (d) => (err += d.toString()));
    proc.on("close", (code) => {
      if (code === 0) resolve(out);
      else reject(new Error(`ffmpeg failed (exit ${code}): ${err}`));
    });
    proc.on("error", reject);
  });
}

export interface EpisodicPipelineOptions {
  seriesId?: string;
  biblePath?: string;
  provider?: BackendProvider;
  mockTts?: boolean;
  skipAudit?: boolean;
  skipRender?: boolean;
  resume?: boolean;
  narrativeDelta?: NarrativeDelta;
  outputDir?: string;
  faceQaThresholds?: { tPass?: number; tWarn?: number; maxReRolls?: number };
  faceFeatureExtractor?: (
    shotVideoPath: string,
    referenceImagePath: string
  ) => Promise<{ frameEmbeddings: number[][]; referenceEmbedding: number[] }>;
  visualQaBackend?: VisualQaBackend;
  styleCategory?: VisualStyleCategory;
  budgetCapUsd?: number;
  maxReRolls?: number;
  storyboardReviewRequired?: boolean;
  commitCanon?: boolean;
  allowMockCanonCommit?: boolean;
  requireApproval?: boolean;
  autoCommitCanon?: boolean;
  strictCharacters?: boolean;
  characterMapping?: Record<string, string>;
  overflowPolicy?: "extend_shot" | "split_shot" | "error";
  transitionDurationSec?: number;
}

export interface EpisodicPipelineResult {
  episodeNumber: number;
  title: string;
  script: EpisodicScript;
  videoPath: string;
  audioPath: string;
  outputDir: string;
  auditPassed: boolean;
  isMock: boolean;
  committedCanon: boolean;
}

export class EpisodicPipeline {
  private bible: BibleManager;
  private gateway: VideoModelGateway;
  private audioAssembler: AudioAssembler;
  private faceQa: FaceQaEvaluator;
  private orchestrator: ResilientJobOrchestrator;

  constructor(biblePath = "story_bible.db") {
    this.bible = new BibleManager(biblePath);
    this.gateway = new VideoModelGateway();
    this.audioAssembler = new AudioAssembler();
    this.faceQa = new FaceQaEvaluator();

    // Register default video adapters
    this.gateway.registerAdapter(new MockVideoAdapter());
    this.gateway.registerAdapter(new KlingAdapter());
    this.gateway.registerAdapter(new RunwayAdapter());
    this.gateway.registerAdapter(new ComfyUiAdapter());
    this.gateway.registerAdapter(new VeoAdapter());
    this.gateway.registerAdapter(new SeedanceAdapter());

    this.orchestrator = new ResilientJobOrchestrator(this.bible, this.gateway);
  }

  public getBible(): BibleManager {
    return this.bible;
  }

  public getOrchestrator(): ResilientJobOrchestrator {
    return this.orchestrator;
  }

  public close(): void {
    if (this.bible) {
      try {
        this.bible.close();
      } catch {
        // Safe ignore
      }
    }
  }

  /**
   * Loads checkpoint for an episode if it exists.
   */
  public async loadCheckpoint(outputDir: string): Promise<EpisodeProductionJob | null> {
    const checkpointPath = join(outputDir, "checkpoint.json");
    if (!existsSync(checkpointPath)) return null;
    try {
      const data = await readFile(checkpointPath, "utf8");
      return JSON.parse(data) as EpisodeProductionJob;
    } catch {
      return null;
    }
  }

  /**
   * Saves checkpoint state to disk.
   */
  public async saveCheckpoint(outputDir: string, job: EpisodeProductionJob): Promise<void> {
    await mkdir(outputDir, { recursive: true });
    job.updatedAt = new Date().toISOString();
    await writeFile(join(outputDir, "checkpoint.json"), JSON.stringify(job, null, 2));
  }

  /**
   * Runs the complete 8-step episodic production pipeline with checkpointing & resume support.
   */
  public async produceEpisode(
    rawScriptTextOrPath: string,
    options: EpisodicPipelineOptions = {}
  ): Promise<EpisodicPipelineResult> {
    const provider: BackendProvider = options.provider || "mock";
    log.info(`\n=== BẮT ĐẦU SẢN XUẤT TẬP PHIM (Provider: ${provider}) ===`);

    // STEP 1: Load Raw Script
    let rawContent = rawScriptTextOrPath;
    if (existsSync(rawScriptTextOrPath)) {
      rawContent = await readFile(rawScriptTextOrPath, "utf8");
    }

    // STEP 2: Normalize & Enrich Script with Bible Memory
    log.step(1, 8, "Chuẩn hóa kịch bản & Liên kết bộ nhớ Story Bible");
    const script = await normalizeScript(rawContent, this.bible, {
      skipAudit: options.skipAudit,
      strictCharacters: options.strictCharacters,
      characterMapping: options.characterMapping,
    });
    log.info(`  Tập ${script.episodeNumber}: "${script.title}" (${script.scenes.length} cảnh)`);

    // Determine Output Directory
    const seriesId = options.seriesId || script.seriesId || "default-series";
    const epNumStr = String(script.episodeNumber).padStart(2, "0");
    const outputDir = options.outputDir || join("output", "series", seriesId, `ep-${epNumStr}`);
    await mkdir(outputDir, { recursive: true });

    // Save normalized script spec
    await writeFile(join(outputDir, "script-normalized.json"), JSON.stringify(script, null, 2));

    // Initialize or Resume Production Job Checkpoint
    let job: EpisodeProductionJob | null = null;
    if (options.resume) {
      job = await this.loadCheckpoint(outputDir);
      if (job) {
        log.info(`  [RESUME] Khôi phục tiến trình sản xuất từ checkpoint (${Object.keys(job.shots).length} shots)`);
      }
    }

    if (!job) {
      job = {
        jobId: `job_${seriesId}_ep${epNumStr}_${Date.now()}`,
        seriesId,
        episodeNumber: script.episodeNumber,
        title: script.title,
        status: "in_progress",
        currentPhase: "init",
        shots: {},
        totalCostUsd: 0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      for (const scene of script.scenes) {
        for (const shot of scene.shots) {
          job.shots[shot.shotId] = {
            shotId: shot.shotId,
            status: "pending",
            allTakes: [],
            durationSec: shot.durationSec,
            retryCount: 0,
          };
        }
      }
      await this.saveCheckpoint(outputDir, job);
    }

    // STEP 3: Continuity Audit Check
    log.step(2, 8, "Rà soát tính liên tục cốt truyện (Continuity Audit)");
    job.currentPhase = "audit";
    await this.saveCheckpoint(outputDir, job);

    const auditRes = await this.bible.auditDraftScript(script.episodeNumber, rawContent);
    const auditPassed = auditRes.audit_status !== "FAIL";
    if (auditRes.contradictions.length > 0) {
      log.warn(`  Tìm thấy ${auditRes.contradictions.length} điểm cần lưu ý về cốt truyện`);
      for (const c of auditRes.contradictions) {
        log.warn(`    - [${c.severity}] ${c.description} -> Khắc phục: ${c.recommended_fix}`);
      }
    } else {
      log.info("  Cốt truyện hoàn toàn nhất quán với các tập trước!");
    }

    // STEP 4: Multi-Character Audio Synthesis
    log.step(3, 8, "Sản xuất âm thanh: Đa giọng thoại nhân vật & SFX/BGM");
    let audioPath = job.audioPath;
    let audioDurationSec = 0;

    if (options.resume && audioPath && existsSync(audioPath)) {
      log.info(`  [RESUME] Sử dụng soundtrack đã có từ checkpoint: ${audioPath}`);
    } else {
      job.currentPhase = "audio";
      await this.saveCheckpoint(outputDir, job);

      const audioRes = await this.audioAssembler.assembleEpisodeAudio({
        script,
        bible: this.bible,
        outputDir,
        mockTts: options.mockTts || provider === "mock",
        overflowPolicy: options.overflowPolicy || "extend_shot",
        transitionDurationSec: options.transitionDurationSec || 0.0,
      });
      audioPath = audioRes.finalAudioPath;
      audioDurationSec = audioRes.totalDurationSec;
      job.audioPath = audioPath;
      await this.saveCheckpoint(outputDir, job);
      log.info(`  Tổng thời lượng âm thanh: ${audioRes.totalDurationSec.toFixed(2)}s (${audioRes.dialogueTracks.length} câu thoại, 4 stems tách biệt)`);

      // Update script shot durations if any were extended by overflow policy
      if (audioRes.unifiedTimeline) {
        for (const vShot of audioRes.unifiedTimeline.videoTrack) {
          for (const sc of script.scenes) {
            const sh = sc.shots.find((s) => s.shotId === vShot.shotId);
            if (sh && sh.durationSec !== vShot.durationSec) {
              sh.durationSec = vShot.durationSec;
            }
          }
        }
      }
    }

    // STEP 5: AI Video Generation & Shot Chaining
    log.step(4, 8, `Tạo các shot video qua AI Model Gateway (${provider})`);
    job.currentPhase = "video_generation";
    await this.saveCheckpoint(outputDir, job);

    const shotVideos: string[] = [];
    const videoShotsDir = join(outputDir, "shots");
    await mkdir(videoShotsDir, { recursive: true });

    for (const scene of script.scenes) {
      for (const shot of scene.shots) {
        const shotProg = job.shots[shot.shotId];
        // If resuming and shot is already completed and file exists, reuse it!
        if (
          options.resume &&
          shotProg &&
          (shotProg.status === "completed" || shotProg.status === "approved") &&
          shotProg.videoPath &&
          existsSync(shotProg.videoPath)
        ) {
          log.info(`  [RESUME] Shot [${shot.shotId}] đã hoàn thành, bỏ qua sinh lại.`);
          shotVideos.push(shotProg.videoPath);
          continue;
        }

        log.info(`  Đang sinh shot [${shot.shotId}] (${shot.durationSec}s): "${shot.visualPrompt.slice(0, 60)}..."`);
        shotProg.status = "generating";
        await this.saveCheckpoint(outputDir, job);

        // Handle shot chaining if duration > 5s
        const decomp = decomposeShotDuration(shot.shotId, shot.durationSec, { maxChunkSec: 5.0, crossfadeSec: 0.3 });
        const passVideos: string[] = [];

        for (const pass of decomp.passes) {
          const shotLocalPath = join(videoShotsDir, `${shot.shotId}_p${pass.passIndex}.mp4`);
          let firstFrameImage: string | undefined = undefined;
          if (pass.conditionFromPass && passVideos[pass.conditionFromPass - 1]) {
            const prevVideo = passVideos[pass.conditionFromPass - 1];
            const lastFramePath = prevVideo.replace(/\.mp4$/, "_lastframe.jpg");
            try {
              // Extract real final frame using FFmpeg (Rule 4)
              firstFrameImage = await extractLastFrame(prevVideo, lastFramePath);
            } catch (frameErr: any) {
              log.warn(`Không thể trích xuất frame cuối từ '${prevVideo}': ${frameErr.message}`);
              firstFrameImage = undefined;
            }
          }

          const spec: ShotExecutionSpec = {
            shotId: `${shot.shotId}_p${pass.passIndex}`,
            backend: provider,
            priority: shot.shotType === "close_up" || shot.shotType === "action" ? "hero" : "standard",
            durationSec: pass.durationSec,
            prompt: shot.visualPrompt,
            aspectRatio: script.aspectRatio,
            referenceImage: shot.referenceImage,
            firstFrameCondition: firstFrameImage,
            destinationLocalPath: shotLocalPath,
          };

          let shotResult: VideoJobStatus;
          try {
            const orchRes = await this.orchestrator.executeShot(
              seriesId,
              script.episodeNumber,
              spec,
              { destinationPath: shotLocalPath }
            );
            shotResult = {
              jobId: orchRes.providerJobId || orchRes.jobId,
              status: "completed",
              localPath: orchRes.videoPath,
              videoUrl: orchRes.videoUrl,
            };
          } catch (execErr: any) {
            if (provider !== "mock") {
              shotProg.status = "failed";
              shotProg.error = `Sinh shot qua provider '${provider}' thất bại: ${execErr.message}`;
              job.status = "failed";
              await this.saveCheckpoint(outputDir, job);
              throw new Error(
                `[PRODUCTION ERROR] Sinh shot [${spec.shotId}] thất bại trên provider '${provider}': ${execErr.message}`
              );
            }
            log.warn(`Execute shot [${spec.shotId}] thất bại trên provider '${provider}': ${execErr.message}`);
            shotResult = {
              jobId: `fallback_${spec.shotId}`,
              status: "failed",
              error: execErr.message,
            };
          }
          if (shotResult.localPath && shotResult.localPath !== shotLocalPath && existsSync(shotResult.localPath)) {
            await copyFile(shotResult.localPath, shotLocalPath);
          } else if (shotResult.videoUrl && !existsSync(shotLocalPath)) {
            try {
              await downloadVideoSafely(shotResult.videoUrl, shotLocalPath, {
                validateWithProbe: provider !== "mock",
              });
            } catch (dlErr: any) {
              if (provider !== "mock") {
                shotProg.status = "failed";
                shotProg.error = `Tải video thất bại: ${dlErr.message}`;
                job.status = "failed";
                job.currentPhase = "failed";
                await this.saveCheckpoint(outputDir, job);
                throw new Error(
                  `[PRODUCTION ERROR] Không thể tải video cho shot [${spec.shotId}] từ '${shotResult.videoUrl}': ${dlErr.message}`
                );
              }
              log.warn(`Không thể tải video từ URL ${shotResult.videoUrl}: ${dlErr.message}`);
            }
          }

          if (!existsSync(shotLocalPath)) {
            if (provider !== "mock") {
              shotProg.status = "failed";
              shotProg.error = `File video không tồn tại sau khi sinh từ provider '${provider}'`;
              job.status = "failed";
              job.currentPhase = "failed";
              await this.saveCheckpoint(outputDir, job);
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
              await this.saveCheckpoint(outputDir, job);
              throw new Error(
                `[PRODUCTION ERROR] Video cho shot [${spec.shotId}] bị hỏng hoặc thiếu video stream (ffprobe: ${probe.error})`
              );
            }
          }
          passVideos.push(shotLocalPath);
        }

        let resolvedShotPath = passVideos[0];
        // If multiple passes were generated, stitch them with standardized crossfade and normalization
        if (passVideos.length > 1 && !options.skipRender) {
          const stitchedShotPath = join(videoShotsDir, `${shot.shotId}.mp4`);
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
          } catch (stitchErr: any) {
            // Strictly do NOT silently fallback to passVideos[0] (Rule 8)
            shotProg.status = "failed";
            shotProg.error = `Lỗi FFmpeg khi ghép đa pass cho shot [${shot.shotId}]: ${stitchErr.message}`;
            await this.saveCheckpoint(outputDir, job);
            throw new Error(
              `[PRODUCTION ERROR] Không thể ghép các pass của shot [${shot.shotId}]: ${stitchErr.message}`
            );
          }
        }
        shotVideos.push(resolvedShotPath);

        // Look up approved storyboard keyframe for this shot (decoupled from character identity)
        const approvedSb = this.bible.getApprovedStoryboardForShot(seriesId, script.episodeNumber, shot.shotId);
        const storyboardKeyframeId = approvedSb?.id;
        const usedReferencesJson = approvedSb?.used_references_json || "[]";

        // Record Take into Story Bible SQLite
        const takeNumber = (shotProg?.allTakes?.length || 0) + 1;
        const takeNumStr = String(takeNumber).padStart(2, "0");
        const takeId = `${seriesId}_ep${epNumStr}_${shot.shotId}_take${takeNumStr}`;

        const existingApproved = this.bible.getApprovedTakeForShot(seriesId, script.episodeNumber, shot.shotId);
        const shouldAutoApprove = !existingApproved;

        this.bible.recordShotTake({
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
          cost_usd: 0,
          created_at: new Date().toISOString(),
        });
        if (shouldAutoApprove) {
          this.bible.approveShotTake(takeId);
        }

        // Update shot progress in job checkpoint
        job.shots[shot.shotId] = {
          shotId: shot.shotId,
          status: "completed",
          activeTakeId: takeId,
          allTakes: [...(shotProg?.allTakes || []), takeId],
          videoPath: resolvedShotPath,
          durationSec: shot.durationSec,
          retryCount: shotProg?.retryCount || 0,
        };
        await this.saveCheckpoint(outputDir, job);
      }
    }

    // STEP 6: Visual QA & Multi-Frame Continuity Evaluation
    log.step(5, 8, "Kiểm định nhất quán thị giác & Đa frame (Visual QA)");
    job.currentPhase = "qa_review";
    await this.saveCheckpoint(outputDir, job);

    const visualBackend = options.visualQaBackend ?? this.faceQa.backend;
    const backendStatus = await visualBackend.checkReadiness();
    log.info(`  Visual QA Backend: [${backendStatus.backendName}] Trạng thái: ${backendStatus.availability}`);
    log.info(`  Khẩu hình (Lip-sync): ${backendStatus.lipSyncStatus} (capability riêng biệt)`);

    if (options.styleCategory) {
      this.faceQa.setStyleCategory(options.styleCategory);
    }
    log.info(`  Phong cách hiệu chỉnh: [${this.faceQa.styleCategory}] (tPass=${this.faceQa.tPass}, tWarn=${this.faceQa.tWarn})`);

    if (options.faceQaThresholds) {
      if (options.faceQaThresholds.tPass !== undefined) this.faceQa.tPass = options.faceQaThresholds.tPass;
      if (options.faceQaThresholds.tWarn !== undefined) this.faceQa.tWarn = options.faceQaThresholds.tWarn;
      if (options.faceQaThresholds.maxReRolls !== undefined) this.faceQa.maxReRolls = options.faceQaThresholds.maxReRolls;
    }
    if (options.maxReRolls !== undefined) {
      this.faceQa.maxReRolls = options.maxReRolls;
    }

    const qaEvidenceDir = join(outputDir, "qa_evidence");
    await mkdir(qaEvidenceDir, { recursive: true });

    let faceQaPassedCount = 0;
    let faceQaWarnCount = 0;
    let faceQaFailCount = 0;
    let faceQaUnavailableCount = 0;
    let totalEvaluated = 0;

    for (const scene of script.scenes) {
      for (const shot of scene.shots) {
        if (!shot.characterId) continue;
        const char = this.bible.getCharacter(shot.characterId);
        const refImage = shot.referenceImage || char?.face_reference_image;
        if (!refImage) continue;

        totalEvaluated++;
        const activeTake = this.bible.getApprovedTakeForShot(seriesId, script.episodeNumber, shot.shotId);
        const videoPath = activeTake?.local_path || join(videoShotsDir, `${shot.shotId}.mp4`);

        let qaReport: ShotQaReport;

        // RULE: If Visual QA Backend is NOT_INSTALLED or UNAVAILABLE, NEVER forge PASS
        if (backendStatus.availability !== "AVAILABLE") {
          qaReport = {
            shotId: shot.shotId,
            characterId: shot.characterId,
            referenceAssetId: refImage,
            maxSimilarity: 0,
            status: "UNAVAILABLE",
            reRollAttempt: 0,
            shouldReRoll: false,
            styleCategory: this.faceQa.styleCategory,
            backendName: backendStatus.backendName,
            backendAvailability: backendStatus.availability,
            lipSyncStatus: backendStatus.lipSyncStatus,
            notes: `Visual QA Backend '${backendStatus.backendName}' không khả dụng (${backendStatus.availability}). Nghiêm cấm giả mạo PASS.`,
            reviewEscalation: {
              required: true,
              reason: "BACKEND_UNAVAILABLE",
              directorInstructions: "Backend QA vắng mặt hoặc chưa cài đặt. Không thể tự động đánh giá; chuyển sang duyệt thủ công.",
            },
            disclaimer: backendStatus.disclaimer,
          };
        } else if (options.faceFeatureExtractor) {
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
          qaReport = await this.faceQa.evaluateMultiFrame(
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
          const referenceEmbedding = generateDeterministicEmbedding(`char_${shot.characterId}`);
          qaReport = await this.faceQa.evaluateMultiFrame(
            shot.shotId,
            shot.characterId,
            extraction.frames,
            referenceEmbedding,
            backendStatus,
            refImage
          );
        }

        // Persist QA evidence report into Story Bible SQLite & filesystem
        const reportJsonStr = JSON.stringify(qaReport);
        await writeFile(join(qaEvidenceDir, `${shot.shotId}_qa.json`), JSON.stringify(qaReport, null, 2));

        if (activeTake) {
          this.bible.updateShotTakeQa(activeTake.id, {
            qa_status: qaReport.status,
            qa_score: qaReport.maxSimilarity,
            qa_notes: qaReport.notes,
            qa_report_json: reportJsonStr,
          });
        }

        if (qaReport.status === "PASS") {
          faceQaPassedCount++;
          log.info(`  ✅ Shot [${shot.shotId}]: Face QA PASS (Mean: ${qaReport.metrics?.meanSimilarity ?? qaReport.maxSimilarity} >= ${this.faceQa.tPass}, Stability: ${qaReport.metrics?.stabilityScore ?? 1.0})`);
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
          const currentSummary = this.bible.getSeriesCostAndTakesSummary(seriesId);
          const isBudgetExceeded = options.budgetCapUsd !== undefined && currentSummary.totalCostUsd >= options.budgetCapUsd;

          if (isBudgetExceeded) {
            log.warn(`  [BUDGET CAP] Chi phí series ($${currentSummary.totalCostUsd}) đạt trần ngân sách ($${options.budgetCapUsd}). Dừng tự động re-roll cho shot [${shot.shotId}].`);
            qaReport.shouldReRoll = false;
          }

          if (qaReport.shouldReRoll) {
            log.info(`  🔄 [AUTO RE-ROLL] Đang tự động tái tạo shot [${shot.shotId}] (lần ${qaReport.reRollAttempt}/${this.faceQa.maxReRolls})...`);
            const rerollRes = await this.rerollShot({
              seriesId,
              episodeNumber: script.episodeNumber,
              shotId: shot.shotId,
              outputDir,
              provider,
              remuxAfterReroll: false,
              budgetCapUsd: options.budgetCapUsd,
              preserveExistingApproval: true,
            });

            // Update shotVideos list with the new take path
            const shotIdx = shotVideos.findIndex((v) => {
              const base = basename(v, ".mp4");
              return base === shot.shotId || base.startsWith(`${shot.shotId}_`);
            });
            if (shotIdx >= 0) {
              shotVideos[shotIdx] = rerollRes.videoPath;
            }

            // Re-evaluate the new take
            let rerollFrames: FrameEvaluationSample[];
            let rerollRefEmb = generateDeterministicEmbedding(`char_${shot.characterId}`);
            if (options.faceFeatureExtractor) {
              const reExtracted = await options.faceFeatureExtractor(rerollRes.videoPath, refImage);
              rerollFrames = reExtracted.frameEmbeddings.map((emb, idx) => ({
                frameIndex: idx,
                timestampSec: idx * 0.5,
                detectedFaces: [{ box: [0, 0, 100, 100], confidence: 0.99, embedding: emb, faceAreaRatio: 0.08 }],
              }));
              if (reExtracted.referenceEmbedding) {
                rerollRefEmb = reExtracted.referenceEmbedding;
              }
            } else {
              const reExt = await visualBackend.extractFramesAndEmbeddings(rerollRes.videoPath, { sampleRateFps: 2, maxFrames: 8 });
              rerollFrames = reExt.frames;
            }

            const rerollQa = await this.faceQa.evaluateMultiFrame(
              shot.shotId,
              shot.characterId,
              rerollFrames,
              rerollRefEmb,
              backendStatus,
              refImage
            );

            this.bible.updateShotTakeQa(rerollRes.takeId, {
              qa_status: rerollQa.status,
              qa_score: rerollQa.maxSimilarity,
              qa_notes: rerollQa.notes,
              qa_report_json: JSON.stringify(rerollQa),
            });
            await writeFile(join(qaEvidenceDir, `${rerollRes.takeId}_qa.json`), JSON.stringify(rerollQa, null, 2));

            if (rerollQa.status === "PASS") {
              faceQaPassedCount++;
              this.bible.approveShotTake(rerollRes.takeId);
              if (job.shots[shot.shotId]) {
                job.shots[shot.shotId].activeTakeId = rerollRes.takeId;
                job.shots[shot.shotId].videoPath = rerollRes.videoPath;
              }
            }
          }
        }
      }
    }

    log.info(`  📊 Kết quả Face QA: ${faceQaPassedCount} PASS, ${faceQaWarnCount} WARN, ${faceQaFailCount} FAIL, ${faceQaUnavailableCount} UNAVAILABLE (Tổng số shot có nhân vật: ${totalEvaluated})`);

    // STEP 7: Master Assembly (Video Stitching + Audio Muxing)
    log.step(6, 8, "Hậu kỳ: Ghép shot xfade & mux soundtrack tổng thể");
    job.currentPhase = "timeline_assembly";
    await this.saveCheckpoint(outputDir, job);

    const finalVideoPath = join(outputDir, "video.mp4");

    if (!options.skipRender && provider !== "mock" && shotVideos.length > 0) {
      try {
        if (shotVideos.length === 1) {
          // Single-shot scene: direct mux, no -shortest used
          const singleShot = shotVideos[0];
          const ffmpegArgs = ["-y", "-i", singleShot];
          if (audioPath && existsSync(audioPath)) {
            ffmpegArgs.push(
              "-i", audioPath,
              "-c:v", "libx264", "-pix_fmt", "yuv420p",
              "-c:a", "aac", "-b:a", "192k",
              finalVideoPath
            );
          } else {
            ffmpegArgs.push("-c:v", "libx264", "-pix_fmt", "yuv420p", finalVideoPath);
          }
          await runFfmpeg(ffmpegArgs);
        } else {
          // Multi-shot scene: crossfade stitch filter, no -shortest used
          const durations = script.scenes.flatMap((s) => s.shots.map((sh) => sh.durationSec));
          const stitch = buildCrossfadeStitchFilter(shotVideos, durations, 0.4);
          const ffmpegArgs = ["-y"];
          for (const v of shotVideos) {
            ffmpegArgs.push("-i", v);
          }
          if (audioPath && existsSync(audioPath)) {
            ffmpegArgs.push("-i", audioPath);
            ffmpegArgs.push("-filter_complex", stitch.filterComplex);
            ffmpegArgs.push("-map", "[vout]", "-map", `${shotVideos.length}:a`);
            ffmpegArgs.push("-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k");
            ffmpegArgs.push(finalVideoPath);
          } else {
            ffmpegArgs.push("-filter_complex", stitch.filterComplex);
            ffmpegArgs.push("-map", "[vout]");
            ffmpegArgs.push("-c:v", "libx264", "-pix_fmt", "yuv420p");
            ffmpegArgs.push(finalVideoPath);
          }
          await runFfmpeg(ffmpegArgs);
        }

        // Validate final assembled video with ffprobe and check drift
        const probe = await probeVideoFile(finalVideoPath);
        if (!probe.isValid) {
          throw new Error(`Video sau khi ghép không hợp lệ (ffprobe: ${probe.error})`);
        }

        // Check audio-video drift without masking via -shortest
        if (audioPath && existsSync(audioPath)) {
          const fps = script.fps || 30;
          const frameTolSec = 1.0 / fps;
          const codecTolSec = 0.05; // ~50ms AAC/MP3 priming
          const maxTolSec = frameTolSec + codecTolSec;
          const drift = Math.abs(probe.durationSec - audioDurationSec);

          if (drift > maxTolSec) {
            const warnMsg = `[TIMELINE DRIFT] Phát hiện sai lệch hình-tiếng: Video=${probe.durationSec.toFixed(2)}s, Audio=${audioDurationSec.toFixed(2)}s (chênh lệch ${drift.toFixed(3)}s > dung sai ${maxTolSec.toFixed(3)}s).`;
            log.warn(warnMsg);
          } else {
            log.info(`  [TIMELINE SYNC] Độ chênh lệch hình-tiếng trong ngưỡng cho phép: ${(drift * 1000).toFixed(1)}ms (dung sai ${(maxTolSec * 1000).toFixed(1)}ms).`);
          }
          log.info("  [TIMELINE NOTE] Đã neo mốc thời gian audio đúng khung hình cú máy (Lưu ý: đây là timecode sync, không phải lip-sync khẩu hình).");
        }
      } catch (assembleErr: any) {
        // PRODUCTION ERROR: Do not swallow, do not replace with mock file!
        job.status = "failed";
        job.currentPhase = "failed";
        await this.saveCheckpoint(outputDir, job);
        throw new Error(`[PRODUCTION ERROR] Ghép nối và xuất xưởng video thất bại: ${assembleErr.message}`);
      }
    } else {
      await createValidMockMp4File(finalVideoPath, audioDurationSec || 15.0);
    }
    job.videoPath = finalVideoPath;
    await this.saveCheckpoint(outputDir, job);
    log.info(`  Video hoàn chỉnh: ${finalVideoPath}`);

    // STEP 8: Commit Narrative Delta to Story Bible
    log.step(7, 8, "Ghi nhận tiến trình cốt truyện vào Story Bible SQLite");
    let committedCanon = false;

    // Strict Canon Commit gating:
    // In production: commit automatically unless requireApproval or autoCommitCanon=false
    // In mock: do NOT commit unless commitCanon=true or allowMockCanonCommit=true
    const shouldCommit =
      provider !== "mock"
        ? (options.requireApproval !== true && options.autoCommitCanon !== false)
        : (options.commitCanon === true || options.allowMockCanonCommit === true || options.narrativeDelta !== undefined);

    if (shouldCommit) {
      const deltaObj = (options.narrativeDelta as any) || {};
      const majorEvents = deltaObj.majorEvents || deltaObj.major_events || [script.logline];
      const summaryRecord: EpisodeSummaryRecord = {
        episode_number: script.episodeNumber,
        title: script.title,
        logline: script.logline,
        major_events: majorEvents,
        delta_changes: deltaObj,
        created_at: new Date().toISOString(),
      };

      const delta: NarrativeDelta = options.narrativeDelta || {
        major_events: [script.logline],
      };

      this.bible.commitEpisode(summaryRecord, delta);
      committedCanon = true;
      job.status = "completed";
      job.currentPhase = "committed";
      log.info("  Story Bible đã được cập nhật trạng thái mới cho các tập kế tiếp!");
    } else {
      job.status = "completed";
      job.currentPhase = provider === "mock" ? "mock_completed" : "assembled_pending_review";
      if (provider === "mock") {
        log.info("  [MOCK MODE] Bỏ qua commit Story Bible vì đang ở chế độ mock. Giữ nguyên trạng thái canon hiện tại.");
      } else {
        log.info("  [APPROVAL REQUIRED] Bản dựng đã hoàn tất nhưng chưa commit Story Bible (chờ đạo diễn phê duyệt).");
      }
    }

    await this.saveCheckpoint(outputDir, job);

    log.step(8, 8, `HOÀN THÀNH TẬP ${script.episodeNumber}!`);
    return {
      episodeNumber: script.episodeNumber,
      title: script.title,
      script,
      videoPath: finalVideoPath,
      audioPath: audioPath || "",
      outputDir,
      auditPassed,
      isMock: provider === "mock",
      committedCanon,
    };
  }

  /**
   * Remuxes the full episode video from existing approved shot videos and audio soundtrack
   * without re-calling TTS or AI Video models.
   */
  public async remuxEpisode(options: {
    seriesId: string;
    episodeNumber: number;
    outputDir?: string;
    skipRender?: boolean;
  }): Promise<{ videoPath: string; audioPath: string }> {
    const epNumStr = String(options.episodeNumber).padStart(2, "0");
    const outputDir =
      options.outputDir || join("output", "series", options.seriesId, `ep-${epNumStr}`);
    const scriptPath = join(outputDir, "script-normalized.json");
    if (!existsSync(scriptPath)) {
      throw new Error(`Không tìm thấy kịch bản chuẩn hóa tại: ${scriptPath}`);
    }

    const script: EpisodicScript = JSON.parse(await readFile(scriptPath, "utf8"));
    const job = await this.loadCheckpoint(outputDir);

    const shotVideos: string[] = [];
    for (const scene of script.scenes) {
      for (const shot of scene.shots) {
        let videoPath: string | undefined = undefined;

        // 1. Prioritize director-approved take from Story Bible
        const approved = this.bible.getApprovedTakeForShot(
          options.seriesId,
          options.episodeNumber,
          shot.shotId
        );
        if (approved?.local_path && existsSync(approved.local_path)) {
          videoPath = approved.local_path;
        } else if (job?.shots[shot.shotId]?.videoPath && existsSync(job.shots[shot.shotId].videoPath)) {
          // 2. Fallback to cached checkpoint video path
          videoPath = job.shots[shot.shotId].videoPath;
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
    log.info(`\n=== REMUX TẬP ${options.episodeNumber}: Ghép ${shotVideos.length} shots với soundtrack ===`);

    if (!options.skipRender && shotVideos.length > 0) {
      try {
        if (shotVideos.length === 1) {
          // Single-shot scene: direct mux without filter_complex, no -shortest
          const singleShot = shotVideos[0];
          const ffmpegArgs = ["-y", "-i", singleShot];
          if (existsSync(audioPath)) {
            ffmpegArgs.push(
              "-i", audioPath,
              "-c:v", "libx264", "-pix_fmt", "yuv420p",
              "-c:a", "aac", "-b:a", "192k",
              finalVideoPath
            );
          } else {
            ffmpegArgs.push("-c:v", "libx264", "-pix_fmt", "yuv420p", finalVideoPath);
          }
          await runFfmpeg(ffmpegArgs);
        } else {
          // Multi-shot scene: crossfade stitch, no -shortest
          const durations = script.scenes.flatMap((s) => s.shots.map((sh) => sh.durationSec));
          const stitch = buildCrossfadeStitchFilter(shotVideos, durations, 0.4);
          const ffmpegArgs = ["-y"];
          for (const v of shotVideos) {
            ffmpegArgs.push("-i", v);
          }
          if (existsSync(audioPath)) {
            ffmpegArgs.push("-i", audioPath);
            ffmpegArgs.push("-filter_complex", stitch.filterComplex);
            ffmpegArgs.push("-map", "[vout]", "-map", `${shotVideos.length}:a`);
            ffmpegArgs.push("-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k");
            ffmpegArgs.push(finalVideoPath);
          } else {
            ffmpegArgs.push("-filter_complex", stitch.filterComplex);
            ffmpegArgs.push("-map", "[vout]");
            ffmpegArgs.push("-c:v", "libx264", "-pix_fmt", "yuv420p");
            ffmpegArgs.push(finalVideoPath);
          }
          await runFfmpeg(ffmpegArgs);
        }

        const probe = await probeVideoFile(finalVideoPath);
        if (!probe.isValid) {
          throw new Error(`Video sau khi remux không hợp lệ (ffprobe: ${probe.error})`);
        }
      } catch (remuxErr: any) {
        throw new Error(`Remux thất bại: ${remuxErr.message}`);
      }
    } else {
      await createValidMockMp4File(finalVideoPath, 15.0);
    }

    if (job) {
      job.videoPath = finalVideoPath;
      job.updatedAt = new Date().toISOString();
      await this.saveCheckpoint(outputDir, job);
    }

    log.info(`✅ Remux hoàn tất: ${finalVideoPath}`);
    return { videoPath: finalVideoPath, audioPath };
  }

  /**
   * Re-generates a single shot without re-generating any other shot in the episode.
   * Records a new take in Story Bible SQLite, updates the active take, and remuxes the episode.
   */
  public async rerollShot(options: {
    seriesId: string;
    episodeNumber: number;
    shotId: string;
    provider?: BackendProvider;
    outputDir?: string;
    promptOverride?: string;
    remuxAfterReroll?: boolean;
    budgetCapUsd?: number;
    preserveExistingApproval?: boolean;
    forceApprove?: boolean;
  }): Promise<{ shotId: string; takeId: string; videoPath: string; isApproved: boolean }> {
    const provider = options.provider || "mock";
    const epNumStr = String(options.episodeNumber).padStart(2, "0");
    const outputDir =
      options.outputDir || join("output", "series", options.seriesId, `ep-${epNumStr}`);
    const scriptPath = join(outputDir, "script-normalized.json");
    if (!existsSync(scriptPath)) {
      throw new Error(`Không tìm thấy kịch bản tập tại: ${scriptPath}`);
    }

    const script: EpisodicScript = JSON.parse(await readFile(scriptPath, "utf8"));
    const shot = script.scenes.flatMap((s) => s.shots).find((sh) => sh.shotId === options.shotId);
    if (!shot) {
      throw new Error(`Không tìm thấy shot [${options.shotId}] trong kịch bản tập ${options.episodeNumber}`);
    }

    if (options.budgetCapUsd !== undefined) {
      const summary = this.bible.getSeriesCostAndTakesSummary(options.seriesId);
      if (summary.totalCostUsd >= options.budgetCapUsd) {
        throw new Error(
          `[BUDGET CAP REACHED] Chi phí tích lũy của series ($${summary.totalCostUsd.toFixed(4)}) đã chạm hoặc vượt trần ngân sách ($${options.budgetCapUsd.toFixed(4)}). Dừng tự động tái tạo shot.`
        );
      }
    }

    log.info(`\n=== TÁI TẠO SHOT [${options.shotId}] (Provider: ${provider}) ===`);
    const job = (await this.loadCheckpoint(outputDir)) || {
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

    const existingTakes = this.bible.listShotTakes(
      options.seriesId,
      options.episodeNumber,
      options.shotId
    );
    const takeNumber = existingTakes.length + 1;
    const takeNumStr = String(takeNumber).padStart(2, "0");
    const takeId = `${options.seriesId}_ep${epNumStr}_${options.shotId}_take${takeNumStr}`;
    const videoShotsDir = join(outputDir, "shots");
    await mkdir(videoShotsDir, { recursive: true });
    const takeLocalPath = join(videoShotsDir, `${options.shotId}_take${takeNumStr}.mp4`);

    const prompt = options.promptOverride || shot.visualPrompt;
    log.info(`  Đang sinh Take ${takeNumber}: "${prompt.slice(0, 60)}..."`);

    const spec: ShotExecutionSpec = {
      shotId: `${options.shotId}_take${takeNumStr}`,
      backend: provider,
      priority: "hero",
      durationSec: shot.durationSec,
      prompt,
      aspectRatio: script.aspectRatio,
      referenceImage: shot.referenceImage,
      destinationLocalPath: takeLocalPath,
    };

    let result: VideoJobStatus;
    try {
      const orchRes = await this.orchestrator.executeShot(
        options.seriesId,
        options.episodeNumber,
        spec,
        { destinationPath: takeLocalPath, forceReRender: true }
      );
      result = {
        jobId: orchRes.providerJobId || orchRes.jobId,
        status: "completed",
        localPath: orchRes.videoPath,
        videoUrl: orchRes.videoUrl,
      };
    } catch (execErr: any) {
      if (provider !== "mock") {
        throw execErr;
      }
      log.warn(`Execute reroll shot [${options.shotId}] thất bại trên provider '${provider}': ${execErr.message}`);
      result = await this.gateway.executeShot(spec, takeLocalPath);
    }
    if (result.localPath && result.localPath !== takeLocalPath && existsSync(result.localPath)) {
      await copyFile(result.localPath, takeLocalPath);
    } else if (result.videoUrl && !existsSync(takeLocalPath)) {
      try {
        await downloadVideoSafely(result.videoUrl, takeLocalPath, {
          validateWithProbe: provider !== "mock",
        });
      } catch (dlErr: any) {
        if (provider !== "mock") {
          throw new Error(
            `[PRODUCTION ERROR] Không thể tải video take mới cho shot [${options.shotId}]: ${dlErr.message}`
          );
        }
        log.warn(`Không thể tải video từ URL ${result.videoUrl}: ${dlErr.message}`);
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
    const existingApproved = this.bible.getApprovedTakeForShot(
      options.seriesId,
      options.episodeNumber,
      options.shotId
    );

    const shouldApproveNewTake =
      options.forceApprove || (options.preserveExistingApproval !== true && !existingApproved);

    // Look up approved storyboard keyframe
    const approvedSb = this.bible.getApprovedStoryboardForShot(
      options.seriesId,
      options.episodeNumber,
      options.shotId
    );

    // Record new take in Bible SQLite
    this.bible.recordShotTake({
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
      cost_usd: 0,
      created_at: new Date().toISOString(),
    });

    if (shouldApproveNewTake) {
      this.bible.approveShotTake(takeId);
      log.info(`  Take mới [${takeId}] đã được kích hoạt làm take chính thức.`);
    } else {
      log.info(`  Bảo lưu take đã duyệt trước đó [${existingApproved?.id}]; Take mới [${takeId}] được lưu trữ an toàn chờ review.`);
    }

    // Update job checkpoint
    const currentShotProg = job.shots[options.shotId] || {
      shotId: options.shotId,
      status: "pending" as const,
      allTakes: [],
      retryCount: 0,
    };
    job.shots[options.shotId] = {
      ...currentShotProg,
      status: "completed" as const,
      activeTakeId: shouldApproveNewTake ? takeId : (currentShotProg.activeTakeId || existingApproved?.id || takeId),
      allTakes: [...currentShotProg.allTakes, takeId],
      videoPath: shouldApproveNewTake ? takeLocalPath : (currentShotProg.videoPath || existingApproved?.local_path || takeLocalPath),
      durationSec: shot.durationSec,
      retryCount: (currentShotProg.retryCount || 0) + 1,
    };
    job.updatedAt = new Date().toISOString();
    await this.saveCheckpoint(outputDir, job);

    log.info(`✅ Tái tạo shot [${options.shotId}] thành công: Take ID ${takeId}`);
    log.info(`   File: ${takeLocalPath} (Đã duyệt: ${shouldApproveNewTake})`);

    if (options.remuxAfterReroll !== false) {
      await this.remuxEpisode({
        seriesId: options.seriesId,
        episodeNumber: options.episodeNumber,
        outputDir,
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
