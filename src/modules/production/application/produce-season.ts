import type {ProduceSeasonStore} from '../ports/produce-season-store.js';
import type {EpisodeExecutor} from '../ports/episode-executor.js';
import type {EpisodeOptions} from '../ports/episode-options.js';
import type { EpisodeExecutionStatus, SeasonProgress, SeasonProductionResult } from "../../../contracts/season.js";
export * from "../../../contracts/season.js";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createHash } from "node:crypto";
import { type SeriesPlanRecord, type PlannedEpisodeRecord } from "../../../contracts/story.js";
import { StoryToScreenplayGenerator } from "../../story/index.js";
import { SeriesPlanner } from "../../story/index.js";
import { BudgetLedger } from "./dispatch/budget-ledger.js";
import type { BackendProvider } from "../../../contracts/video.js";
import { probeVideoFile } from "../../media/index.js";
import { log } from "../../../platform/observability/logger.js";

export interface SeasonOrchestratorOptions {
  regenerateAudio?: boolean;
  seriesId: string;
  planId?: string;
  fromEpisode?: number;
  toEpisode?: number;
  episodes?: number[];
  outputBaseDir?: string;
  provider?: BackendProvider;
  dryRun?: boolean;
  mockTts?: boolean;
  ttsProvider?: string;
  allowMockMedia?: boolean;
  skipAudit?: boolean;
  skipRender?: boolean;
  resume?: boolean;
  budgetCapUsd?: number;
  hedge?:EpisodeOptions["hedge"];
  commitCanon?: boolean;
  continueOnError?: boolean;
  useHierarchicalAssembly?: boolean;
  transitionDurationSec?: number;
  customLlmInvoker?: (prompt: string, systemPrompt?: string) => Promise<string>;
  checkpoint?: () => Promise<void>;
  requireApproval?: boolean;
  onEpisodeComplete?: (epResult: EpisodeExecutionStatus) => void;
}

/**
 * SeasonOrchestrator
 *
 * Coordinates multi-episode production batches across an entire season plan.
 * Integrates EpisodeExecutor, StoryToScreenplayGenerator, BudgetLedger, and
 * resilient checkpoint resumption with error isolation and budget caps.
 */
export class ProduceSeason {
  private bible: ProduceSeasonStore;
  private pipeline: EpisodeExecutor;
  private screenplayGenerator: Pick<StoryToScreenplayGenerator,'generateEpisodeFromPlan'>;
  private budgetLedger: Pick<BudgetLedger,'getLedgerSummary'>;

  constructor(dependencies:{bible:ProduceSeasonStore;pipeline:EpisodeExecutor;screenplayGenerator:Pick<StoryToScreenplayGenerator,'generateEpisodeFromPlan'>;budgetLedger:Pick<BudgetLedger,'getLedgerSummary'>}){this.bible=dependencies.bible;this.pipeline=dependencies.pipeline;this.screenplayGenerator=dependencies.screenplayGenerator;this.budgetLedger=dependencies.budgetLedger;}

  public getBible(): ProduceSeasonStore {
    return this.bible;
  }

  public getPipeline(): EpisodeExecutor {
    return this.pipeline;
  }

