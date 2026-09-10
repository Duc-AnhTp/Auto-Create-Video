import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, rmSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import {
  BibleManager,
  FatalSqliteError,
  DeltaValidationError,
  UnauthorizedCanonCommitError,
  InvalidLifecycleTransitionError,
  type NarrativeDelta,
  type EpisodeSummaryRecord,
} from "./bible-manager.js";
import { ContinuityAuditor } from "./continuity-auditor.js";

const TEST_DIR = join(process.cwd(), "output", "test-versioned-canon");
const TEST_DB_PATH = join(TEST_DIR, "canon_test.db");

let activeBibles: BibleManager[] = [];
function createTestBible(path = TEST_DB_PATH, options?: any): BibleManager {
  const b = new BibleManager(path, options);
  activeBibles.push(b);
  return b;
}

describe("Versioned Canon State Manager (Story Bible v2)", () => {
  beforeEach(() => {
    for (const b of activeBibles) {
      try {
        b.close();
      } catch {}
    }
    activeBibles = [];
    if (existsSync(TEST_DIR)) {
      try {
        rmSync(TEST_DIR, { recursive: true, force: true });
      } catch {}
    }
    mkdirSync(TEST_DIR, { recursive: true });
  });

  afterEach(() => {
    for (const b of activeBibles) {
      try {
        b.close();
      } catch {}
    }
    activeBibles = [];
    if (existsSync(TEST_DIR)) {
      try {
        rmSync(TEST_DIR, { recursive: true, force: true });
      } catch {}
    }
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 1. Archetype vs Mutable Episodic State Separation & Event Logging
  // ──────────────────────────────────────────────────────────────────────────
  describe("Yêu cầu 1 & 2: Archetype vs Mutable State & Event Logging", () => {
    it("separates permanent character archetype from mutable episodic/scene state", () => {
      const bible = createTestBible(TEST_DB_PATH);
      bible.upsertSeriesMetadata({
        id: "cyber-saigon",
        title: "Sài Gòn 2088",
        visual_style: "Cyberpunk Noir",
        aspect_ratio: "9:16",
        fps: 30,
        created_at: new Date().toISOString(),
      });

      // 1. Register permanent archetype in `characters`
      bible.upsertCharacter({
        id: "char_minh",
        name: "Minh",
        role: "protagonist",
        visual_summary: "Nam, 32 tuổi, mắt đen kiên nghị, áo khoác da sờn",
        personality_traits: ["quả cảm", "trầm tính"],
        status: "alive",
      });

      const archetype = bible.getCharacterArchetype("char_minh");
      expect(archetype).toBeDefined();
      expect(archetype?.name).toBe("Minh");
      expect(archetype?.visual_summary).toBe("Nam, 32 tuổi, mắt đen kiên nghị, áo khoác da sờn");
      // Archetype should not contain mutable runtime fields
      expect((archetype as any).status).toBeUndefined();

      // 2. Set episodic states across episodes
      bible.setCharacterState({
        character_id: "char_minh",
        episode_number: 1,
        scene_id: "sc01",
        status: "alive",
        current_wardrobe_id: "wardrobe_combat",
        distinguishing_marks: "Không có vết thương",
      });

      bible.setCharacterState({
        character_id: "char_minh",
        episode_number: 2,
        scene_id: "sc05",
        status: "injured",
        current_wardrobe_id: "wardrobe_hospital",
        distinguishing_marks: "Vết sẹo laser ở vai phải",
      });

      // Query state for Ep 1 vs Ep 2
      const stateEp1 = bible.getCharacterState("char_minh", 1);
      expect(stateEp1?.status).toBe("alive");
      expect(stateEp1?.distinguishing_marks).toBe("Không có vết thương");

      const stateEp2 = bible.getCharacterState("char_minh", 2);
      expect(stateEp2?.status).toBe("injured");
      expect(stateEp2?.distinguishing_marks).toBe("Vết sẹo laser ở vai phải");

      // Archetype remains unchanged
      expect(bible.getCharacterArchetype("char_minh")?.name).toBe("Minh");
    });

    it("records granular state transition event log with temporal anchor and confirmation source", () => {
      const bible = createTestBible(TEST_DB_PATH);
      bible.upsertSeriesMetadata({
        id: "cyber-saigon",
        title: "Sài Gòn 2088",
        visual_style: "Cyberpunk Noir",
        aspect_ratio: "9:16",
        fps: 30,
        created_at: new Date().toISOString(),
      });

      bible.recordStateEvent({
        series_id: "cyber-saigon",
        episode_number: 1,
        scene_id: "sc02_bar",
        entity_type: "character",
        entity_id: "char_minh",
        event_type: "status_change",
        from_state_json: JSON.stringify({ status: "alive" }),
        to_state_json: JSON.stringify({ status: "injured", reason: "gunshot" }),
        story_time: "23:45 Đêm mưa bão 2088",
        confirmation_source: "director_approval",
      });

      const events = bible.listStateEvents({
        seriesId: "cyber-saigon",
        episodeNumber: 1,
        entityId: "char_minh",
      });

      expect(events.length).toBe(1);
      expect(events[0].entity_type).toBe("character");
      expect(events[0].scene_id).toBe("sc02_bar");
      expect(events[0].story_time).toBe("23:45 Đêm mưa bão 2088");
      expect(events[0].confirmation_source).toBe("director_approval");
      expect(JSON.parse(events[0].to_state_json).status).toBe("injured");
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 2. Narrative Delta Reference Validation
  // ──────────────────────────────────────────────────────────────────────────
  describe("Yêu cầu 5: Narrative Delta Validation trước khi cập nhật Canon", () => {
    let bible: BibleManager;

    beforeEach(() => {
      bible = createTestBible(TEST_DB_PATH);
      bible.upsertCharacter({
        id: "char_minh",
        name: "Minh",
        role: "protagonist",
        visual_summary: "Minh",
        personality_traits: ["brave"],
        status: "alive",
      });
      bible.upsertCharacter({
        id: "char_hung",
        name: "Hùng",
        role: "antagonist",
        visual_summary: "Hùng",
        personality_traits: ["ruthless"],
        status: "deceased",
      });
      bible.upsertKeyProp({
        id: "prop_chip",
        name: "Quantum Chip",
        visual_summary: "Chip lượng tử phát sáng xanh",
        current_holder_id: "char_minh",
        status: "intact",
      });
      bible.upsertWardrobe({
        id: "wardrobe_minh_suit",
        character_id: "char_minh",
        outfit_name: "Combat Suit",
        visual_description: "Áo giáp tác chiến",
      });
    });

    it("validates that characters in delta exist in canon", () => {
      const invalidDelta: NarrativeDelta = {
        character_status_updates: [
          { id: "ghost_character", status: "injured", distinguishing_marks: "scar" },
        ],
      };
      const validation = bible.validateNarrativeDelta(invalidDelta);
      expect(validation.valid).toBe(false);
      expect(validation.errors.some((e) => e.includes("ghost_character"))).toBe(true);
    });

    it("validates that wardrobe updates belong to the referenced character", () => {
      const invalidDelta: NarrativeDelta = {
        character_wardrobe_updates: [
          { character_id: "char_hung", wardrobe_id: "wardrobe_minh_suit" },
        ],
      };
      const validation = bible.validateNarrativeDelta(invalidDelta);
      expect(validation.valid).toBe(false);
      expect(validation.errors.some((e) => e.includes("does not belong"))).toBe(true);
    });

    it("rejects prop transfer to non-existent holder", () => {
      const invalidDelta: NarrativeDelta = {
        prop_transfers: [
          { prop_id: "prop_chip", new_holder_id: "unknown_person" },
        ],
      };
      const validation = bible.validateNarrativeDelta(invalidDelta);
      expect(validation.valid).toBe(false);
      expect(validation.errors.some((e) => e.includes("unknown_person"))).toBe(true);
    });

    it("rejects prop transfer to deceased character", () => {
      const invalidDelta: NarrativeDelta = {
        prop_transfers: [
          { prop_id: "prop_chip", new_holder_id: "char_hung" },
        ],
      };
      const validation = bible.validateNarrativeDelta(invalidDelta);
      expect(validation.valid).toBe(false);
      expect(validation.errors.some((e) => e.includes("deceased character"))).toBe(true);
    });

    it("passes validation for sound and consistent narrative delta", () => {
      bible.upsertCharacter({
        id: "char_an",
        name: "An",
        role: "supporting",
        visual_summary: "An, kỹ sư trẻ",
        personality_traits: ["smart"],
        status: "alive",
      });

      const validDelta: NarrativeDelta = {
        character_status_updates: [
          { id: "char_minh", status: "injured", distinguishing_marks: "vết cắt cánh tay" },
        ],
        character_wardrobe_updates: [
          { character_id: "char_minh", wardrobe_id: "wardrobe_minh_suit" },
        ],
        prop_transfers: [
          { prop_id: "prop_chip", new_holder_id: "char_an" },
        ],
      };
      const validation = bible.validateNarrativeDelta(validDelta);
      expect(validation.valid).toBe(true);
      expect(validation.errors.length).toBe(0);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 3. Episode Lifecycle State Machine & Canon Protection
  // ──────────────────────────────────────────────────────────────────────────
  describe("Yêu cầu 4 & 7: Episode Lifecycle & Bảo vệ Canon trước bản chưa duyệt", () => {
    let bible: BibleManager;

    beforeEach(() => {
      bible = createTestBible(TEST_DB_PATH);
      bible.upsertSeriesMetadata({
        id: "series_alpha",
        title: "Alpha Series",
        visual_style: "Cinematic",
        aspect_ratio: "16:9",
        fps: 30,
        created_at: new Date().toISOString(),
      });
      bible.upsertCharacter({
        id: "char_a",
        name: "Nhân vật A",
        role: "protagonist",
        visual_summary: "A",
        personality_traits: [],
        status: "alive",
      });
      bible.upsertCharacter({
        id: "char_b",
        name: "Nhân vật B",
        role: "supporting",
        visual_summary: "B",
        personality_traits: [],
        status: "alive",
      });
      bible.upsertKeyProp({
        id: "prop_key",
        name: "Chìa khóa vàng",
        visual_summary: "Vàng nguyên khối",
        current_holder_id: "char_a",
        status: "intact",
      });
    });

    it("enforces strict lifecycle status progression: draft -> rendered -> approved -> committed", () => {
      bible.setEpisodeLifecycle({
        seriesId: "series_alpha",
        episodeNumber: 1,
        status: "draft",
      });

      expect(bible.getEpisodeLifecycle("series_alpha", 1)?.status).toBe("draft");

      // Valid: draft -> rendered
      bible.setEpisodeLifecycle({
        seriesId: "series_alpha",
        episodeNumber: 1,
        status: "rendered",
      });
      expect(bible.getEpisodeLifecycle("series_alpha", 1)?.status).toBe("rendered");

      // Valid: rendered -> approved
      bible.setEpisodeLifecycle({
        seriesId: "series_alpha",
        episodeNumber: 1,
        status: "approved",
      });
      expect(bible.getEpisodeLifecycle("series_alpha", 1)?.status).toBe("approved");

      // Valid: approved -> committed
      bible.setEpisodeLifecycle({
        seriesId: "series_alpha",
        episodeNumber: 1,
        status: "committed",
      });
      expect(bible.getEpisodeLifecycle("series_alpha", 1)?.status).toBe("committed");
    });

    it("rejects invalid lifecycle jumps (e.g. draft directly to committed)", () => {
      bible.setEpisodeLifecycle({
        seriesId: "series_alpha",
        episodeNumber: 1,
        status: "draft",
      });

      expect(() => {
        bible.setEpisodeLifecycle({
          seriesId: "series_alpha",
          episodeNumber: 1,
          status: "committed",
        });
      }).toThrow(InvalidLifecycleTransitionError);
    });

    it("Nghiệm thu: Tập chưa duyệt (draft hoặc rendered) KHÔNG thay đổi người giữ đạo cụ trong canon chính thức", () => {
      bible.setEpisodeLifecycle({
        seriesId: "series_alpha",
        episodeNumber: 1,
        status: "draft",
      });

      const summary: EpisodeSummaryRecord = {
        episode_number: 1,
        title: "Tập 1 Bản Thảo",
        logline: "Bản nháp chưa duyệt",
        major_events: ["A giao chìa khóa cho B"],
        delta_changes: {},
        created_at: new Date().toISOString(),
      };

      const delta: NarrativeDelta = {
        prop_transfers: [{ prop_id: "prop_key", new_holder_id: "char_b" }],
      };

      // Committing while status is 'draft' must fail with UnauthorizedCanonCommitError
      expect(() => {
        bible.commitEpisode(summary, delta, { seriesId: "series_alpha" });
      }).toThrow(UnauthorizedCanonCommitError);

      // Verify key prop holder in canon is STILL char_a (untouched)
      const prop = bible.getKeyProp("prop_key");
      expect(prop?.current_holder_id).toBe("char_a");

      // Advance to 'rendered', should still throw
      bible.setEpisodeLifecycle({
        seriesId: "series_alpha",
        episodeNumber: 1,
        status: "rendered",
      });

      expect(() => {
        bible.commitEpisode(summary, delta, { seriesId: "series_alpha" });
      }).toThrow(UnauthorizedCanonCommitError);

      // Still char_a
      expect(bible.getKeyProp("prop_key")?.current_holder_id).toBe("char_a");
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 4. Transactional Commit, Idempotency & Rollback
  // ──────────────────────────────────────────────────────────────────────────
  describe("Yêu cầu 6: Transactional Commit với Idempotency", () => {
    let bible: BibleManager;

    beforeEach(() => {
      bible = createTestBible(TEST_DB_PATH);
      bible.upsertSeriesMetadata({
        id: "series_commit",
        title: "Commit Series",
        visual_style: "Cinematic",
        aspect_ratio: "16:9",
        fps: 30,
        created_at: new Date().toISOString(),
      });
      bible.upsertCharacter({
        id: "char_a",
        name: "Nhân vật A",
        role: "protagonist",
        visual_summary: "A",
        personality_traits: [],
        status: "alive",
      });
      bible.upsertCharacter({
        id: "char_b",
        name: "Nhân vật B",
        role: "supporting",
        visual_summary: "B",
        personality_traits: [],
        status: "alive",
      });
      bible.upsertKeyProp({
        id: "prop_artifact",
        name: "Cổ vật",
        visual_summary: "Cổ vật thần thoại",
        current_holder_id: "char_a",
        status: "intact",
      });

      // Prepare lifecycle as 'approved'
      bible.setEpisodeLifecycle({
        seriesId: "series_commit",
        episodeNumber: 1,
        status: "draft",
      });
      bible.setEpisodeLifecycle({
        seriesId: "series_commit",
        episodeNumber: 1,
        status: "rendered",
      });
      bible.setEpisodeLifecycle({
        seriesId: "series_commit",
        episodeNumber: 1,
        status: "approved",
      });
    });

    it("Nghiệm thu: Đạo cụ chuyển từ A sang B đúng một lần; gọi lại commit không áp dụng hai lần", () => {
      const summary: EpisodeSummaryRecord = {
        episode_number: 1,
        title: "Tập 1: Chuyển giao",
        logline: "A trao cổ vật cho B tại đền cổ",
        major_events: ["A trao cổ vật cho B"],
        delta_changes: {},
        created_at: new Date().toISOString(),
      };

      const delta: NarrativeDelta = {
        prop_transfers: [{ prop_id: "prop_artifact", new_holder_id: "char_b" }],
      };

      // 1. First commit
      const res1 = bible.commitEpisode(summary, delta, {
        seriesId: "series_commit",
        commitId: "commit_token_ep01_001",
        storyTime: "Năm 2088",
      });

      expect(res1.applied).toBe(true);
      expect(res1.commitId).toBe("commit_token_ep01_001");

      // Verify prop holder changed to B
      expect(bible.getKeyProp("prop_artifact")?.current_holder_id).toBe("char_b");

      // Verify state events recorded exactly 1 prop transfer
      const events = bible.listStateEvents({
        seriesId: "series_commit",
        episodeNumber: 1,
        entityType: "prop",
        entityId: "prop_artifact",
      });
      expect(events.length).toBe(1);
      expect(events[0].event_type).toBe("prop_transfer");
      expect(JSON.parse(events[0].to_state_json).current_holder_id).toBe("char_b");

      // 2. Re-executing the same commit ID must be idempotent (applied: false)
      const res2 = bible.commitEpisode(summary, delta, {
        seriesId: "series_commit",
        commitId: "commit_token_ep01_001",
      });

      expect(res2.applied).toBe(false);
      expect(res2.reason).toBe("already_applied");

      // Ensure no duplicate events were created
      const eventsAfter = bible.listStateEvents({
        seriesId: "series_commit",
        episodeNumber: 1,
        entityType: "prop",
        entityId: "prop_artifact",
      });
      expect(eventsAfter.length).toBe(1);
    });

    it("Nghiệm thu: Transaction thất bại không để lại trạng thái cập nhật một phần", () => {
      const summary: EpisodeSummaryRecord = {
        episode_number: 1,
        title: "Tập 1: Giao dịch hỏng",
        logline: "Giao dịch gặp lỗi delta",
        major_events: ["Thử nghiệm transaction"],
        delta_changes: {},
        created_at: new Date().toISOString(),
      };

      // Delta contains a valid character status update, BUT an invalid prop holder (ghost_holder)
      const badDelta: NarrativeDelta = {
        character_status_updates: [
          { id: "char_a", status: "injured", distinguishing_marks: "vết thương" },
        ],
        prop_transfers: [
          { prop_id: "prop_artifact", new_holder_id: "ghost_holder_not_in_db" },
        ],
      };

      // Delta validation should fail before mutation
      expect(() => {
        bible.commitEpisode(summary, badDelta, {
          seriesId: "series_commit",
          commitId: "commit_will_fail",
        });
      }).toThrow(DeltaValidationError);

      // Verify atomic consistency: char_a status was NOT updated to 'injured'
      const charA = bible.getCharacter("char_a");
      expect(charA?.status).toBe("alive");
      expect(charA?.distinguishing_marks).toBeNull();

      // Prop holder was NOT modified
      expect(bible.getKeyProp("prop_artifact")?.current_holder_id).toBe("char_a");

      // No commit recorded
      expect(bible.isCommitApplied("commit_will_fail")).toBe(false);

      // Episode summary was NOT recorded
      expect(bible.getEpisodeSummary(1)).toBeNull();
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 5. Immutable Canon Snapshots, Historical Consistency & Downstream Invalidation
  // ──────────────────────────────────────────────────────────────────────────
  describe("Yêu cầu 3 & 8: Snapshots & Historical Re-rendering Consistency", () => {
    let bible: BibleManager;

    beforeEach(() => {
      bible = createTestBible(TEST_DB_PATH);
      bible.upsertSeriesMetadata({
        id: "series_snap",
        title: "Snapshot Series",
        visual_style: "Cinematic",
        aspect_ratio: "16:9",
        fps: 30,
        created_at: new Date().toISOString(),
      });
      bible.upsertCharacter({
        id: "char_lead",
        name: "Minh",
        role: "protagonist",
        visual_summary: "Mặt lành lặn",
        personality_traits: [],
        status: "alive",
      });
      bible.upsertKeyProp({
        id: "prop_amulet",
        name: "Bùa Hộ Mệnh",
        visual_summary: "Đá ngọc bích",
        current_holder_id: "char_lead",
        status: "intact",
      });
    });

    it("Nghiệm thu: Render lại tập cũ giữ trạng thái lịch sử đúng thông qua snapshot đã gắn kết", () => {
      // 1. Episode 1 Snapshot created when lead holds amulet and has no scars
      const snapEp1 = bible.createCanonSnapshot("series_snap", 1, 1);
      expect(snapEp1.id).toBe("snap_series_snap_ep1_v1");
      expect(snapEp1.state_hash).toBeDefined();

      const snapPayload1 = JSON.parse(snapEp1.snapshot_json);
      const leadInSnap1 = snapPayload1.characters.find((c: any) => c.id === "char_lead");
      const propInSnap1 = snapPayload1.props.find((p: any) => p.id === "prop_amulet");
      expect(leadInSnap1.status).toBe("alive");
      expect(propInSnap1.current_holder_id).toBe("char_lead");

      // 2. Advance Canon in Episode 2 (lead gets injured, amulet lost)
      bible.upsertCharacter({
        id: "char_lead",
        name: "Minh",
        role: "protagonist",
        visual_summary: "Mặt lành lặn",
        personality_traits: [],
        status: "injured",
        distinguishing_marks: "Vết sẹo laser",
      });
      bible.upsertKeyProp({
        id: "prop_amulet",
        name: "Bùa Hộ Mệnh",
        visual_summary: "Đá ngọc bích",
        current_holder_id: "enemy_boss",
        status: "damaged",
      });

      const snapEp2 = bible.createCanonSnapshot("series_snap", 2, 1);
      const snapPayload2 = JSON.parse(snapEp2.snapshot_json);
      expect(snapPayload2.characters.find((c: any) => c.id === "char_lead").status).toBe("injured");
      expect(snapPayload2.props.find((p: any) => p.id === "prop_amulet").current_holder_id).toBe("enemy_boss");

      // 3. Re-render Episode 1: retrieve bound snapshot for Ep 1
      const historicalSnap = bible.getSnapshotForEpisode("series_snap", 1);
      expect(historicalSnap).toBeDefined();
      expect(historicalSnap?.id).toBe(snapEp1.id);
      expect(historicalSnap?.state_hash).toBe(snapEp1.state_hash);

      const parsedHistorical = JSON.parse(historicalSnap!.snapshot_json);
      expect(parsedHistorical.characters.find((c: any) => c.id === "char_lead").status).toBe("alive");
      expect(parsedHistorical.props.find((p: any) => p.id === "prop_amulet").current_holder_id).toBe("char_lead");
    });

    it("marks downstream dependent episodes with needs_review = true when earlier canon is modified", () => {
      // Set up episodes 1, 2, 3
      bible.setEpisodeLifecycle({
        seriesId: "series_snap",
        episodeNumber: 1,
        status: "approved",
      });
      bible.setEpisodeLifecycle({
        seriesId: "series_snap",
        episodeNumber: 2,
        status: "approved",
      });
      bible.setEpisodeLifecycle({
        seriesId: "series_snap",
        episodeNumber: 3,
        status: "approved",
      });

      // Modifying canon in Episode 1 invalidates downstream episodes 2 and 3
      const invalidatedCount = bible.invalidateDownstreamEpisodes(
        "series_snap",
        1,
        "Đạo cụ Bùa Hộ Mệnh bị chỉnh sửa nguồn gốc ở Tập 1"
      );

      expect(invalidatedCount).toBe(2);

      const ep1 = bible.getEpisodeLifecycle("series_snap", 1);
      const ep2 = bible.getEpisodeLifecycle("series_snap", 2);
      const ep3 = bible.getEpisodeLifecycle("series_snap", 3);

      expect(ep1?.needs_review).toBe(false);
      expect(ep2?.needs_review).toBe(true);
      expect(ep2?.review_notes).toContain("Tập 1");
      expect(ep3?.needs_review).toBe(true);
      expect(ep3?.review_notes).toContain("Tập 1");
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 6. Strict SQLite Enforcement & Process Restart Persistence
  // ──────────────────────────────────────────────────────────────────────────
  describe("Yêu cầu 9: Strict SQLite Mode & Process Restart Persistence", () => {
    it("throws FatalSqliteError in production/strictSqlite mode if SQLite fails to open", () => {
      // Using an invalid file path that cannot be created or written
      const invalidPath = "Z:\\non_existent_drive_999\\story_bible.db";

      expect(() => {
        new BibleManager(invalidPath, { strictSqlite: true });
      }).toThrow(FatalSqliteError);
    });

    it("Nghiệm thu: Kiểm thử migration và đọc lại toàn vẹn dữ liệu sau khi khởi động lại", () => {
      // Session 1: Create Bible, run migrations, write data
      {
        const bible1 = createTestBible(TEST_DB_PATH, { strictSqlite: true });

        // Verify migrations were applied
        expect(bible1.isMigrationApplied(1)).toBe(true);
        expect(bible1.isMigrationApplied(2)).toBe(true);

        bible1.upsertSeriesMetadata({
          id: "persistent_series",
          title: "Series Bền Vững",
          visual_style: "8k Film",
          aspect_ratio: "16:9",
          fps: 24,
          created_at: new Date().toISOString(),
        });

        bible1.upsertCharacter({
          id: "char_persist",
          name: "Kiên Định",
          role: "protagonist",
          visual_summary: "Nhân vật kiểm thử bền vững",
          personality_traits: ["kiên định"],
          status: "alive",
        });

        bible1.upsertKeyProp({
          id: "prop_core",
          name: "Lõi Năng Lượng",
          visual_summary: "Lõi plasma",
          current_holder_id: "char_persist",
          status: "intact",
        });

        bible1.recordStateEvent({
          series_id: "persistent_series",
          episode_number: 1,
          entity_type: "character",
          entity_id: "char_persist",
          event_type: "wardrobe_change",
          to_state_json: JSON.stringify({ outfit: "space_suit" }),
          story_time: "Đêm ngày 1",
          confirmation_source: "pipeline_commit",
        });

        bible1.createCanonSnapshot("persistent_series", 1, 1);
        bible1.close();
      }

      // Session 2: Simulate complete process restart by instantiating new BibleManager on existing DB
      {
        const bible2 = createTestBible(TEST_DB_PATH, { strictSqlite: true });

        // Check metadata
        const meta = bible2.getSeriesMetadata();
        expect(meta?.id).toBe("persistent_series");
        expect(meta?.title).toBe("Series Bền Vững");

        // Check character
        const char = bible2.getCharacter("char_persist");
        expect(char?.name).toBe("Kiên Định");

        // Check prop
        const prop = bible2.getKeyProp("prop_core");
        expect(prop?.name).toBe("Lõi Năng Lượng");
        expect(prop?.current_holder_id).toBe("char_persist");

        // Check state events
        const events = bible2.listStateEvents({
          seriesId: "persistent_series",
          episodeNumber: 1,
        });
        expect(events.length).toBe(1);
        expect(events[0].event_type).toBe("wardrobe_change");

        // Check snapshot
        const snapshot = bible2.getSnapshotForEpisode("persistent_series", 1);
        expect(snapshot).toBeDefined();
        expect(snapshot?.series_id).toBe("persistent_series");

        bible2.close();
      }
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 7. Continuity Auditor Scope & Disclaimer
  // ──────────────────────────────────────────────────────────────────────────
  describe("Yêu cầu 10: Continuity Auditor Scope & Disclaimer Disclosure", () => {
    it("explicitly discloses deterministic_rule_based scope and disclaimer", async () => {
      const auditor = new ContinuityAuditor();
      const result = await auditor.auditScript(1, {
        characters: [],
        character_knowledge: [],
        world_state: {},
        episode_summaries: [],
      }, "CẢNH 1: Yên bình.");

      expect(result.audit_scope).toBe("deterministic_rule_based");
      expect(result.disclaimer).toContain("rule-based");
      expect(result.disclaimer).toContain("Không coi kiểm tra từ khóa là bảo đảm 100% logic");
    });
  });
});
