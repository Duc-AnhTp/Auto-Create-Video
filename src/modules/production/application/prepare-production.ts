import {checkExecution} from './execution-control.js';
import {errorMessage} from "../../../platform/workflow-error.js";
import { WorkflowError } from "../../../platform/workflow-error.js";

import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { type BackendProvider } from "../../../contracts/video.js";

import { resolveExecutionPolicy } from "../domain/execution-policy.js";

import { log } from "../../../platform/observability/logger.js";

import { CinematicDirectorEngine } from "../../media/index.js";

import type { EpisodeDependencies } from "../ports/episode-dependencies.js";
import { DynamicPacingCalculator } from "../../media/index.js";
import { type EpisodeOptions } from "../ports/episode-options.js";
import { normalizeScript } from "../../story/index.js";
import { resolveEffectiveRenderConfig } from "../../media/index.js";
import { type EpisodeProductionJob } from "../../../contracts/episode.js";
import type { PrepareProductionInput, PrepareProductionOutput } from "./phases/contracts.js";
export class PrepareProduction {
constructor(private dependencies:Pick<EpisodeDependencies,"bible"|"checkpoints">){}
async execute(input:PrepareProductionInput,options:EpisodeOptions):Promise<PrepareProductionOutput> {
const ctx=this.dependencies;
let rawScriptTextOrPath = input.rawScriptTextOrPath;
const isDryRun = Boolean(options.dryRun);
    const policy=resolveExecutionPolicy(isDryRun||!options.provider||options.provider==="mock"?"mock":"production",options.provider);
    const provider=policy.provider as BackendProvider;
    const mockTts = Boolean(options.mockTts || isDryRun || provider === "mock");
    log.info(`\n=== BẮT ĐẦU SẢN XUẤT TẬP PHIM (Provider: ${provider}${isDryRun ? " [DRY-RUN]" : ""}) ===`);

    // STEP 1: Load Raw Script
    let rawContent = rawScriptTextOrPath;
    if (existsSync(rawScriptTextOrPath)) {
      rawContent = await readFile(rawScriptTextOrPath, "utf8");
    }

    // STEP 2: Normalize & Enrich Script with Bible Memory
    log.step(1, 8, "Chuẩn hóa kịch bản & Liên kết bộ nhớ Story Bible");
    await checkExecution(options);
    options.onProgress?.(1, 8, "Chuẩn hóa kịch bản & Liên kết bộ nhớ Story Bible");
    const script = await normalizeScript(rawContent, ctx.bible, {
      seriesId: options.seriesId,
      skipAudit: options.skipAudit,
      strictCharacters: options.strictCharacters,
      characterMapping: options.characterMapping,
    });
    if (options.expectedEpisodeNumber !== undefined && script.episodeNumber !== options.expectedEpisodeNumber) {
      throw new WorkflowError("EPISODE_NUMBER_MISMATCH", "EPISODE_NUMBER_MISMATCH: Kịch bản không khớp tập được yêu cầu.", "failed");
    }
    const seriesId = options.seriesId || script.seriesId || "default-series";
    log.info(`  Tập ${script.episodeNumber}: "${script.title}" (${script.scenes.length} cảnh)`);

    // STEP 2b: Visual Pacing Analysis (ASD, CPM, Dynamism Score)
    let pacingReport: import("../../media/index.js").EpisodePacingReport | undefined = undefined;
    try {
      pacingReport = DynamicPacingCalculator.analyzeScriptPacing(script);
      log.info(
        `  ⏱️ [PACING ANALYSIS] ASD: ${pacingReport.overallAverageShotDurationSec}s | CPM: ${pacingReport.overallCutsPerMinute} cuts/min | Dynamism: ${pacingReport.pacingDynamismScore.toFixed(2)}`
      );
      if (pacingReport.warnings.length > 0) {
        for (const w of pacingReport.warnings) {
          log.warn(`  ⚠️ [PACING WARNING] ${w}`);
        }
      }
    } catch (pacingErr: unknown) {
      log.warn(`  [PACING ANALYSIS] Không thể phân tích nhịp dựng: ${errorMessage(pacingErr)}`);
    }

    // STEP 2c: Cinematic Directing & 180-Degree Spatial Axis Enforcement (Phase 1)
    if (options.cinematicDirecting !== false) {
      try {
        let axisAdjustedCount = 0;
        let foleyAddedCount = 0;
        for (const scene of script.scenes) {
          if (scene.charactersPresent && scene.charactersPresent.length >= 2) {
            const chars = scene.charactersPresent.map((cp) => {
              const charId = typeof cp === "string" ? cp : cp.characterId;
              const charRec = ctx.bible.getCharacter(charId, seriesId);
              return { id: charId, name: charRec?.name || charId };
            });
            const prevShots = scene.shots;
            scene.shots = CinematicDirectorEngine.enforce180DegreeAxis(scene.shots, chars);
            if (scene.shots !== prevShots) {
              axisAdjustedCount++;
            }
          }
          // Detect Action Foley for shots missing sfxCue & assign spatial panning
          for (const shot of scene.shots) {
            if (!shot.sfxCue) {
              const promptForFoley =
                shot.visualPrompt + (shot.dialogues?.[0]?.text ? ` ${shot.dialogues[0].text}` : "");
              const foley = CinematicDirectorEngine.detectActionFoley(promptForFoley);
              if (foley) {
                let pan: number | undefined = undefined;
                if (
                  shot.visualPrompt.includes("bên trái") ||
                  shot.visualPrompt.includes("tiền cảnh bên trái")
                ) {
                  pan = -0.25;
                } else if (
                  shot.visualPrompt.includes("bên phải") ||
                  shot.visualPrompt.includes("tiền cảnh bên phải")
                ) {
                  pan = 0.25;
                }
                shot.sfxCue = {
                  ...foley,
                  ...(pan !== undefined ? { pan } : {}),
                  description: promptForFoley,
                };
                foleyAddedCount++;
              }
            } else if (shot.sfxCue && shot.sfxCue.pan === undefined) {
              if (
                shot.visualPrompt.includes("bên trái") ||
                shot.visualPrompt.includes("tiền cảnh bên trái")
              ) {
                shot.sfxCue.pan = -0.25;
              } else if (
                shot.visualPrompt.includes("bên phải") ||
                shot.visualPrompt.includes("tiền cảnh bên phải")
              ) {
                shot.sfxCue.pan = 0.25;
              }
            }
          }
        }
        if (axisAdjustedCount > 0 || foleyAddedCount > 0) {
          log.info(
            `  🎬 [CINEMATIC DIRECTING] Áp dụng trục 180° cho ${axisAdjustedCount} cảnh đối thoại, tự động bổ sung ${foleyAddedCount} Foley SFX cues.`
          );
        }
      } catch (dirErr: unknown) {
        log.warn(`  [CINEMATIC DIRECTING] Không thể tối ưu trục quay: ${errorMessage(dirErr)}`);
      }
    }

    // Story beat coverage tracking
// Determine Output Directory
    const epNumStr = String(script.episodeNumber).padStart(2, "0");
    const outputDir = options.outputDir || join("output", "series", seriesId, `ep-${epNumStr}`);
    await mkdir(outputDir, { recursive: true });

    // Save normalized script spec
    await writeFile(join(outputDir, "script-normalized.json"), JSON.stringify(script, null, 2));

    // Initialize or Resume Production Job Checkpoint
    let job: EpisodeProductionJob | null = null;
    if (options.resume) {
      job = await ctx.checkpoints.load(outputDir);
      if (job) {
        log.info(`  [RESUME] Khôi phục tiến trình sản xuất từ checkpoint (${Object.keys(job.shots).length} shots)`);
      }
    }

    const seriesMeta = ctx.bible.getSeriesMetadata(seriesId);
    const effectiveConfig = resolveEffectiveRenderConfig(
      {
        transitionDurationSec: options.transitionDurationSec,
        fps: options.fps,
        aspectRatio: options.aspectRatio,
        overflowPolicy: options.overflowPolicy,
      },
      job ?? undefined,
      seriesMeta ?? undefined,
      {
        aspectRatio: script.aspectRatio,
        fps: script.fps,
      }
    );

    if (!job) {
      job = {
        jobId: `job_${seriesId}_ep${epNumStr}_${Date.now()}`,
        seriesId,
        episodeNumber: script.episodeNumber,
        title: script.title,
        status: "in_progress",
        currentPhase: "init",
        shots: {},
        transitionDurationSec: effectiveConfig.transitionDurationSec,
        effectiveRenderConfig: effectiveConfig,
        specHash: options.specHash,
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
      job.shotProgress = script.scenes.flatMap((s) => s.shots).map((sh) => job!.shots[sh.shotId]).filter(Boolean);
      await ctx.checkpoints.save(outputDir, job);
    } else {
      if (options.specHash) {
        job.specHash = options.specHash;
      }
      job.transitionDurationSec = effectiveConfig.transitionDurationSec;
      job.effectiveRenderConfig = effectiveConfig;
      job.shotProgress = script.scenes.flatMap((s) => s.shots).map((sh) => {
        if (!job!.shots[sh.shotId]) {
          job!.shots[sh.shotId] = {
            shotId: sh.shotId,
            status: "pending",
            allTakes: [],
            durationSec: sh.durationSec,
            retryCount: 0,
          };
        }
        return job!.shots[sh.shotId];
      }).filter(Boolean);
      await ctx.checkpoints.save(outputDir, job);
    }

    // STEP 3: Continuity Audit Check
    log.step(2, 8, "Rà soát tính liên tục cốt truyện (Continuity Audit)");
    await checkExecution(options);
    options.onProgress?.(2, 8, "Rà soát tính liên tục cốt truyện (Continuity Audit)");
    job.currentPhase = "audit";
    await ctx.checkpoints.save(outputDir, job);

    const auditRes = await ctx.bible.auditDraftScript(script.episodeNumber, rawContent);
    const auditPassed = auditRes.audit_status === "PASS";
    if (auditRes.contradictions.length > 0) {
      log.warn(`  Tìm thấy ${auditRes.contradictions.length} điểm cần lưu ý về cốt truyện`);
      for (const c of auditRes.contradictions) {
        log.warn(`    - [${c.severity}] ${c.description} -> Khắc phục: ${c.recommended_fix}`);
      }
    } else {
      log.info("  Cốt truyện hoàn toàn nhất quán với các tập trước!");
    }

return {script, job, effectiveConfig, outputDir, provider, seriesId, pacingReport, mockTts, auditPassed};
}
}