  /**
   * Computes composite specHash for an episode based on:
   * source hash + plan hash + script hash + prior canon version + provider config (PR6).
   *
   * NOTE: Adding new configuration dimensions to providerConfig (e.g. ttsProvider,
   * allowMockMedia) intentionally invalidates any pre-existing cached specHashes.
   * This is correct behaviour — cached episodes produced without those options
   * cannot be assumed equivalent. On first run after an upgrade that adds new
   * dimensions, all episodes will be re-generated, which is the safe default.
   */
  public computeEpisodeSpecHash(
    seriesId: string,
    planId: string,
    plannedEp: PlannedEpisodeRecord,
    options: SeasonOrchestratorOptions,
    epOutputDir?: string
  ): string {
    const canonHistory = this.bible.getCanonHistory(seriesId);
    const priorCanonVersion = canonHistory
      .filter((c) => c.episode_number < plannedEp.episode_number)
      .map((c) => `${c.episode_number}:${c.title}:${c.created_at || ""}`)
      .join(";");

    const providerConfig = [
      options.provider || "mock",
      options.skipRender ? "skipRender" : "render",
      options.dryRun ? "dryRun" : "live",
      options.transitionDurationSec ?? 0,
      options.useHierarchicalAssembly ?? true,
      options.mockTts ? "mockTts" : "realTts",
      options.ttsProvider || "default",
      options.allowMockMedia ? "allowMockMedia" : "strictMedia",
    ].join("|");

    let scriptHash = "";
    if (epOutputDir) {
      const screenplayPath = join(epOutputDir, "screenplay.txt");
      if (existsSync(screenplayPath)) {
        try {
          const content = readFileSync(screenplayPath, "utf8");
          scriptHash = createHash("sha256").update(content).digest("hex").slice(0, 16);
        } catch {
          scriptHash = "";
        }
      }
    }

    const payload = [
      seriesId,
      planId,
      plannedEp.id,
      plannedEp.episode_number,
      plannedEp.logline || "",
      plannedEp.dependencies_json || "",
      plannedEp.target_duration_sec,
      priorCanonVersion,
      providerConfig,
      scriptHash,
    ].join("::");

    return createHash("sha256").update(payload).digest("hex").slice(0, 32);
  }

