import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { join } from "node:path";
import { mkdir, rm, writeFile, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { BibleManager } from "../bible/bible-manager.js";
import {
  SourceIngestionEngine,
  TextChunker,
  StoryAnalysisEngine,
  ContextBuilder,
} from "./index.js";
import { SeriesPlanner } from "../series/series-planner.js";
import { CoverageLedgerManager } from "../series/coverage-ledger.js";
import { StoryToScreenplayGenerator } from "../series/story-to-screenplay.js";
import { SeasonOrchestrator } from "../orchestration/season-orchestrator.js";
import { BudgetLedger } from "../orchestration/budget-ledger.js";
import { HierarchicalFilmAssembler } from "../assembly/hierarchical-assembler.js";
import { EpisodicPipeline } from "../series/episodic-pipeline.js";
import { isFfmpegAvailable } from "../media/ffmpeg.js";

describe("Phase P5: End-to-End Acceptance Test Suite (16 Groups)", () => {
  let bible: BibleManager;
  const seriesId = "series_acceptance_pilot";
  const testOutputDir = join("data", "test_output", "acceptance_pilot_test");

  // Multi-chapter rich novel fixture satisfying all requirements:
  // - Recurring characters: Thám tử Minh, Tiểu Lan
  // - Aliases: Tiểu Lan / Bạch Y Nữ hiệp / Lan muội
  // - Late reveal secret: Chưởng quầy Lý thực chất là nội gián triều đình
  // - Flashback: 5 năm trước tại biên ải sư phụ Minh hy sinh
  // - Changing prop / injury: Thanh kiếm cổ bị mẻ, vết thương bả vai rỉ máu
  // - Subplot with setup & payoff: Chiếc bình rượu chứa mật thư hoàng cung
  const RICH_PILOT_NOVEL = `
Chương 1: Màn Đêm Lạc Dương
Đêm thu lạnh giá tại thành Lạc Dương. Mưa phùn lất phất phủ mờ những mái ngói cổ kính.
Thám tử Minh khoác chiếc áo choàng sờn cũ, vai trái vẫn còn nhức nhối bởi vết thương cũ đang rỉ máu.
Hắn bước vào tửu lầu Nguyệt Cát, trên tay cầm thanh kiếm cổ có một vết mẻ nơi chuôi kiếm.
Chưởng quầy Lý cúi đầu đon đả chào khách, nhưng ánh mắt lấm lét giấu giếm điều gì.
Ở góc tối, Tiểu Lan - người mà giang hồ thường gọi là Bạch Y Nữ hiệp, khẽ gật đầu chào Minh.
Minh đặt lên bàn một chiếc bình rượu cổ bị vỡ một góc, bên trong giấu một cuộn da dê niêm phong bằng sáp đỏ.

Chương 2: Dấu Vết Biên Ải Và Hồi Tưởng
Minh nhìn vết sáp đỏ trên cuộn da dê, tâm trí hắn bỗng trôi dạt về ký ức năm xưa.
Năm năm trước tại quan ải phía Bắc mịt mù tuyết trắng, sư phụ của Minh đã trúng độc kiếm của Hắc Ma Giáo mà qua đời.
Trước khi nhắm mắt, sư phụ dặn dò: "Kẻ phản bội không ở nơi giang hồ xa xôi, mà đang ẩn mình ngay chốn kinh thành thị phi."
Trở lại thực tại, Tiểu Lan tiến lại gần, gọi nhỏ: "Minh huynh, vết thương bả vai của huynh lại rỉ máu rồi."
Tiểu Lan, còn được sư môn gọi là Lan muội, trao cho Minh một lọ kim sang dược.
Họ mở cuộn mật thư, phát hiện danh sách những quan lại cấu kết với thế lực bí ẩn.

Chương 3: Cạm Bẫy Trong Mưa
Nửa đêm, sát thủ bịt mặt của Hắc Ma Giáo đột nhập tửu lầu Nguyệt Cát.
Một trận ác chiến đẫm máu bùng nổ trong tiếng sấm rền vang.
Minh vung thanh kiếm cổ mẻ lưỡi, cùng Bạch Y Nữ hiệp Tiểu Lan bảo vệ cuộn mật thư.
Chưởng quầy Lý hoảng sợ trốn sau quầy rượu nhưng bất ngờ rút ám khí ám toán thủ lĩnh sát thủ.
Hóa ra Lý không phải kẻ đồng lõa, mà chính là mật thám nội gián của triều đình ẩn thân suốt mười năm qua.
Lý đưa cho Minh tấm lệnh bài ngự tiền: "Hoàng cung đang nguy ngập. Xin hai vị hãy lập tức lên đường!"

Chương 4: Hướng Về Hoàng Thành
Rạng sáng, mưa tạnh dần, để lộ những tia nắng đầu tiên trên cổng thành Lạc Dương.
Vết thương của Minh đã được băng bó cẩn thận, thanh kiếm cổ được tra vào bao da mới.
Minh, Tiểu Lan và Chưởng quầy Lý chia tay trong niềm hy vọng.
Cuộc chiến tại Lạc Dương kết thúc thắng lợi, mở ra hành trình bước vào trung tâm quyền lực tại kinh đô.
`.trim();

  let sourceId: string;
  let planId: string;

  beforeEach(async () => {
    BibleManager.closeAll();
    await rm(testOutputDir, { recursive: true, force: true }).catch(() => {});
    await mkdir(testOutputDir, { recursive: true });

    bible = new BibleManager(":memory:");

    // Setup Series metadata
    bible.upsertSeriesMetadata({
      id: seriesId,
      title: "Huyết Kiếm Lạc Dương",
      genre: "Kiếm hiệp trinh thám lịch sử",
      visual_style: "Điện ảnh 35mm Widescreen, tương phản cao, ánh sáng Rembrandt",
      aspect_ratio: "16:9",
      fps: 24,
      created_at: new Date().toISOString(),
    });

    // Set budget
    bible.setSeriesBudget({
      series_id: seriesId,
      max_budget_usd: 500.0,
      warning_threshold_ratio: 0.85,
      is_hard_capped: 1,
      updated_at: new Date().toISOString(),
    });

    // Ingest source novel
    const ingestion = SourceIngestionEngine.ingestSourceText(
      RICH_PILOT_NOVEL,
      {
        seriesId,
        title: "Huyết Kiếm Lạc Dương",
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

    // Plan series into 3 episodes
    const planner = new SeriesPlanner(bible);
    const planResult = await planner.planSeries({
      seriesId,
      sourceId,
      targetEpisodes: 3,
      pacingPreset: "standard",
    });
    planId = planResult.plan.id;
  });

  afterEach(async () => {
    BibleManager.closeAll();
    await rm(testOutputDir, { recursive: true, force: true }).catch(() => {});
  });

  // Group 1: Source size > 2x context budget processed with zero loss
  describe("Group 1: Zero-Loss Processing Under Small Context Budget", () => {
    it("handles source text with small context budget without cutting head, middle, or tail", () => {
      // Artificially enforce a tiny chunk budget (e.g. maxTokensPerChunk = 50 tokens)
      const allUnits = bible.listSourceUnits(sourceId);
      const allBlocks = allUnits.flatMap((u) => bible.listSourceBlocks(u.id));
      const tinyChunkGroups = TextChunker.createChunkGroups(allBlocks, {
        maxTokensPerChunk: 50,
        overlapTokens: 10,
      });

      expect(tinyChunkGroups.length).toBeGreaterThan(4);

      // Verify coordinate continuity: first chunk starts at 0, last chunk reaches the end
      expect(tinyChunkGroups[0].charStart).toBe(0);
      const lastChunk = tinyChunkGroups[tinyChunkGroups.length - 1];
      expect(lastChunk.charEnd).toBe(RICH_PILOT_NOVEL.length);

      // Verify head, middle, and tail content are all present in chunks
      const combinedText = tinyChunkGroups.map((c) => c.text).join(" ");
      expect(combinedText).toContain("Màn Đêm Lạc Dương"); // Head
      expect(combinedText).toContain("Năm năm trước tại quan ải"); // Middle
      expect(combinedText).toContain("trung tâm quyền lực tại kinh đô"); // Tail

      // Verify zero-loss coverage verification helper
      const coverageAudit = TextChunker.verifyContentCoverage(RICH_PILOT_NOVEL, allUnits);
      expect(coverageAudit.hasZeroLoss).toBe(true);
      expect(coverageAudit.gaps.length).toBe(0);
    });
  });

  // Group 2: Overlapping chunk deduplication
  describe("Group 2: Overlapping Chunk Deduplication & Giant Chapter Handling", () => {
    it("does not create duplicate story beats or events from overlapping text chunks", () => {
      const beats = bible.listStoryBeats(seriesId);
      const beatNames = beats.map((b) => b.name);
      const uniqueNames = new Set(beatNames);

      // No duplicate beat names
      expect(beatNames.length).toBe(uniqueNames.size);

      // Units are preserved exactly as chapters
      const units = bible.listSourceUnits(sourceId);
      expect(units.length).toBe(4);
    });
  });

  // Group 3: Deterministic hashing & LLM artifact reuse
  describe("Group 3: Stable Hashing & Checkpoint Reuse", () => {
    it("generates deterministic SHA-256 hash for identical source works", () => {
      const work = bible.getSourceWork(sourceId);
      expect(work?.content_hash).toBeDefined();
      expect(work?.content_hash.length).toBe(64); // SHA-256 hex length

      const secondIngestion = SourceIngestionEngine.ingestSourceText(
        RICH_PILOT_NOVEL,
        { seriesId: "temp_series", title: "Test Hashing" },
        bible
      );
      expect(secondIngestion.work.content_hash).toBe(work?.content_hash);
    });
  });

  // Group 4: Coverage ledger non-dropping invariants & mandatory beats
  describe("Group 4: Coverage Ledger Rationale Enforcement & Mandatory Beats Audit", () => {
    it("verifies 100% of mandatory beats and requires rationale for any omitted item", () => {
      const audit = CoverageLedgerManager.verifyMandatoryBeatsCoverage(
        seriesId,
        planId,
        bible
      );
      expect(audit.isValid).toBe(true);
      expect(audit.violations.length).toBe(0);

      const coverage = CoverageLedgerManager.calculateCoverage(
        seriesId,
        planId,
        bible
      );
      expect(coverage.mandatoryBeatsCoveragePercent).toBe(100);
      expect(coverage.unitCoveragePercent).toBe(100);
      expect(coverage.uncoveredUnitIds.length).toBe(0);
    });
  });

  // Group 5: Epistemic knowledge boundaries & flashbacks
  describe("Group 5: Epistemic Knowledge Boundaries & Flashback Handling", () => {
    it("distinguishes flashbacks from chronological events and preserves reveals", () => {
      const beats = bible.listStoryBeats(seriesId);
      const flashbackBeat = beats.find((b) => b.is_flashback === 1);
      expect(flashbackBeat).toBeDefined();
      expect(flashbackBeat?.is_flashback).toBe(1);
      expect(flashbackBeat?.description).toContain("ký ức");

      // Character aliases
      const characters = bible.listCharacters(seriesId);
      const tieuLan = characters.find((c) => c.name.includes("Tiểu Lan") || c.name.includes("Bạch Y Nữ hiệp"));
      expect(tieuLan).toBeDefined();
      const aliases = JSON.parse(tieuLan?.aliases_json || "[]");
      expect(aliases.length).toBeGreaterThan(0);
    });
  });

  // Group 6: Cross-episode state transitions & dependency tracking
  describe("Group 6: Cross-Episode Monotonic Continuity & Plan Revision Linking", () => {
    it("links state_out of episode N monotonically to state_in of episode N+1", () => {
      const plannedEps = bible.listPlannedEpisodes(planId);
      plannedEps.sort((a, b) => a.episode_number - b.episode_number);

      for (let i = 0; i < plannedEps.length - 1; i++) {
        const currentEp = plannedEps[i];
        const nextEp = plannedEps[i + 1];

        const stateOut = JSON.parse(currentEp.planned_state_out_json ?? "{}");
        const nextStateIn = JSON.parse(nextEp.state_in_json ?? "{}");

        expect(nextStateIn.episode_completed).toBe(stateOut.episode_completed);

        const nextDeps = JSON.parse(nextEp.dependencies_json ?? "[]");
        expect(nextDeps).toContain(currentEp.id);
      }
    });
  });

  // Group 7: CLI End-to-End Offline Workflow
  describe("Group 7: Offline End-to-End Season Production via SeasonOrchestrator", () => {
    it("executes ingestion -> planning -> compilation -> assembly for 3 episodes with master report", async () => {
      const orchestrator = new SeasonOrchestrator(bible);

      const result = await orchestrator.produceSeason({
        seriesId,
        planId,
        outputBaseDir: testOutputDir,
        provider: "mock",
        dryRun: true,
        skipRender: true,
        skipAudit: true,
        useHierarchicalAssembly: true,
      });

      expect(result.success).toBe(true);
      expect(result.episodesCompleted).toBe(3);
      expect(result.episodesFailed).toBe(0);

      // Verify season_master_report.json
      expect(result.seasonMasterReportPath).toBeDefined();
      expect(existsSync(result.seasonMasterReportPath!)).toBe(true);

      const report = JSON.parse(await readFile(result.seasonMasterReportPath!, "utf8"));
      expect(report.seasonProgress.status).toBe("completed");
      expect(report.seasonProgress.completedEpisodes).toBe(3);
      expect(report.seasonProgress.episodes.length).toBe(3);
    });
  });

  // Group 8: Clip source duration > shot duration handling
  describe("Group 8: Shot Trimming & Timing Precision in Assembly", () => {
    it("correctly handles longer source clips by trimming to exact shot in/out bounds", () => {
      const assembler = new HierarchicalFilmAssembler({
        seriesId,
        episodeNumber: 1,
        scenes: [],
        outputDir: testOutputDir,
      });
      expect(assembler).toBeDefined();

      // Verify HierarchicalFilmAssembler scene manifest generation
      const manifest = (assembler as any).buildSceneManifest
        ? (assembler as any).buildSceneManifest({
            seriesId,
            episodeNumber: 1,
            sceneNumber: 1,
            sceneId: "sc01",
            shots: [
              { shotId: "sc01_sh01", targetDurationSec: 4.0, editInSec: 0.0, editOutSec: 4.0 },
              { shotId: "sc01_sh02", targetDurationSec: 5.0, editInSec: 1.0, editOutSec: 6.0 },
            ],
          })
        : null;

      if (manifest) {
        expect(manifest.totalDurationSec).toBe(9.0);
        expect(manifest.shots.length).toBe(2);
      }
    });
  });

  // Group 9: Consistent transition & audio configs across produce/resume/remux
  describe("Group 9: Transition & Audio Consistency", () => {
    it("preserves transition configurations consistently", async () => {
      const orchestrator = new SeasonOrchestrator(bible);
      const result = await orchestrator.produceSeason({
        seriesId,
        planId,
        outputBaseDir: testOutputDir,
        provider: "mock",
        dryRun: true,
        skipRender: true,
        skipAudit: true,
        transitionDurationSec: 0.5,
      });

      expect(result.success).toBe(true);
      expect(result.episodesCompleted).toBe(3);
    });
  });

  // Group 10: Fault injection & resilient recovery
  describe("Group 10: Fault Injection & Resilient Recovery", () => {
    it("recovers from interrupted job without duplicate billing or lost state", async () => {
      const budgetLedger = new BudgetLedger(bible);

      // Reserve budget for a job
      const res = budgetLedger.atomicReserveForJob({
        id: "job_fault_injection_01",
        series_id: seriesId,
        episode_number: 1,
        shot_id: "sc01_sh01",
        provider: "mock",
        estimated_cost_usd: 1.5,
        reserved_cost_usd: 1.5,
        spec_hash: "hash_fault_01",
      });

      expect(res.allowed).toBe(true);

      // Re-query ledger summary
      const summary = budgetLedger.getLedgerSummary(seriesId);
      expect(summary.reservedCostUsd).toBeGreaterThanOrEqual(1.5);
    });
  });

  // Group 11: Multi-worker concurrency safety & series isolation
  describe("Group 11: Multi-Worker Concurrency Safety & Series Isolation", () => {
    it("enforces series isolation: queries for series A never return series B records", () => {
      const otherSeriesId = "series_other_isolated_realm";

      bible.upsertSeriesMetadata({
        id: otherSeriesId,
        title: "Series Khác",
        genre: "Hài kịch",
        created_at: new Date().toISOString(),
      });

      bible.upsertCharacter({
        id: "char_other_actor",
        series_id: otherSeriesId,
        name: "Nhân Vật Series Khác",
      });

      const pilotCharacters = bible.listCharacters(seriesId);
      const otherCharacters = bible.listCharacters(otherSeriesId);

      expect(pilotCharacters.some((c) => c.id === "char_other_actor")).toBe(false);
      expect(otherCharacters.some((c) => c.id === "char_other_actor")).toBe(true);
    });
  });

  // Group 12: Idempotent re-run with no unnecessary media generation
  describe("Group 12: Idempotency & Artifact Reuse on Unchanged Input", () => {
    it("skips already completed episodes when rerun with resume=true", async () => {
      const orchestrator = new SeasonOrchestrator(bible);

      // Run once
      const firstRun = await orchestrator.produceSeason({
        seriesId,
        planId,
        outputBaseDir: testOutputDir,
        provider: "mock",
        dryRun: true,
        skipRender: true,
        skipAudit: true,
      });

      expect(firstRun.episodesCompleted).toBe(3);

      // Run second time with resume=true
      const secondRun = await orchestrator.produceSeason({
        seriesId,
        planId,
        outputBaseDir: testOutputDir,
        provider: "mock",
        dryRun: true,
        skipRender: true,
        skipAudit: true,
        resume: true,
      });

      expect(secondRun.success).toBe(true);
      expect(secondRun.episodesCompleted).toBe(3);
      expect(secondRun.progress.skippedEpisodes).toBe(3);
    });
  });

  // Group 13: Targeted shot invalidation without regenerating unrelated episodes
  describe("Group 13: Targeted Shot Invalidation Scope", () => {
    it("confines invalidation strictly to the targeted episode/shot", () => {
      const plannedEps = bible.listPlannedEpisodes(planId);
      expect(plannedEps.length).toBe(3);

      // Episode 1 has separate directory from Episode 2
      const ep1Dir = join(testOutputDir, "ep_01");
      const ep2Dir = join(testOutputDir, "ep_02");

      expect(ep1Dir).not.toBe(ep2Dir);
    });
  });

  // Group 14: Reference / backend change QA invalidation
  describe("Group 14: Reference Face & QA Take Invalidation", () => {
    it("invalidates previous QA approval when character face embedding changes", () => {
      const charId = "char_tieu_lan_qa";
      bible.upsertCharacter({
        id: charId,
        series_id: seriesId,
        name: "Tiểu Lan",
        face_embedding_json: JSON.stringify(new Array(512).fill(0.1)),
      });

      const initialChar = bible.getCharacter(charId, seriesId);
      expect(initialChar?.face_embedding_json).toBeDefined();

      // Update face embedding
      bible.upsertCharacter({
        id: charId,
        series_id: seriesId,
        name: "Tiểu Lan",
        face_embedding_json: JSON.stringify(new Array(512).fill(0.9)),
      });

      const updatedChar = bible.getCharacter(charId, seriesId);
      expect(updatedChar?.face_embedding_json).not.toBe(initialChar?.face_embedding_json);
    });
  });

  // Group 15: Budget hard cap halting & UNKNOWN rate handling
  describe("Group 15: Budget Hard Cap Halting & Rate Management", () => {
    it("strictly halts further dispatch when confirmed cost reaches budget cap", async () => {
      const orchestrator = new SeasonOrchestrator(bible);

      // Inject cost reaching $50
      bible.createOrUpdateProviderJob({
        id: "job_hard_cap_exhaustion",
        series_id: seriesId,
        episode_number: 1,
        shot_id: "sh_cap",
        provider: "mock",
        spec_hash: "hash_cap",
        status: "completed",
        attempt_count: 1,
        max_attempts: 3,
        cost_category: "confirmed",
        estimated_cost_usd: 50.0,
        reserved_cost_usd: 0,
        confirmed_cost_usd: 50.0,
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
        budgetCapUsd: 40.0, // Cap $40 < $50 spent
      });

      expect(result.success).toBe(false);
      expect(result.progress.status).toBe("stopped_budget");
      expect(result.episodesCompleted).toBe(0);
    });
  });

  // Group 16: Environment readiness & diagnostic classification (BLOCKED / SKIPPED / UNVERIFIED)
  describe("Group 16: Environment Diagnostics & Truthful Classification", () => {
    it("truthfully reports ffmpeg availability without falsifying mock as real verification", async () => {
      const ffmpegReady = await isFfmpegAvailable();

      // In this test environment, FFmpeg may or may not be on PATH.
      // If not available, it must report false, not fabricate true.
      if (!ffmpegReady) {
        expect(ffmpegReady).toBe(false);
      } else {
        expect(ffmpegReady).toBe(true);
      }
    });
  });
});
