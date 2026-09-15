import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { join } from "node:path";
import { mkdir, rm, writeFile, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { BibleManager } from "../bible/bible-manager.js";
import { SourceIngestionEngine, TextChunker, StoryAnalysisEngine } from "../novel/index.js";
import { SeriesPlanner } from "../series/series-planner.js";
import { SeasonOrchestrator, type EpisodeExecutionStatus } from "./season-orchestrator.js";

describe("Phase P4: Season Orchestrator & Multi-Episode Production Batch", () => {
  let bible: BibleManager;
  const seriesId = "series_season_test_p4";
  const testOutputDir = join("data", "test_output", "season_orchestrator_test");

  const TEST_NOVEL = `
Chương 1: Khởi nguồn phong ba
Minh là một kiếm khách lang bạt giang hồ.
Hắn bước chân vào Lạc Dương giữa mùa thu lá rụng.
Tại quán trọ Nguyệt Cát, hắn bắt gặp một mật hàm bị thất lạc.

Chương 2: Đêm dài phục kích
Bạch Y Nữ hiệp Tiểu Lan xuất hiện và cảnh báo Minh về cạm bẫy.
Một toán sát thủ Hắc Liên Giáo bao vây quán trọ.
Minh và Tiểu Lan kề vai tác chiến đánh tan toán sát thủ.

Chương 3: Bí mật hoàng cung
Tên cầm đầu khai ra âm mưu phản nghịch trong kinh thành.
Minh và Tiểu Lan quyết định lên đường tiến về hoàng cung.
Kết thúc hồi một của cuộc phiêu lưu.
`.trim();

  let sourceId: string;
  let planId: string;

  beforeEach(async () => {
    BibleManager.closeAll();
    await rm(testOutputDir, { recursive: true, force: true }).catch(() => {});
    await mkdir(testOutputDir, { recursive: true });

    bible = new BibleManager(":memory:");

    // 1. Setup Series Metadata
    bible.upsertSeriesMetadata({
      id: seriesId,
      title: "Phong Ba Lạc Dương",
      genre: "Kiếm hiệp trinh thám",
      visual_style: "Điện ảnh 35mm, tương phản cao",
      aspect_ratio: "16:9",
      fps: 24,
      created_at: new Date().toISOString(),
    });

    // Set initial budget
    bible.setSeriesBudget({
      series_id: seriesId,
      max_budget_usd: 100.0,
      warning_threshold_ratio: 0.8,
      is_hard_capped: 1,
      updated_at: new Date().toISOString(),
    });

    // 2. Ingest Source Novel
    const ingestion = SourceIngestionEngine.ingestSourceText(
      TEST_NOVEL,
      {
        seriesId,
        title: "Phong Ba Lạc Dương",
        sourceType: "novel",
      },
      bible
    );
    sourceId = ingestion.work.id;

    // Chunk units & blocks
    const units = TextChunker.splitIntoUnits(
      ingestion.work.normalized_text,
      sourceId,
      seriesId,
      1
    );
    bible.batchUpsertSourceUnits(units);

    const blocks: any[] = [];
    for (const u of units) {
      blocks.push(...TextChunker.splitIntoBlocks(u, seriesId, 1));
    }
    bible.batchUpsertSourceBlocks(blocks);

    // Analyze story
    await StoryAnalysisEngine.analyzeWork(
      ingestion.work,
      units,
      blocks,
      bible,
      { seriesId, sourceId }
    );

    // 3. Plan Series into 3 episodes
    const planner = new SeriesPlanner(bible);
    const planResult = await planner.planSeries({
      seriesId,
      sourceId,
      targetEpisodes: 3,
      pacingPreset: "fast",
    });
    planId = planResult.plan.id;
  });

  afterEach(async () => {
    BibleManager.closeAll();
    await rm(testOutputDir, { recursive: true, force: true }).catch(() => {});
  });

  it("produces an entire season with all planned episodes successfully", async () => {
    const orchestrator = new SeasonOrchestrator(bible);
    const completedCallbacks: EpisodeExecutionStatus[] = [];

    const result = await orchestrator.produceSeason({
      seriesId,
      planId,
      outputBaseDir: testOutputDir,
      provider: "mock",
      dryRun: true,
      skipRender: true,
      skipAudit: true,
      onEpisodeComplete: (status) => {
        completedCallbacks.push(status);
      },
    });

    expect(result.success).toBe(true);
    expect(result.seriesId).toBe(seriesId);
    expect(result.planId).toBe(planId);
    expect(result.totalTargetEpisodes).toBe(3);
    expect(result.episodesCompleted).toBe(3);
    expect(result.episodesFailed).toBe(0);
    expect(result.totalDurationSec).toBeGreaterThan(0);
    expect(completedCallbacks.length).toBe(3);

    // Verify each episode status
    for (let i = 0; i < 3; i++) {
      expect(result.progress.episodes[i].status).toBe("completed");
      expect(result.progress.episodes[i].episodeNumber).toBe(i + 1);
      expect(result.progress.episodes[i].outputPath).toBeDefined();
    }

    // Verify season_master_report.json exists on disk
    expect(result.seasonMasterReportPath).toBeDefined();
    expect(existsSync(result.seasonMasterReportPath!)).toBe(true);

    const reportContent = JSON.parse(
      await readFile(result.seasonMasterReportPath!, "utf8")
    );
    expect(reportContent.seasonProgress.status).toBe("completed");
    expect(reportContent.seasonProgress.completedEpisodes).toBe(3);
  });

  it("produces a filtered range of episodes (e.g. Episode 2 to 3)", async () => {
    const orchestrator = new SeasonOrchestrator(bible);

    const result = await orchestrator.produceSeason({
      seriesId,
      planId,
      fromEpisode: 2,
      toEpisode: 3,
      outputBaseDir: testOutputDir,
      provider: "mock",
      dryRun: true,
      skipRender: true,
      skipAudit: true,
    });

    expect(result.success).toBe(true);
    expect(result.totalTargetEpisodes).toBe(2);
    expect(result.episodesCompleted).toBe(2);
    expect(result.progress.episodes[0].episodeNumber).toBe(2);
    expect(result.progress.episodes[1].episodeNumber).toBe(3);
  });

  it("skips previously completed episodes on resume and only runs remaining ones", async () => {
    // 1. Simulate Episode 1 already completed with existing checkpoint and file
    const ep1Dir = join(testOutputDir, "ep_01");
    await mkdir(ep1Dir, { recursive: true });
    const mockFinalVideo = join(ep1Dir, "final_episode.mp4");
    await writeFile(mockFinalVideo, "MOCK_VIDEO_BINARY_DATA", "utf8");

    const mockCheckpoint = {
      seriesId,
      episodeNumber: 1,
      title: "Tập 1: Phong Ba Lạc Dương",
      status: "completed",
      currentPhase: "done",
      shots: {},
      updatedAt: new Date().toISOString(),
    };
    await writeFile(
      join(ep1Dir, "checkpoint.json"),
      JSON.stringify(mockCheckpoint, null, 2),
      "utf8"
    );

    // 2. Run season orchestrator with resume=true
    const orchestrator = new SeasonOrchestrator(bible);
    const result = await orchestrator.produceSeason({
      seriesId,
      planId,
      outputBaseDir: testOutputDir,
      provider: "mock",
      dryRun: true,
      skipRender: true,
      skipAudit: true,
      resume: true,
    });

    expect(result.success).toBe(true);
    expect(result.episodesCompleted).toBe(3);
    expect(result.progress.skippedEpisodes).toBe(1);

    // Episode 1 must have status 'skipped'
    const ep1Status = result.progress.episodes.find((e) => e.episodeNumber === 1);
    expect(ep1Status?.status).toBe("skipped");
    expect(ep1Status?.outputPath).toBe(mockFinalVideo);

    // Episodes 2 & 3 must have status 'completed'
    const ep2Status = result.progress.episodes.find((e) => e.episodeNumber === 2);
    const ep3Status = result.progress.episodes.find((e) => e.episodeNumber === 3);
    expect(ep2Status?.status).toBe("completed");
    expect(ep3Status?.status).toBe("completed");
  });

  it("isolates errors with continueOnError=true and continues remaining episodes", async () => {
    const orchestrator = new SeasonOrchestrator(bible);

    // Mock custom LLM invoker that returns invalid script format only on episode 2
    const failingLlmInvoker = async (prompt: string): Promise<string> => {
      if (prompt.includes("Tập số: 2")) {
        return "LỖI KỊCH BẢN KHÔNG CÓ CẢNH NÀO";
      }
      return `
TẬP 1: KHỞI ĐẦU
CẢNH 1: QUÁN TRỌ - ĐÊM
Nhân vật: Minh
CÚ MÁY 1 (establishing, 4s): Toàn cảnh quán trọ.
MINH: Cẩn thận phục kích.
CẢNH 2: SÂN SAU - ĐÊM
Nhân vật: Minh
CÚ MÁY 1 (action, 4s): Minh rút kiếm.
MINH: Mau lùi lại.
CẢNH 3: BỜ SÔNG - NGÀY
Nhân vật: Minh
CÚ MÁY 1 (wide, 4s): Ánh bình minh ló rạng.
MINH: Tiếp tục lên đường.
      `.trim();
    };

    const result = await orchestrator.produceSeason({
      seriesId,
      planId,
      outputBaseDir: testOutputDir,
      provider: "mock",
      dryRun: true,
      skipRender: true,
      skipAudit: true,
      continueOnError: true,
      customLlmInvoker: failingLlmInvoker,
    });

    expect(result.success).toBe(false);
    expect(result.episodesCompleted).toBe(2);
    expect(result.episodesFailed).toBe(1);
    expect(result.progress.status).toBe("failed_partial");

    const ep1Status = result.progress.episodes.find((e) => e.episodeNumber === 1);
    const ep2Status = result.progress.episodes.find((e) => e.episodeNumber === 2);
    const ep3Status = result.progress.episodes.find((e) => e.episodeNumber === 3);

    expect(ep1Status?.status).toBe("completed");
    expect(ep2Status?.status).toBe("failed");
    expect(ep2Status?.error).toBeDefined();
    // Episode 3 should still run and succeed!
    expect(ep3Status?.status).toBe("completed");
  });

  it("halts season execution immediately when continueOnError=false upon failure", async () => {
    const orchestrator = new SeasonOrchestrator(bible);

    const failingLlmInvoker = async (prompt: string): Promise<string> => {
      if (prompt.includes("Tập số: 1")) {
        return "LỖI KỊCH BẢN TẬP 1 KHÔNG CÓ CẢNH NÀO";
      }
      return "";
    };

    const result = await orchestrator.produceSeason({
      seriesId,
      planId,
      outputBaseDir: testOutputDir,
      provider: "mock",
      dryRun: true,
      skipRender: true,
      skipAudit: true,
      continueOnError: false, // Stop immediately on error
      customLlmInvoker: failingLlmInvoker,
    });

    expect(result.success).toBe(false);
    expect(result.episodesCompleted).toBe(0);
    expect(result.episodesFailed).toBe(1);

    // Episode 1 failed
    expect(result.progress.episodes[0].status).toBe("failed");
    // Episode 2 and 3 remained pending
    expect(result.progress.episodes[1].status).toBe("pending");
    expect(result.progress.episodes[2].status).toBe("pending");
  });

  it("stops production when budget cap is exceeded and marks remaining episodes budget_exceeded", async () => {
    const orchestrator = new SeasonOrchestrator(bible);

    // Record an existing confirmed cost that exceeds the budget cap
    bible.createOrUpdateProviderJob({
      id: "job_pre_existing_cost",
      series_id: seriesId,
      episode_number: 0,
      shot_id: "pre_shot",
      provider: "mock",
      model_name: "test",
      spec_hash: "mock_spec_hash_01",
      status: "completed",
      attempt_count: 1,
      max_attempts: 3,
      cost_category: "confirmed",
      estimated_cost_usd: 15.0,
      reserved_cost_usd: 0,
      confirmed_cost_usd: 15.0,
      uncertain_cost_usd: 0,
      is_retryable: 0,
    });

    const result = await orchestrator.produceSeason({
      seriesId,
      planId,
      outputBaseDir: testOutputDir,
      provider: "mock",
      dryRun: true,
      skipRender: true,
      skipAudit: true,
      budgetCapUsd: 10.0, // Cap is $10, but $15 is already confirmed!
    });

    expect(result.success).toBe(false);
    expect(result.progress.status).toBe("stopped_budget");
    expect(result.episodesCompleted).toBe(0);

    for (const ep of result.progress.episodes) {
      expect(ep.status).toBe("budget_exceeded");
      expect(ep.error).toBeDefined();
    }
  });

  it("produceRemainingEpisodes executes only episodes not yet in canon history", async () => {
    const orchestrator = new SeasonOrchestrator(bible);

    // Register episode 1 in canon history
    bible.recordEpisodeSummary({
      series_id: seriesId,
      episode_number: 1,
      title: "Tập 1 Đã Hoàn Thành",
      logline: "Minh khám phá mật hàm.",
      major_events: ["Minh đến Lạc Dương"],
    });

    const result = await orchestrator.produceRemainingEpisodes(seriesId, {
      outputBaseDir: testOutputDir,
      provider: "mock",
      dryRun: true,
      skipRender: true,
      skipAudit: true,
    });

    expect(result.success).toBe(true);
    expect(result.totalTargetEpisodes).toBe(2); // Only ep 2 and 3
    expect(result.progress.episodes[0].episodeNumber).toBe(2);
    expect(result.progress.episodes[1].episodeNumber).toBe(3);
    expect(result.episodesCompleted).toBe(2);
  });
});