  /**
   * Produces a full season or selected range of episodes.
   */
  public async produceSeason(
    options: SeasonOrchestratorOptions
  ): Promise<SeasonProductionResult> {
    const { seriesId } = options;

    // 1. Resolve Series Plan
    let plan: SeriesPlanRecord | null = null;
    if (options.planId) {
      plan = this.bible.getSeriesPlan(options.planId);
    } else {
      const allPlans = this.bible.listSeriesPlans(seriesId);
      // Prioritize active, then approved, before falling back to latest revision
      plan =
        allPlans.find((p) => p.status === "active") ||
        allPlans.find((p) => p.status === "approved") ||
        this.bible.getActiveSeriesPlan(seriesId) ||
        (allPlans.length > 0 ? allPlans[0] : null);
    }

    if (!plan) {
      throw new Error(
        `No adaptation plan found for series '${seriesId}'. Run 'series:plan-series' first.`
      );
    }

    // Gating: ensure plan is approved or active before production starts
    SeriesPlanner.ensurePlanApprovedForProduction(
      plan,
      options.provider === "mock" || options.dryRun === true
    );

    const planId = plan.id;
    const allPlannedEpisodes = this.bible.listPlannedEpisodes(planId);
    if (allPlannedEpisodes.length === 0) {
      throw new Error(`Plan '${planId}' contains no planned episodes.`);
    }

    // Sort episodes monotonically
    allPlannedEpisodes.sort((a, b) => a.episode_number - b.episode_number);

    // 2. Determine target episode numbers
    let targetEpisodes: PlannedEpisodeRecord[] = [...allPlannedEpisodes];
    if (options.episodes && options.episodes.length > 0) {
      targetEpisodes = allPlannedEpisodes.filter((ep) =>
        options.episodes!.includes(ep.episode_number)
      );
    } else {
      if (options.fromEpisode !== undefined) {
        targetEpisodes = targetEpisodes.filter(
          (ep) => ep.episode_number >= options.fromEpisode!
        );
      }
      if (options.toEpisode !== undefined) {
        targetEpisodes = targetEpisodes.filter(
          (ep) => ep.episode_number <= options.toEpisode!
        );
      }
    }

    if (targetEpisodes.length === 0) {
      const requestedDesc = options.episodes?.length
        ? `[${options.episodes.join(", ")}]`
        : `${options.fromEpisode ?? "start"}..${options.toEpisode ?? "end"}`;
      throw new Error(
        `EPISODE_RANGE_NOT_FOUND: Không có tập nào phù hợp với khoảng yêu cầu (${requestedDesc}). Kế hoạch chỉ có các tập: [${allPlannedEpisodes.map((e) => e.episode_number).join(", ")}].`
      );
    }

    const outputBase =
      options.outputBaseDir || join("data", "series", seriesId, "season_output");
    await mkdir(outputBase, { recursive: true });

    const continueOnError = options.continueOnError ?? true;
    const resume = options.resume ?? true;

    // Setup Progress Tracking
    const episodeStatuses: EpisodeExecutionStatus[] = targetEpisodes.map((ep) => ({
      episodeNumber: ep.episode_number,
      title: ep.title,
      status: "pending",
    }));

    let totalDurationSec = 0;
    let completedCount = 0;
    let failedCount = 0;
    let skippedCount = 0;
    let needsReviewCount = 0;

    log.info(
      `🎬 [SEASON ORCHESTRATOR] Bắt đầu sản xuất Season cho series '${seriesId}'. Tổng: ${targetEpisodes.length} tập.`
    );

    // 3. Sequential Execution Loop with Error Isolation & Budget Enforcement
    for (let i = 0; i < targetEpisodes.length; i++) {
      const plannedEp = targetEpisodes[i];
      const epStatus = episodeStatuses[i];
      const epNum = plannedEp.episode_number;
      const epOutputDir = join(outputBase, `ep_${String(epNum).padStart(2, "0")}`);

      epStatus.startedAt = new Date().toISOString();

      // Check Budget Cap before starting episode
      const currentBudgetUsage = this.bible.getSeriesBudgetLedger(seriesId);
      const budgetCap = options.budgetCapUsd;
      if (budgetCap !== undefined && currentBudgetUsage.confirmedCostUsd >= budgetCap) {
        log.warn(
          `🛑 [BUDGET CAP EXCEEDED] Ngân sách đã chi ($${currentBudgetUsage.confirmedCostUsd.toFixed(
            2
          )}) đạt hoặc vượt giới hạn $${budgetCap.toFixed(2)}. Dừng sản xuất các tập còn lại.`
        );
        epStatus.status = "budget_exceeded";
        epStatus.error = `Budget cap of $${budgetCap} reached.`;
        for (let j = i + 1; j < episodeStatuses.length; j++) {
          episodeStatuses[j].status = "budget_exceeded";
          episodeStatuses[j].error = `Skipped due to budget cap.`;
        }
        break;
      }

      // Compute specHash for versioned resume gating (PR6)
      const currentSpecHash = this.computeEpisodeSpecHash(
        seriesId,
        planId,
        plannedEp,
        options,
        epOutputDir
      );

      // Check Resumability: if episode was already completed and resume is true
      if (resume) {
        const existingCheckpoint = await this.pipeline.loadCheckpoint(epOutputDir);
        // Fail-closed: must have a valid specHash that matches current specHash
        const specMatches =
          Boolean(existingCheckpoint?.specHash && existingCheckpoint.specHash === currentSpecHash);

        const isCanonCommitted =
          existingCheckpoint?.canonCommitted === true ||
          existingCheckpoint?.currentPhase === "committed" ||
          options.dryRun === true ||
          options.provider === "mock";

        const mediaReadyButCanonPending = Boolean(
          existingCheckpoint &&
            !isCanonCommitted &&
            (existingCheckpoint.status === "completed" ||
              existingCheckpoint.currentPhase === "assembled_pending_review")
        );
        if (mediaReadyButCanonPending) {
          log.warn(
            `⚠️ [SEASON RESUME CANON GATE] Tập ${epNum} ('${plannedEp.title}') đã hoàn tất media nhưng canon chưa được commit vào Story Bible. Cần rà soát trước khi tiếp tục.`
          );
          epStatus.status = "needs_review";
          epStatus.outputPath = join(epOutputDir, "final_episode.mp4");
          epStatus.error = "CANON_UNCOMMITTED: Episode assembled but pending canon review";
          needsReviewCount++;
          if (!continueOnError) break;
          continue;
        }

        if (
          existingCheckpoint &&
          specMatches &&
          (existingCheckpoint.status === "completed" ||
            (options.skipRender && existingCheckpoint.status === "unrendered"))
        ) {
          const candidateVideo = join(epOutputDir, "video.mp4");
          const candidateFinal = join(epOutputDir, "final_episode.mp4");
          const finalVideo = existsSync(candidateFinal)
            ? candidateFinal
            : existsSync(candidateVideo)
            ? candidateVideo
            : null;

          let validVideoSkipped = false;
          let measuredDuration = plannedEp.target_duration_sec;

          if (options.skipRender) {
            validVideoSkipped = true;
          } else if (finalVideo) {
            try {
              const probe = await probeVideoFile(finalVideo);
              if (probe.isValid && probe.durationSec > 0) {
                measuredDuration = Math.round(probe.durationSec);
                validVideoSkipped = true;
              } else {
                log.warn(
                  `⚠️ [SEASON RESUME INVALID] Video tập ${epNum} ('${finalVideo}') không hợp lệ theo ffprobe (${probe.error || "0s duration"}). Re-run tập.`
                );
              }
            } catch (probeErr: any) {
              log.warn(
                `⚠️ [SEASON RESUME PROBE FAILED] Không thể probe video tập ${epNum}: ${probeErr.message}. Re-run tập.`
              );
            }
          }

          if (validVideoSkipped) {
            log.info(
              `⚡ [SEASON RESUME] Tập ${epNum} ('${plannedEp.title}') đã hoàn thành trước đó (specHash khớp & video hợp lệ). Bỏ qua và tái sử dụng artifact.`
            );
            epStatus.status = "skipped";
            epStatus.outputPath = finalVideo || join(epOutputDir, "script-normalized.json");
            epStatus.durationSec = measuredDuration;
            epStatus.completedAt = existingCheckpoint.updatedAt;
            skippedCount++;
            totalDurationSec += measuredDuration;
            if (options.onEpisodeComplete) options.onEpisodeComplete(epStatus);
            continue;
          }
        } else if (existingCheckpoint && !specMatches) {
          log.warn(
            `🔄 [SEASON RESUME MISMATCH] Tập ${epNum} specHash đã thay đổi (cũ: ${existingCheckpoint.specHash || "none"}, mới: ${currentSpecHash}). Re-run tập.`
          );
        }
      }

      // Generate or retrieve screenplay for this planned episode
      await options.checkpoint?.();
      epStatus.status = "running";
      log.info(`▶️ [SEASON ORCHESTRATOR] Đang sản xuất Tập ${epNum}: "${plannedEp.title}"...`);

      try {
        const screenplayResult = await this.screenplayGenerator.generateEpisodeFromPlan({
          seriesId,
          planId,
          episodeNumber: epNum,
          customLlmInvoker: options.customLlmInvoker,
          skipAudit: options.skipAudit ?? false,
        });

        // Save raw screenplay to episode directory for full traceability
        await mkdir(epOutputDir, { recursive: true });
        await writeFile(
          join(epOutputDir, "screenplay.txt"),
          screenplayResult.rawScreenplay,
          "utf8"
        );

        // Compute specHash for pipeline checkpoint (including written screenplay)
        const effectiveSpecHash = this.computeEpisodeSpecHash(
          seriesId,
          planId,
          plannedEp,
          options,
          epOutputDir
        );

        // Run Episodic Pipeline for this episode
        const pipelineOptions: EpisodeOptions = {
          seriesId,
          outputDir: epOutputDir,
          provider: options.provider || "mock",
          dryRun: options.dryRun,
          mockTts: options.mockTts,
          ttsProvider: options.ttsProvider,
          allowMockMedia: options.allowMockMedia,
          skipAudit: options.skipAudit ?? false,
          skipRender: options.skipRender ?? false,
          resume: resume, regenerateAudio: options.regenerateAudio,
          budgetCapUsd: options.budgetCapUsd,
          hedge:options.hedge,
          commitCanon: options.commitCanon ?? false,
          autoCommitCanon: options.commitCanon ?? false,
          requireApproval: options.requireApproval,
          checkpoint: options.checkpoint,
          expectedEpisodeNumber: epNum,
          useHierarchicalAssembly: options.useHierarchicalAssembly ?? true, // Default to true for multi-episode season assembly
          transitionDurationSec: options.transitionDurationSec,
          specHash: effectiveSpecHash,
        };

        const epResult = await this.pipeline.produceEpisode(
          screenplayResult.rawScreenplay,
          pipelineOptions
        );

        let measuredDuration = plannedEp.target_duration_sec;
        if (epResult.videoPath && existsSync(epResult.videoPath)) {
          try {
            const probe = await probeVideoFile(epResult.videoPath);
            if (probe.isValid && probe.durationSec > 0) {
              measuredDuration = Math.round(probe.durationSec);
            }
          } catch (caughtError) { log.warn("[produce-season] "+String(caughtError)); }
        }

        epStatus.outputPath = epResult.videoPath;
        epStatus.durationSec = measuredDuration;
        epStatus.completedAt = new Date().toISOString();

        if (!epResult.auditPassed) {
          epStatus.status = "needs_review";
          epStatus.error = "QA audit failed or flagged warnings";
          needsReviewCount++;
          log.warn(`⚠️ [SEASON ORCHESTRATOR] Tập ${epNum} dựng xong nhưng QA audit flagged: needs_review.`);
        } else if (options.commitCanon && !epResult.committedCanon) {
          epStatus.status = "needs_review";
          epStatus.error = "Canon commit was blocked or rejected";
          needsReviewCount++;
          log.warn(`⚠️ [SEASON ORCHESTRATOR] Tập ${epNum} dựng xong nhưng canon commit bị chặn: needs_review.`);
        } else if (options.commitCanon && epResult.committedCanon) {
          epStatus.status = "canon_committed";
          completedCount++;
          log.info(
            `✅ [SEASON ORCHESTRATOR] Tập ${epNum} hoàn thành và đã commit canon: ${epResult.videoPath}`
          );
        } else {
          epStatus.status = "completed";
          completedCount++;
          log.info(
            `✅ [SEASON ORCHESTRATOR] Tập ${epNum} hoàn thành thành công: ${epResult.videoPath}`
          );
        }
        totalDurationSec += measuredDuration;
      } catch (err: any) {
        epStatus.status = "failed";
        epStatus.error = err?.message || String(err);
        epStatus.completedAt = new Date().toISOString();
        failedCount++;

        log.error(
          `❌ [SEASON ORCHESTRATOR] Tập ${epNum} thất bại: ${epStatus.error}`
        );

        if (!continueOnError) {
          log.warn(
            `🛑 [SEASON HALT] Cờ continueOnError=false: dừng toàn bộ tiến trình season sau lỗi tại Tập ${epNum}.`
          );
          break;
        } else {
          log.info(
            `⏭️ [SEASON CONTINUE] Cờ continueOnError=true: tiếp tục sản xuất các tập tiếp theo.`
          );
        }
      }

      if (options.onEpisodeComplete) {
        options.onEpisodeComplete(epStatus);
      }
      if (!options.dryRun && options.provider !== "mock" && epStatus.status !== "canon_committed") break;
    }

    // 4. Summarize Season State
    const finalBudgetUsage = this.bible.getSeriesBudgetLedger(seriesId);
    const hasNeedsReview = episodeStatuses.some((e) => e.status === "needs_review");
    const overallStatus: SeasonProgress["status"] =
      failedCount > 0
        ? "failed_partial"
        : episodeStatuses.some((e) => e.status === "budget_exceeded")
        ? "stopped_budget"
        : hasNeedsReview
        ? "needs_review"
        : "completed";

    const progress: SeasonProgress = {
      seriesId,
      planId,
      status: overallStatus,
      totalEpisodes: targetEpisodes.length,
      completedEpisodes: completedCount + skippedCount,
      failedEpisodes: failedCount,
      skippedEpisodes: skippedCount,
      pendingEpisodes: Math.max(
        0,
        targetEpisodes.length - (completedCount + skippedCount + failedCount + needsReviewCount)
      ),
      totalCostUsd: finalBudgetUsage.confirmedCostUsd,
      episodes: episodeStatuses,
      costLedger: {
        estimated: finalBudgetUsage.estimatedCostUsd,
        reserved: finalBudgetUsage.reservedCostUsd,
        confirmed: finalBudgetUsage.confirmedCostUsd,
        confirmedInvoiced: finalBudgetUsage.confirmedInvoicedCostUsd,
        confirmedEstimated: finalBudgetUsage.confirmedEstimatedCostUsd,
        uncertain: finalBudgetUsage.uncertainCostUsd,
      },
    };

    // 5. Write Season Master Report to Disk
    const seasonMasterReportPath = join(outputBase, "season_master_report.json");
    const manifestPayload = {
      seriesId,
      planId,
      seasonProgress: progress,
      generatedAt: new Date().toISOString(),
      totalEpisodes: targetEpisodes.length,
      completedEpisodes: completedCount + skippedCount,
      failedEpisodes: failedCount,
      skippedEpisodes: skippedCount,
      totalDurationSec,
      totalCostUsd: finalBudgetUsage.confirmedCostUsd,
      episodes: episodeStatuses,
      costLedger: {
        estimated: finalBudgetUsage.estimatedCostUsd,
        reserved: finalBudgetUsage.reservedCostUsd,
        confirmed: finalBudgetUsage.confirmedCostUsd,
        confirmedInvoiced: finalBudgetUsage.confirmedInvoicedCostUsd,
        confirmedEstimated: finalBudgetUsage.confirmedEstimatedCostUsd,
        uncertain: finalBudgetUsage.uncertainCostUsd,
      },
    };
    const serializedReport = JSON.stringify(manifestPayload, null, 2);
    await writeFile(seasonMasterReportPath, serializedReport, "utf8");

    // Also write season_manifest.json in outputBase and standard season_production dir for unified discovery
    const seasonManifestPath = join(outputBase, "season_manifest.json");
    await writeFile(seasonManifestPath, serializedReport, "utf8");
    const standardProdDir = join("data", "series", seriesId, "season_production");
    if (resolve(outputBase) !== resolve(standardProdDir)) {
      try {
        await mkdir(standardProdDir, { recursive: true });
        await writeFile(join(standardProdDir, "season_manifest.json"), serializedReport, "utf8");
      } catch (caughtError) { log.warn("[produce-season] "+String(caughtError)); }
    }

    return {
      success:
        failedCount === 0 &&
        !hasNeedsReview &&
        !episodeStatuses.some((e) => e.status === "budget_exceeded"),
      seriesId,
      planId,
      totalTargetEpisodes: targetEpisodes.length,
      episodesExecuted: completedCount + failedCount,
      episodesCompleted: completedCount + skippedCount,
      episodesFailed: failedCount,
      totalDurationSec,
      totalCostUsd: finalBudgetUsage.confirmedCostUsd,
      progress,
      seasonMasterReportPath,
    };
  }

