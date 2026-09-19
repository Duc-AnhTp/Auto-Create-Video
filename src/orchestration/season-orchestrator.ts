import { existsSync, readFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { BibleManager, type SeriesPlanRecord, type PlannedEpisodeRecord } from "../bible/bible-manager.js";
import { EpisodicPipeline, type EpisodicPipelineOptions, type EpisodicPipelineResult } from "../series/episodic-pipeline.js";
import { StoryToScreenplayGenerator } from "../series/story-to-screenplay.js";
import { SeriesPlanner } from "../series/series-planner.js";
import { BudgetLedger } from "./budget-ledger.js";
import type { BackendProvider } from "../gateway/video-gateway.js";
import { probeVideoFile } from "../media/media-validator.js";
import { log } from "../utils/logger.js";

export interface SeasonOrchestratorOptions {
  seriesId: string;
  planId?: string;
  fromEpisode?: number;
  toEpisode?: number;
  episodes?: number[];
  outputBaseDir?: string;
  provider?: BackendProvider;
  dryRun?: boolean;
  mockTts?: boolean;
  skipAudit?: boolean;
  skipRender?: boolean;
  resume?: boolean;
  budgetCapUsd?: number;
  commitCanon?: boolean;
  continueOnError?: boolean;
  useHierarchicalAssembly?: boolean;
  transitionDurationSec?: number;
  customLlmInvoker?: (prompt: string, systemPrompt?: string) => Promise<string>;
  onEpisodeComplete?: (epResult: EpisodeExecutionStatus) => void;
}

export type EpisodeStatusType =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "skipped"
  | "budget_exceeded";

export interface EpisodeExecutionStatus {
  episodeNumber: number;
  title: string;
  status: EpisodeStatusType;
  outputPath?: string;
  durationSec?: number;
  costUsd?: number;
  error?: string;
  takeCount?: number;
  startedAt?: string;
  completedAt?: string;
}

export interface SeasonProgress {
  seriesId: string;
  planId: string;
  status: "idle" | "running" | "completed" | "failed_partial" | "stopped_budget";
  totalEpisodes: number;
  completedEpisodes: number;
  failedEpisodes: number;
  skippedEpisodes: number;
  pendingEpisodes: number;
  totalCostUsd: number;
  episodes: EpisodeExecutionStatus[];
  costLedger: {
    estimated: number;
    reserved: number;
    confirmed: number;
    uncertain: number;
  };
}

export interface SeasonProductionResult {
  success: boolean;
  seriesId: string;
  planId: string;
  totalTargetEpisodes: number;
  episodesExecuted: number;
  episodesCompleted: number;
  episodesFailed: number;
  totalDurationSec: number;
  totalCostUsd: number;
  progress: SeasonProgress;
  seasonMasterReportPath?: string;
}

/**
 * SeasonOrchestrator
 *
 * Coordinates multi-episode production batches across an entire season plan.
 * Integrates EpisodicPipeline, StoryToScreenplayGenerator, BudgetLedger, and
 * resilient checkpoint resumption with error isolation and budget caps.
 */
export class SeasonOrchestrator {
  private bible: BibleManager;
  private pipeline: EpisodicPipeline;
  private screenplayGenerator: StoryToScreenplayGenerator;
  private budgetLedger: BudgetLedger;

  constructor(bibleOrPath: string | BibleManager = "story_bible.db") {
    if (bibleOrPath instanceof BibleManager) {
      this.bible = bibleOrPath;
    } else {
      this.bible = new BibleManager(bibleOrPath);
    }
    this.pipeline = new EpisodicPipeline(this.bible);
    this.screenplayGenerator = new StoryToScreenplayGenerator(this.bible);
    this.budgetLedger = new BudgetLedger(this.bible);
  }

  public getBible(): BibleManager {
    return this.bible;
  }

  public getPipeline(): EpisodicPipeline {
    return this.pipeline;
  }

  /**
   * Computes composite specHash for an episode based on:
   * source hash + plan hash + script hash + prior canon version + provider config (PR6).
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
        const specMatches =
          !existingCheckpoint?.specHash ||
          existingCheckpoint.specHash === currentSpecHash;

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

          if (finalVideo || options.skipRender) {
            let measuredDuration = plannedEp.target_duration_sec;
            if (finalVideo) {
              try {
                const probe = await probeVideoFile(finalVideo);
                if (probe.isValid && probe.durationSec > 0) {
                  measuredDuration = Math.round(probe.durationSec);
                }
              } catch {
                // Keep planned duration as fallback
              }
            }

            log.info(
              `⚡ [SEASON RESUME] Tập ${epNum} ('${plannedEp.title}') đã hoàn thành trước đó (specHash khớp). Bỏ qua và tái sử dụng artifact.`
            );
            epStatus.status = "skipped";
            epStatus.outputPath = finalVideo || join(epOutputDir, "script-normalized.json");
            epStatus.durationSec = measuredDuration;
            epStatus.completedAt = existingCheckpoint.updatedAt;
            skippedCount++;
            completedCount++;
            totalDurationSec += measuredDuration;
            if (options.onEpisodeComplete) options.onEpisodeComplete(epStatus);
            continue;
          }
        } else if (existingCheckpoint && !specMatches) {
          log.warn(
            `🔄 [SEASON RESUME MISMATCH] Tập ${epNum} specHash đã thay đổi (cũ: ${existingCheckpoint.specHash}, mới: ${currentSpecHash}). Re-run tập.`
          );
        }
      }

      // Generate or retrieve screenplay for this planned episode
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
        const pipelineOptions: EpisodicPipelineOptions = {
          seriesId,
          outputDir: epOutputDir,
          provider: options.provider || "mock",
          dryRun: options.dryRun,
          mockTts: options.mockTts,
          skipAudit: options.skipAudit ?? false,
          skipRender: options.skipRender ?? false,
          resume: resume,
          budgetCapUsd: options.budgetCapUsd,
          commitCanon: options.commitCanon ?? false,
          _testOnlyAllowMockCommit: options.commitCanon, // Allow test commit when requested
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
          } catch {
            // Keep planned duration as fallback
          }
        }

        epStatus.status = "completed";
        epStatus.outputPath = epResult.videoPath;
        epStatus.durationSec = measuredDuration;
        epStatus.completedAt = new Date().toISOString();
        completedCount++;
        totalDurationSec += measuredDuration;

        log.info(
          `✅ [SEASON ORCHESTRATOR] Tập ${epNum} hoàn thành thành công: ${epResult.videoPath}`
        );
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
    }

    // 4. Summarize Season State
    const finalBudgetUsage = this.bible.getSeriesBudgetLedger(seriesId);
    const overallStatus: SeasonProgress["status"] =
      failedCount > 0
        ? "failed_partial"
        : episodeStatuses.some((e) => e.status === "budget_exceeded")
        ? "stopped_budget"
        : "completed";

    const progress: SeasonProgress = {
      seriesId,
      planId,
      status: overallStatus,
      totalEpisodes: targetEpisodes.length,
      completedEpisodes: completedCount,
      failedEpisodes: failedCount,
      skippedEpisodes: skippedCount,
      pendingEpisodes: targetEpisodes.length - (completedCount + failedCount),
      totalCostUsd: finalBudgetUsage.confirmedCostUsd,
      episodes: episodeStatuses,
      costLedger: {
        estimated: finalBudgetUsage.estimatedCostUsd,
        reserved: finalBudgetUsage.reservedCostUsd,
        confirmed: finalBudgetUsage.confirmedCostUsd,
        uncertain: finalBudgetUsage.uncertainCostUsd,
      },
    };

    // 5. Write Season Master Report to Disk
    const seasonMasterReportPath = join(outputBase, "season_master_report.json");
    await writeFile(
      seasonMasterReportPath,
      JSON.stringify(
        {
          seasonProgress: progress,
          generatedAt: new Date().toISOString(),
        },
        null,
        2
      ),
      "utf8"
    );

    return {
      success: failedCount === 0 && !episodeStatuses.some((e) => e.status === "budget_exceeded"),
      seriesId,
      planId,
      totalTargetEpisodes: targetEpisodes.length,
      episodesExecuted: completedCount + failedCount,
      episodesCompleted: completedCount,
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
