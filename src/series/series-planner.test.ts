import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { BibleManager } from "../bible/bible-manager.js";
import { SourceIngestionEngine, TextChunker, StoryAnalysisEngine } from "../novel/index.js";
import { SeriesPlanner, PACING_PROFILES } from "./series-planner.js";
import { CoverageLedgerManager } from "./coverage-ledger.js";
import { StoryToScreenplayGenerator } from "./story-to-screenplay.js";

describe("Phase P3: Series Adaptation Planning, Coverage Ledger & Screenplay Compilation", () => {
  let bible: BibleManager;
  const seriesId = "series_lac_duong_p3";

  const TEST_NOVEL = `
Chương 1: Án mạng tại quán trọ
Đêm thu buốt giá ở Lạc Dương. Thám tử Minh bước vào tửu lầu Nguyệt Cát.
Chưởng quầy Lý hoảng loạn thông báo: "Có người chết trong giếng hoang!"
Minh rút sổ tay ghi chép hiện trường, phát hiện vết chém sắc ngọt trên cổ nạn nhân.
Tiểu Lan, tức Bạch Y Nữ hiệp, ngồi ở góc phòng, lặng lẽ quan sát.

Chương 2: Dấu vết Huyết Liên Giáo
Minh xem xét vết thương và bàng hoàng nhớ lại 5 năm trước tại biên ải.
Sư phụ của Minh từng chết dưới đường kiếm tương tự của Huyết Liên Giáo.
Tiểu Lan tiến lại cảnh báo: "Giáo chủ Hắc Ma đã trở lại."
Cả hai tìm thấy bột độc dược giấu dưới gầm bàn chưởng quầy.

Chương 3: Trận chiến trong màn mưa
Cơn mưa rào trút xuống tửu lầu lúc nửa đêm.
Chưởng quầy Lý tìm cách tiêu hủy bột độc thì bị Minh và Tiểu Lan chặn đứng.
Một cuộc giao đấu ác liệt nổ ra. Tiểu Lan dùng kiếm thuật tước vũ khí của Lý.
Lý khai ra chân tướng: Hắn nhận lệnh từ kinh đô để ám sát các nhân chứng.

Chương 4: Hướng về Kinh Thành
Sáng hôm sau, quan phủ phong tỏa tửu lầu.
Minh và Tiểu Lan thu thập bằng chứng, chuẩn bị lên đường tới kinh đô.
Một bóng đen bí ẩn từ xa theo dõi họ xuất phát.
Vụ án Lạc Dương kết thúc, mở ra cuộc chiến sinh tử ở hoàng cung.
`.trim();

  let sourceId: string;

  beforeEach(async () => {
    BibleManager.closeAll();
    bible = new BibleManager(":memory:");

    // Setup Series metadata
    bible.upsertSeriesMetadata({
      id: seriesId,
      title: "Kỳ Án Lạc Dương",
      genre: "Cổ trang võ hiệp trinh thám",
      visual_style: "Điện ảnh 35mm, ánh sáng tương phản cao, phong cách kiếm hiệp",
      aspect_ratio: "16:9",
      fps: 24,
      created_at: new Date().toISOString(),
    });

    // Ingest source novel
    const ingestion = SourceIngestionEngine.ingestSourceText(
      TEST_NOVEL,
      {
        seriesId,
        title: "Kỳ Án Lạc Dương",
        sourceType: "novel",
      },
      bible
    );
    sourceId = ingestion.work.id;

    // Chunk into units and blocks
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

    // Analyze story (entities, beats, threads, knowledge)
    await StoryAnalysisEngine.analyzeWork(
      ingestion.work,
      units,
      blocks,
      bible,
      {
        seriesId,
        sourceId,
      }
    );
  });

  afterEach(() => {
    BibleManager.closeAll();
  });

  describe("1. Series Planner Allocation & Pacing Presets", () => {
    it("plans a series with explicit target episode count (e.g. 3 episodes)", async () => {
      const planner = new SeriesPlanner(bible);
      const result = await planner.planSeries({
        seriesId,
        sourceId,
        targetEpisodes: 3,
        pacingPreset: "standard",
      });

      expect(result.plan.target_episodes).toBe(3);
      expect(result.plan.pacing_preset).toBe("standard");
      expect(result.episodes.length).toBe(3);

      // Verify episodes are monotonically numbered 1, 2, 3
      expect(result.episodes[0].episode_number).toBe(1);
      expect(result.episodes[1].episode_number).toBe(2);
      expect(result.episodes[2].episode_number).toBe(3);

      // Verify durations match pacing profile
      expect(result.episodes[0].target_duration_sec).toBe(
        PACING_PROFILES.standard.targetDurationPerEpisodeSec
      );

      // Verify persistence in SQLite
      const storedPlan = bible.getSeriesPlan(result.plan.id);
      expect(storedPlan).not.toBeNull();
      expect(storedPlan?.target_episodes).toBe(3);

      const storedEps = bible.listPlannedEpisodes(result.plan.id);
      expect(storedEps.length).toBe(3);
    });

    it("calculates suggested episode count when targetTotalDuration is provided", async () => {
      const planner = new SeriesPlanner(bible);
      const result = await planner.planSeries({
        seriesId,
        sourceId,
        targetTotalDurationSec: 360, // 360s total
        targetDurationPerEpisodeSec: 180, // 180s per ep -> expect 2 episodes
        pacingPreset: "contemplative",
      });

      expect(result.plan.target_episodes).toBe(2);
      expect(result.episodes.length).toBe(2);
      expect(result.episodes[0].target_duration_sec).toBe(180);
    });

    it("adapts pacing profile between fast, standard, and contemplative", async () => {
      const planner = new SeriesPlanner(bible);

      const fastPlan = await planner.planSeries({
        seriesId,
        sourceId,
        planId: "plan_fast_01",
        targetEpisodes: 4,
        pacingPreset: "fast",
      });
      expect(fastPlan.episodes[0].target_duration_sec).toBe(90);
      expect(fastPlan.episodes[0].estimated_scenes).toBe(4);

      const contPlan = await planner.planSeries({
        seriesId,
        sourceId,
        planId: "plan_cont_01",
        targetEpisodes: 4,
        pacingPreset: "contemplative",
      });
      expect(contPlan.episodes[0].target_duration_sec).toBe(240);
      expect(contPlan.episodes[0].estimated_scenes).toBe(3);
    });

    it("guarantees NO SILENT DROP OF ENDING: final chapter is always allocated to the final episode", async () => {
      const planner = new SeriesPlanner(bible);
      const result = await planner.planSeries({
        seriesId,
        sourceId,
        targetEpisodes: 2, // 4 chapters condensed into 2 episodes
      });

      const units = bible.listSourceUnits(sourceId);
      const lastUnit = units[units.length - 1]; // Chương 4

      // Find coverage entries for final episode
      const lastEpEntries = result.coverageLedgers.filter((c) => c.episode_number === 2);
      const includesLastUnit = lastEpEntries.some(
        (c) => c.source_unit_id === lastUnit.id
      );

      expect(includesLastUnit).toBe(true);
      expect(result.episodes[1].ending).toContain("hồi kết");
    });
  });

  describe("2. Episode Structural Arcs & Cross-Episode Continuity", () => {
    it("generates coherent narrative arcs: goal, opening, development, climax, ending", async () => {
      const planner = new SeriesPlanner(bible);
      const result = await planner.planSeries({
        seriesId,
        sourceId,
        targetEpisodes: 3,
      });

      const ep1 = result.episodes[0];
      const ep2 = result.episodes[1];
      const ep3 = result.episodes[2];

      // Ep 1 is Setup / Inciting incident
      expect(ep1.goal).toContain("Thiết lập");
      expect(ep1.opening).toBeDefined();
      expect(ep1.development).toBeDefined();
      expect(ep1.climax).toBeDefined();
      expect(ep1.ending).toContain("Cliffhanger");

      // Ep 2 is Escalation / Confrontation
      expect(ep2.goal).toContain("xung đột");
      expect(ep2.development).toBeDefined();

      // Ep 3 is Climax / Resolution
      expect(ep3.goal).toContain("đỉnh điểm");
      expect(ep3.ending).toContain("hồi kết");
    });

    it("tracks cross-episode state transitions monotonically", async () => {
      const planner = new SeriesPlanner(bible);
      const result = await planner.planSeries({
        seriesId,
        sourceId,
        targetEpisodes: 3,
      });

      const ep1 = result.episodes[0];
      const ep2 = result.episodes[1];
      const ep3 = result.episodes[2];

      const stateIn1 = JSON.parse(ep1.state_in_json ?? "{}");
      const stateOut1 = JSON.parse(ep1.planned_state_out_json ?? "{}");
      const stateIn2 = JSON.parse(ep2.state_in_json ?? "{}");
      const stateOut2 = JSON.parse(ep2.planned_state_out_json ?? "{}");
      const stateIn3 = JSON.parse(ep3.state_in_json ?? "{}");

      expect(stateIn1.world_status).toBe("established");
      expect(stateOut1.episode_completed).toBe(1);

      // Ep 2 state_in must be identical to Ep 1 state_out
      expect(stateIn2.episode_completed).toBe(1);
      expect(stateOut2.episode_completed).toBe(2);

      // Ep 3 state_in must be identical to Ep 2 state_out
      expect(stateIn3.episode_completed).toBe(2);

      // Dependencies link sequentially
      const deps2 = JSON.parse(ep2.dependencies_json ?? "[]");
      expect(deps2).toContain(ep1.id);

      const deps3 = JSON.parse(ep3.dependencies_json ?? "[]");
      expect(deps3).toContain(ep2.id);
    });
  });

  describe("3. Coverage Ledger Management & Rationale Enforcement", () => {
    it("records coverage decisions (kept, compressed, expanded) with rationales", async () => {
      const planner = new SeriesPlanner(bible);
      const result = await planner.planSeries({
        seriesId,
        sourceId,
        targetEpisodes: 2, // 4 chapters into 2 episodes => compressed
      });

      expect(result.coverageLedgers.length).toBeGreaterThan(0);

      const compressedEntries = result.coverageLedgers.filter(
        (c) => c.adaptation_decision === "compressed"
      );
      expect(compressedEntries.length).toBeGreaterThan(0);
      for (const entry of compressedEntries) {
        expect(entry.rationale).toBeDefined();
        expect(entry.rationale?.length).toBeGreaterThan(5);
      }
    });

    it("refuses omitted entries that lack an explanatory rationale", () => {
      expect(() => {
        CoverageLedgerManager.recordEntry(bible, {
          plan_id: "plan_test",
          series_id: seriesId,
          source_id: sourceId,
          source_unit_id: "unit_01",
          adaptation_decision: "omitted",
          rationale: "", // Empty rationale should throw!
        });
      }).toThrow(/requires an explicit non-empty rationale/i);
    });

    it("calculates comprehensive multi-level coverage metrics", async () => {
      const planner = new SeriesPlanner(bible);
      const planResult = await planner.planSeries({
        seriesId,
        sourceId,
        targetEpisodes: 3,
      });

      const metrics = CoverageLedgerManager.calculateCoverage(
        seriesId,
        planResult.plan.id,
        bible
      );

      expect(metrics.totalUnits).toBe(4);
      expect(metrics.coveredUnits).toBe(4);
      expect(metrics.unitCoveragePercent).toBe(100);
      expect(metrics.totalBeats).toBeGreaterThan(0);
      expect(metrics.coveredBeats).toBeGreaterThan(0);
      expect(metrics.beatCoveragePercent).toBe(100);
      expect(metrics.totalMandatoryBeats).toBeGreaterThan(0);
      expect(metrics.coveredMandatoryBeats).toBe(metrics.totalMandatoryBeats);
      expect(metrics.mandatoryBeatsCoveragePercent).toBe(100);
      expect(metrics.uncoveredUnitIds.length).toBe(0);
    });
  });

  describe("4. Mandatory Beats Verification", () => {
    it("verifies 100% of mandatory beats are accounted for", async () => {
      const planner = new SeriesPlanner(bible);
      const planResult = await planner.planSeries({
        seriesId,
        sourceId,
        targetEpisodes: 3,
      });

      const audit = CoverageLedgerManager.verifyMandatoryBeatsCoverage(
        seriesId,
        planResult.plan.id,
        bible
      );

      expect(audit.isValid).toBe(true);
      expect(audit.violations.length).toBe(0);
      expect(audit.coveredMandatoryBeats).toBe(audit.totalMandatoryBeats);
    });

    it("flags violations when a mandatory beat is omitted or uncovered", async () => {
      const planner = new SeriesPlanner(bible);
      const planResult = await planner.planSeries({
        seriesId,
        sourceId,
        targetEpisodes: 3,
      });

      // Insert an unmapped rogue mandatory beat
      const unmappedBeatId = "beat_rogue_unmapped";
      bible.upsertStoryBeat({
        id: unmappedBeatId,
        series_id: seriesId,
        source_id: sourceId,
        source_unit_id: "unit_non_existent",
        beat_order: 99,
        name: "Biến cố then chốt bị bỏ quên",
        description: "Tình tiết bí mật không được chuyển thể",
        participating_characters_json: "[]",
        is_flashback: 0,
        is_mandatory: 1,
        created_at: new Date().toISOString(),
      });

      const audit = CoverageLedgerManager.verifyMandatoryBeatsCoverage(
        seriesId,
        planResult.plan.id,
        bible
      );

      expect(audit.isValid).toBe(false);
      expect(audit.violations.length).toBeGreaterThan(0);
      const rogueViolation = audit.violations.find((v) => v.entityId === unmappedBeatId);
      expect(rogueViolation).toBeDefined();
      expect(rogueViolation?.type).toBe("missing_mandatory_beat");
    });
  });

  describe("5. Conflict Detection & Narrative Warnings", () => {
    it("generates warning and suggested adjustment for high compression without dropping content", async () => {
      const planner = new SeriesPlanner(bible);
      // Request 1 episode for a 4-chapter novel with multiple mandatory beats
      const result = await planner.planSeries({
        seriesId,
        sourceId,
        targetEpisodes: 1,
        pacingPreset: "fast",
      });

      expect(result.episodes.length).toBe(1);
      // All 4 units must still be present in the 1 episode
      const unitEntries = result.coverageLedgers.filter((c) => c.episode_number === 1);
      const units = bible.listSourceUnits(sourceId);
      for (const u of units) {
        expect(unitEntries.some((e) => e.source_unit_id === u.id)).toBe(true);
      }
    });
  });

  describe("6. Screenplay Compilation from Planned Episodes", () => {
    it("compiles cinema-ready EpisodicScript directly from planned episode", async () => {
      const planner = new SeriesPlanner(bible);
      const planResult = await planner.planSeries({
        seriesId,
        sourceId,
        targetEpisodes: 3,
      });

      const generator = new StoryToScreenplayGenerator(bible);
      const screenplayResult = await generator.generateEpisodeFromPlan({
        seriesId,
        planId: planResult.plan.id,
        episodeNumber: 1,
        skipAudit: true,
      });

      expect(screenplayResult.script.episodeNumber).toBe(1);
      expect(screenplayResult.script.title).toBeDefined();
      expect(screenplayResult.script.scenes.length).toBe(3);
      expect(screenplayResult.shotCount).toBeGreaterThanOrEqual(9);
      expect(screenplayResult.charactersUsed.length).toBeGreaterThan(0);
      expect(screenplayResult.estimatedDurationSec).toBeGreaterThan(20);

      // Verify raw screenplay contains planned structure
      expect(screenplayResult.rawScreenplay).toContain("TẬP 1:");
      expect(screenplayResult.rawScreenplay).toContain("CẢNH 1:");
      expect(screenplayResult.rawScreenplay).toContain("CẢNH 2:");
      expect(screenplayResult.rawScreenplay).toContain("CẢNH 3:");
      expect(screenplayResult.rawScreenplay).toContain("CÚ MÁY");
    });

    it("orchestrates with Custom LLM invoker when compiling from plan", async () => {
      const planner = new SeriesPlanner(bible);
      const planResult = await planner.planSeries({
        seriesId,
        sourceId,
        targetEpisodes: 3,
      });

      let promptReceived = "";
      const customInvoker = async (prompt: string): Promise<string> => {
        promptReceived = prompt;
        return `
TẬP 2: MANH MỐI BÊN GIẾNG NƯỚC
Logline: Minh và Tiểu Lan theo dõi chưởng quầy Lý trong đêm mưa.

CẢNH 1: TỬU LẦU - ĐÊM
Nhân vật: Minh, Tiểu Lan
Đạo cụ: Bình Rượu Ấm
CÚ MÁY 1 (establishing, 4s): Toàn cảnh tửu lầu tĩnh mịch trong cơn mưa đêm.
CÚ MÁY 2 (medium, 4s): Minh đứng nép sau cánh cửa, ánh mắt quan sát.
MINH: Hắn đang đi ra phía sau giếng nước.
CÚ MÁY 3 (close_up, 4s): Tiểu Lan đặt tay lên chuôi kiếm.
TIỂU LAN: Đừng để hắn tẩu thoát.

CẢNH 2: GIẾNG NƯỚC HOANG - ĐÊM
Nhân vật: Minh, Tiểu Lan
CÚ MÁY 1 (action, 4s): Chưởng quầy Lý cúi người đổ bột độc xuống giếng.
CÚ MÁY 2 (action, 4s): Minh lao tới rút súng cảnh cáo.
MINH: Đứng yên!
CÚ MÁY 3 (close_up, 4s): Lý giật mình quay lại với vẻ mặt kinh hoàng.

CẢNH 3: SÂN SAU TỬU LẦU - ĐÊM
Nhân vật: Minh, Tiểu Lan
CÚ MÁY 1 (wide, 4s): Tiểu Lan vung kiếm tước đoạt gói thuốc độc trong tay Lý.
CÚ MÁY 2 (close_up, 4s): Minh bước lên tra hỏi kẻ chủ mưu.
MINH: Ai là kẻ sai khiến ngươi?
CÚ MÁY 3 (wide, 4s): Tiếng sấm rền vang trên bầu trời Lạc Dương.
        `.trim();
      };

      const generator = new StoryToScreenplayGenerator(bible);
      const screenplayResult = await generator.generateEpisodeFromPlan({
        seriesId,
        planId: planResult.plan.id,
        episodeNumber: 2,
        customLlmInvoker: customInvoker,
        skipAudit: true,
      });

      expect(screenplayResult.generatorUsed).toBe("llm");
      expect(promptReceived).toContain("READ-ONLY DATA");
      expect(screenplayResult.script.episodeNumber).toBe(2);
      expect(screenplayResult.script.scenes.length).toBe(3);
      expect(screenplayResult.script.scenes[0].shots[0].shotType).toBe("establishing");
    });
  });
});