  /**
   * Produces a specific range of episodes [fromEpisode..toEpisode].
   */
  public async produceEpisodeRange(
    seriesId: string,
    fromEpisode: number,
    toEpisode: number,
    options: Partial<SeasonOrchestratorOptions> = {}
  ): Promise<SeasonProductionResult> {
    return this.produceSeason({
      ...options,
      seriesId,
      fromEpisode,
      toEpisode,
    });
  }

  /**
   * Produces all remaining uncompleted episodes in the active plan.
   */
  public async produceRemainingEpisodes(
    seriesId: string,
    options: Partial<SeasonOrchestratorOptions> = {}
  ): Promise<SeasonProductionResult> {
    const plan = this.bible.getActiveSeriesPlan(seriesId);
    if (!plan) {
      throw new Error(`No active plan found for series '${seriesId}'.`);
    }

    const allPlanned = this.bible.listPlannedEpisodes(plan.id);
    const completedEpisodes = this.bible.getCanonHistory(seriesId).map((c) => c.episode_number);
    const remainingEpNums = allPlanned
      .map((p) => p.episode_number)
      .filter((num) => !completedEpisodes.includes(num));

    return this.produceSeason({
      ...options,
      seriesId,
      planId: plan.id,
      episodes: remainingEpNums,
    });
  }
}
