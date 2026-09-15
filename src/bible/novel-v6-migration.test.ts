import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { BibleManager } from "./bible-manager.js";

describe("Novel Ingestion & Series Planning (Migration V6)", () => {
  let manager: BibleManager;

  beforeEach(() => {
    BibleManager.closeAll();
    manager = new BibleManager(":memory:");
  });

  afterEach(() => {
    BibleManager.closeAll();
  });

  it("applies migration v6 and records it in canon_migrations", () => {
    expect(manager.isMigrationApplied(6)).toBe(true);
    const migrations = manager.getAppliedMigrations();
    const v6 = migrations.find((m) => m.version === 6);
    expect(v6).toBeDefined();
    expect(v6?.name).toBe("novel_ingestion_and_series_planning");
  });

  it("performs CRUD on source_works with versioning and hashing", () => {
    manager.upsertSourceWork({
      id: "source_novel_01",
      series_id: "series_red_lotus",
      title: "Huyết Liên Ký",
      author: "Nguyễn Du",
      source_type: "novel",
      current_revision: 1,
      content_hash: "hash_abc_123",
      raw_text: "Hồi 1: Tiết thanh minh...",
      normalized_text: "Hồi 1: Tiết thanh minh...",
      normalization_rules_json: JSON.stringify({ strip_headers: true }),
      metadata_json: JSON.stringify({ genre: "wuxia" }),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    const work = manager.getSourceWork("source_novel_01");
    expect(work).not.toBeNull();
    expect(work?.title).toBe("Huyết Liên Ký");
    expect(work?.content_hash).toBe("hash_abc_123");
    expect(work?.current_revision).toBe(1);

    // Update revision
    manager.upsertSourceWork({
      ...work!,
      current_revision: 2,
      content_hash: "hash_xyz_789",
    });

    const updated = manager.getSourceWork("source_novel_01");
    expect(updated?.current_revision).toBe(2);
    expect(updated?.content_hash).toBe("hash_xyz_789");

    const works = manager.listSourceWorks("series_red_lotus");
    expect(works.length).toBe(1);
  });

  it("stores source_units (chapters) and maintains order_index", () => {
    manager.upsertSourceWork({
      id: "source_01",
      series_id: "series_test",
      title: "Test Novel",
      source_type: "novel",
      current_revision: 1,
      content_hash: "hash01",
      raw_text: "Raw novel text",
      normalized_text: "Normalized novel text",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    manager.batchUpsertSourceUnits([
      {
        id: "unit_ch_02",
        source_id: "source_01",
        series_id: "series_test",
        revision: 1,
        unit_type: "chapter",
        unit_number: 2,
        title: "Chương 2: Biến cố tại kinh thành",
        order_index: 2,
        char_start: 500,
        char_end: 1200,
        raw_text: "Đêm hôm đó kinh thành dậy sóng...",
        summary: "Kinh thành hỗn loạn",
        token_count_estimate: 250,
      },
      {
        id: "unit_ch_01",
        source_id: "source_01",
        series_id: "series_test",
        revision: 1,
        unit_type: "chapter",
        unit_number: 1,
        title: "Chương 1: Khởi đầu",
        order_index: 1,
        char_start: 0,
        char_end: 500,
        raw_text: "Gió thu hiu hắt...",
        summary: "Giới thiệu nhân vật chính",
        token_count_estimate: 180,
      },
    ]);

    const units = manager.listSourceUnits("source_01");
    expect(units.length).toBe(2);
    // Verified sorted by order_index ascending
    expect(units[0].id).toBe("unit_ch_01");
    expect(units[1].id).toBe("unit_ch_02");
    expect(units[0].order_index).toBe(1);
    expect(units[1].order_index).toBe(2);
  });

  it("stores source_blocks (paragraphs) with byte offsets and dialogue metadata", () => {
    // Parent source work and unit
    manager.upsertSourceWork({
      id: "source_01",
      series_id: "series_test",
      title: "Test Novel",
      source_type: "novel",
      current_revision: 1,
      content_hash: "hash01",
      raw_text: "Raw novel text",
      normalized_text: "Normalized novel text",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    manager.upsertSourceUnit({
      id: "unit_ch_01",
      source_id: "source_01",
      series_id: "series_test",
      revision: 1,
      unit_type: "chapter",
      unit_number: 1,
      title: "Chương 1: Khởi đầu",
      order_index: 1,
      char_start: 0,
      char_end: 500,
      raw_text: "Gió thu hiu hắt...",
      summary: "Giới thiệu nhân vật chính",
      token_count_estimate: 180,
    });

    manager.batchUpsertSourceBlocks([
      {
        id: "block_01",
        source_id: "source_01",
        unit_id: "unit_ch_01",
        series_id: "series_test",
        revision: 1,
        block_index: 1,
        char_start: 0,
        char_end: 150,
        content: "Trời thu mây xám xịt trên bầu trời thành Lạc Dương.",
        is_dialogue: 0,
      },
      {
        id: "block_02",
        source_id: "source_01",
        unit_id: "unit_ch_01",
        series_id: "series_test",
        revision: 1,
        block_index: 2,
        char_start: 151,
        char_end: 220,
        content: '"Ngươi có chắc chắn tin này không?" - Minh hỏi.',
        is_dialogue: 1,
        speaker_candidate: "Minh",
      },
    ]);

    const blocks = manager.listSourceBlocks("unit_ch_01");
    expect(blocks.length).toBe(2);
    expect(blocks[0].is_dialogue).toBe(0);
    expect(blocks[1].is_dialogue).toBe(1);
    expect(blocks[1].speaker_candidate).toBe("Minh");
  });

  it("tracks story beats, flashbacks, and non-linear narrative time", () => {
    manager.upsertSourceWork({
      id: "source_01",
      series_id: "series_test",
      title: "Test Novel",
      source_type: "novel",
      current_revision: 1,
      content_hash: "hash01",
      raw_text: "Raw novel text",
      normalized_text: "Normalized novel text",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    manager.batchUpsertStoryBeats([
      {
        id: "beat_01",
        source_id: "source_01",
        series_id: "series_test",
        beat_order: 1, // Telling order 1
        name: "Phát hiện án mạng",
        description: "Thám tử Minh phát hiện thi thể tại tửu lầu",
        participating_characters_json: JSON.stringify(["char_minh", "char_nan_nhan"]),
        location_id: "loc_tieu_lau",
        story_time: "10:00 AM, Ngày 1",
        is_flashback: 0,
        preconditions_json: JSON.stringify({ victim_alive: false }),
        post_state_changes_json: JSON.stringify({ investigation_started: true }),
        is_mandatory: 1,
      },
      {
        id: "beat_02",
        source_id: "source_01",
        series_id: "series_test",
        beat_order: 2, // Telling order 2
        name: "Ký ức 5 năm trước tại biên ải",
        description: "Minh nhớ lại lời trăn trối của sư phụ",
        participating_characters_json: JSON.stringify(["char_minh", "char_su_phu"]),
        location_id: "loc_bien_ai",
        story_time: "5 năm trước", // Story time is earlier!
        is_flashback: 1,
        is_mandatory: 1,
      },
    ]);

    const beats = manager.listStoryBeats("series_test");
    expect(beats.length).toBe(2);
    expect(beats[0].is_flashback).toBe(0);
    expect(beats[1].is_flashback).toBe(1);
    expect(beats[1].story_time).toBe("5 năm trước");
    expect(beats[1].is_mandatory).toBe(1);
  });

  it("manages story threads with setups, payoffs, and statuses", () => {
    manager.upsertStoryThread({
      id: "thread_poison_dagger",
      series_id: "series_test",
      name: "Bí mật đoản đao tẩm độc",
      thread_type: "mystery",
      description: "Thanh đoản đao để lại hiện trường có dấu vết độc môn",
      setup_beat_id: "beat_01",
      payoff_beat_id: "beat_10",
      status: "open",
      dependencies_json: JSON.stringify(["thread_master_revenge"]),
    });

    const thread = manager.getStoryThread("thread_poison_dagger");
    expect(thread).not.toBeNull();
    expect(thread?.thread_type).toBe("mystery");
    expect(thread?.setup_beat_id).toBe("beat_01");
    expect(thread?.status).toBe("open");

    // Payoff resolved
    manager.upsertStoryThread({
      ...thread!,
      status: "resolved",
    });
    expect(manager.getStoryThread("thread_poison_dagger")?.status).toBe("resolved");
  });

  it("tracks 4-dimensional epistemic knowledge states (facts vs character/audience)", () => {
    // 1. Source fact
    manager.recordKnowledgeState({
      series_id: "series_test",
      fact_key: "killer_identity",
      fact_type: "source_fact",
      notes: "Sát thủ thực sự là quản gia",
    });

    // 2. Character knowledge (only revealed in episode 3)
    manager.recordKnowledgeState({
      series_id: "series_test",
      fact_key: "killer_identity",
      fact_type: "character_knowledge",
      entity_id: "char_minh",
      revealed_at_episode: 3,
      revealed_at_beat_id: "beat_reveal_03",
      notes: "Minh phát hiện vết sẹo của quản gia",
    });

    // 3. Audience knowledge (revealed to audience via flashback in episode 1)
    manager.recordKnowledgeState({
      series_id: "series_test",
      fact_key: "killer_identity",
      fact_type: "audience_knowledge",
      revealed_at_episode: 1,
      is_flashback: 1,
      notes: "Khán giả thấy quản gia bỏ độc nhưng Minh chưa biết",
    });

    const minhKnowledge = manager.listKnowledgeStates("series_test", "char_minh");
    expect(minhKnowledge.length).toBe(1);
    expect(minhKnowledge[0].revealed_at_episode).toBe(3);

    const audienceKnowledge = manager.listKnowledgeStates("series_test", undefined, "audience_knowledge");
    expect(audienceKnowledge.length).toBe(1);
    expect(audienceKnowledge[0].revealed_at_episode).toBe(1);
    expect(audienceKnowledge[0].is_flashback).toBe(1);
  });

  it("handles series plans and multi-episode outline arcs", () => {
    manager.upsertSourceWork({
      id: "source_01",
      series_id: "series_test",
      title: "Test Novel",
      source_type: "novel",
      current_revision: 1,
      content_hash: "hash01",
      raw_text: "Raw novel text",
      normalized_text: "Normalized novel text",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    manager.upsertSeriesPlan({
      id: "plan_s01",
      series_id: "series_test",
      source_id: "source_01",
      revision: 1,
      target_episodes: 3,
      target_duration_per_episode_sec: 120,
      pacing_preset: "dynamic",
      status: "active",
      warnings_json: JSON.stringify([]),
      summary_json: JSON.stringify({ arc: "Điều tra vụ án mạng quán trọ" }),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    manager.batchUpsertPlannedEpisodes([
      {
        id: "ep_plan_01",
        plan_id: "plan_s01",
        series_id: "series_test",
        episode_number: 1,
        title: "Án Mạng Trong Mưa",
        logline: "Thám tử Minh tới tửu lầu và phát hiện vụ giết người bí ẩn",
        goal: "Xác nhận hiện trường và bảo vệ nhân chứng",
        opening: "Mưa rơi tầm tã trên mái ngói",
        development: "Minh tra hỏi chưởng quầy",
        climax: "Phát hiện hung khí giấu trong giếng nước",
        ending: "Bóng đen lướt qua mái nhà",
        target_duration_sec: 120,
        state_in_json: JSON.stringify({ minh_arrived: true }),
        planned_state_out_json: JSON.stringify({ weapon_found: true }),
        dependencies_json: JSON.stringify([]),
        estimated_scenes: 3,
        estimated_shots: 12,
      },
      {
        id: "ep_plan_02",
        plan_id: "plan_s01",
        series_id: "series_test",
        episode_number: 2,
        title: "Manh Mối Đứt Đoạn",
        logline: "Nhân chứng bị mưu sát, Minh phát hiện độc dược bí truyền",
        target_duration_sec: 120,
        estimated_scenes: 4,
        estimated_shots: 15,
      },
    ]);

    const activePlan = manager.getActiveSeriesPlan("series_test");
    expect(activePlan).not.toBeNull();
    expect(activePlan?.id).toBe("plan_s01");
    expect(activePlan?.target_episodes).toBe(3);

    const episodes = manager.listPlannedEpisodes("plan_s01");
    expect(episodes.length).toBe(2);
    expect(episodes[0].episode_number).toBe(1);
    expect(episodes[0].goal).toBe("Xác nhận hiện trường và bảo vệ nhân chứng");
    expect(episodes[1].episode_number).toBe(2);
  });

  it("maintains a coverage ledger mapping source units to adaptation episodes", () => {
    manager.upsertSourceWork({
      id: "source_01",
      series_id: "series_test",
      title: "Test Novel",
      source_type: "novel",
      current_revision: 1,
      content_hash: "hash01",
      raw_text: "Raw novel text",
      normalized_text: "Normalized novel text",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    manager.batchUpsertSourceUnits([
      {
        id: "unit_ch_01",
        source_id: "source_01",
        series_id: "series_test",
        revision: 1,
        unit_type: "chapter",
        unit_number: 1,
        title: "Chương 1",
        order_index: 1,
        char_start: 0,
        char_end: 100,
        raw_text: "Chương 1 text",
      },
      {
        id: "unit_ch_02",
        source_id: "source_01",
        series_id: "series_test",
        revision: 1,
        unit_type: "chapter",
        unit_number: 2,
        title: "Chương 2",
        order_index: 2,
        char_start: 101,
        char_end: 200,
        raw_text: "Chương 2 text",
      },
      {
        id: "unit_ch_03",
        source_id: "source_01",
        series_id: "series_test",
        revision: 1,
        unit_type: "chapter",
        unit_number: 3,
        title: "Chương 3",
        order_index: 3,
        char_start: 201,
        char_end: 300,
        raw_text: "Chương 3 text",
      },
    ]);

    manager.upsertSeriesPlan({
      id: "plan_s01",
      series_id: "series_test",
      source_id: "source_01",
      revision: 1,
      target_episodes: 3,
      target_duration_per_episode_sec: 120,
      pacing_preset: "dynamic",
      status: "active",
      warnings_json: JSON.stringify([]),
      summary_json: JSON.stringify({}),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    manager.batchUpsertCoverageLedgers([
      {
        id: "cov_01",
        plan_id: "plan_s01",
        series_id: "series_test",
        source_id: "source_01",
        source_unit_id: "unit_ch_01",
        episode_number: 1,
        scene_number: 1,
        adaptation_decision: "kept",
        rationale: "Mở đầu trung thành với nguyên tác",
        mandatory_beat_id: "beat_01",
      },
      {
        id: "cov_02",
        plan_id: "plan_s01",
        series_id: "series_test",
        source_id: "source_01",
        source_unit_id: "unit_ch_02",
        episode_number: 1,
        scene_number: 2,
        adaptation_decision: "compressed",
        rationale: "Rút gọn miêu tả ngoại cảnh để đẩy nhanh nhịp phim",
      },
      {
        id: "cov_03",
        plan_id: "plan_s01",
        series_id: "series_test",
        source_id: "source_01",
        source_unit_id: "unit_ch_03",
        adaptation_decision: "omitted",
        rationale: "Tuyến nhân vật phụ không ảnh hưởng cốt truyện chính",
      },
    ]);

    const ledgers = manager.listCoverageLedgers("plan_s01");
    expect(ledgers.length).toBe(3);
    expect(ledgers.find((l) => l.adaptation_decision === "omitted")?.rationale).toBe(
      "Tuyến nhân vật phụ không ảnh hưởng cốt truyện chính"
    );
    expect(ledgers.find((l) => l.mandatory_beat_id === "beat_01")?.adaptation_decision).toBe("kept");
  });

  it("enforces strict series isolation across all migration v6 entities", () => {
    // Series Alpha
    manager.upsertSourceWork({
      id: "work_alpha",
      series_id: "series_alpha",
      title: "Alpha Chronicle",
      source_type: "novel",
      current_revision: 1,
      content_hash: "hash_a",
      raw_text: "Alpha text",
      normalized_text: "Alpha text",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    // Series Beta
    manager.upsertSourceWork({
      id: "work_beta",
      series_id: "series_beta",
      title: "Beta Saga",
      source_type: "novel",
      current_revision: 1,
      content_hash: "hash_b",
      raw_text: "Beta text",
      normalized_text: "Beta text",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    // Verify isolation in listSourceWorks
    const alphaWorks = manager.listSourceWorks("series_alpha");
    expect(alphaWorks.length).toBe(1);
    expect(alphaWorks[0].title).toBe("Alpha Chronicle");

    const betaWorks = manager.listSourceWorks("series_beta");
    expect(betaWorks.length).toBe(1);
    expect(betaWorks[0].title).toBe("Beta Saga");
  });
});
