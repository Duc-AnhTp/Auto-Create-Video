import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  ScreenplayAstParser,
  CanonInvariantValidator,
  AutoBridgeGenerator,
} from "./canon-invariant-validator.js";
import { SqliteStoryStore } from "../../../bootstrap/sqlite-story-store.js";
import { mkdirSync, existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import { join } from "node:path";

describe("Pillar 2: Pre-Execution Canon Invariant Validator & Auto-Bridge Generator", () => {
  const testSeriesId = "canon-validator-test-series";
  let bible: SqliteStoryStore;
  const dbDir = join("data", "series", testSeriesId);

  beforeAll(() => {
    mkdirSync(dbDir, { recursive: true });
    bible = new SqliteStoryStore(join(dbDir, "story_bible.db"));

    bible.upsertSeriesMetadata({
      id: testSeriesId,
      title: "Hồ Sơ Tử Thần",
      aspect_ratio: "16:9",
    });

    // Character 1: Nam (Protagonist, Alive)
    bible.upsertCharacter({
      id: "char_nam",
      series_id: testSeriesId,
      name: "Nam",
      role: "protagonist",
      status: "alive",
    });

    // Character 2: Hùng (Deceased in episode 1)
    bible.upsertCharacter({
      id: "char_hung",
      series_id: testSeriesId,
      name: "Hùng",
      role: "antagonist",
      status: "deceased",
    });

    // Character 3: Lan (Supporting, Alive)
    bible.upsertCharacter({
      id: "char_lan",
      series_id: testSeriesId,
      name: "Lan",
      role: "supporting",
      status: "alive",
    });

    // Prop 1: Chìa Khóa Thời Gian - Currently held by Nam
    bible.upsertKeyProp({
      id: "prop_chia_khoa",
      series_id: testSeriesId,
      name: "Chìa Khóa Thời Gian",
      description: "Khối đa diện phát ánh sáng xanh",
      current_holder_id: "char_nam",
    });
  });

  afterAll(async () => {
    bible.close();
    SqliteStoryStore.closeAll();
    if (existsSync(dbDir)) {
      try {
        await rm(dbDir, { recursive: true, force: true });
      } catch {}
    }
  });

  describe("ScreenplayAstParser", () => {
    it("1. Parses screenplay text into structured scenes, actions, dialogues, and tags", () => {
      const script = `
        CẢNH 1: [FLASHBACK] CĂN CỨ BÍ MẬT - ĐÊM
        Nam ngồi quan sát màn hình điều khiển.
        HÙNG: Đây là cơ hội cuối cùng của chúng ta.
        Nam gật đầu đồng ý.

        CẢNH 2: PHÒNG THÍ NGHIỆM - NGÀY
        Lan bước vào phòng. Lan nhìn quanh tìm kiếm.
        LAN: Không có ai ở đây cả.
      `;

      const scenes = ScreenplayAstParser.parse(script, bible.listKeyProps(testSeriesId));
      expect(scenes.length).toBe(2);

      expect(scenes[0].sceneNumber).toBe(1);
      expect(scenes[0].isFlashback).toBe(true);
      expect(scenes[0].dialogues.length).toBe(1);
      expect(scenes[0].dialogues[0].characterName).toBe("HÙNG");

      expect(scenes[1].sceneNumber).toBe(2);
      expect(scenes[1].isFlashback).toBe(false);
      expect(scenes[1].dialogues[0].characterName).toBe("LAN");
    });
  });

  describe("Gate 1: Anti-Resurrection Gate", () => {
    it("2. Blocks deceased character speaking or acting in a regular scene (FAIL)", () => {
      const script = `
        CẢNH 1: QUÁN CÀ PHÊ - NGÀY
        Hùng bước vào quán cà phê và ngồi xuống bàn của Nam.
        HÙNG: Tôi đã quay trở lại.
      `;

      const report = CanonInvariantValidator.validate(script, bible, testSeriesId, 2);
      expect(report.status).toBe("FAIL");
      expect(report.fatalCount).toBeGreaterThanOrEqual(1);

      const resViolation = report.violations.find((v) => v.type === "anti_resurrection");
      expect(resViolation).toBeDefined();
      expect(resViolation!.characterName).toBe("Hùng");
      expect(resViolation!.severity).toBe("fatal");
    });

    it("3. Permits deceased character when explicitly marked as [Flashback] or [Ảo giác] (PASS)", () => {
      const script = `
        CẢNH 1: [FLASHBACK] QUÁN CÀ PHÊ - NGÀY
        Hùng ngồi đối diện với Nam trong ký ức cũ.
        HÙNG: Hãy nhớ lấy lời tôi.
      `;

      const report = CanonInvariantValidator.validate(script, bible, testSeriesId, 2);
      expect(report.status).toBe("PASS");
      expect(report.violations.length).toBe(0);
    });
  });

  describe("Gate 2: Prop Custody & Provenance Gate", () => {
    it("4. Detects when character uses a key prop currently held by another character (WARN/repairable)", () => {
      // Nam currently holds 'prop_chia_khoa'. In this script, Lan attempts to draw it without handoff.
      const script = `
        CẢNH 1: PHÒNG BẢO MẬT - ĐÊM
        Lan mở cánh cửa sắt. Lan rút Chìa Khóa Thời Gian ra khỏi túi và kích hoạt ổ khóa.
        LAN: Cánh cổng đang mở ra rồi!
      `;

      const report = CanonInvariantValidator.validate(script, bible, testSeriesId, 2);
      expect(report.status).toBe("WARN");
      expect(report.repairableCount).toBe(1);

      const propViolation = report.violations.find((v) => v.type === "prop_custody_violation");
      expect(propViolation).toBeDefined();
      expect(propViolation!.characterName).toBe("Lan");
      expect(propViolation!.propName).toBe("Chìa Khóa Thời Gian");
      expect(propViolation!.currentHolderId).toBe("char_nam");
      expect(propViolation!.severity).toBe("repairable_by_bridge");
    });

    it("5. Accepts prop usage if explicit handoff occurred earlier in the same screenplay", () => {
      const script = `
        CẢNH 1: CĂN CỨ TRUNG TÂM - CHIỀU
        Nam gặp Lan tại hành lang.
        Nam trao Chìa Khóa Thời Gian cho Lan.
        NAM: Cầm lấy nó và hoàn thành nhiệm vụ.

        CẢNH 2: PHÒNG BẢO MẬT - ĐÊM
        Lan rút Chìa Khóa Thời Gian ra khỏi túi và mở khóa.
        LAN: Cánh cổng đã mở!
      `;

      const report = CanonInvariantValidator.validate(script, bible, testSeriesId, 2);
      expect(report.status).toBe("PASS");
      expect(report.violations.length).toBe(0);
    });

    it("5b. Accurately tracks handoff with Vietnamese accented names and special characters", () => {
      bible.upsertCharacter({
        id: "char_duc",
        series_id: testSeriesId,
        name: "Đức",
        role: "supporting",
        status: "alive",
      });
      bible.upsertCharacter({
        id: "char_vu_advisor",
        series_id: testSeriesId,
        name: "Vũ (Cố vấn)",
        role: "supporting",
        status: "alive",
      });
      bible.upsertKeyProp({
        id: "prop_mat_ma",
        series_id: testSeriesId,
        name: "Mật Mã",
        description: "Bản đồ",
        current_holder_id: "char_duc",
      });
      const script = `
        CẢNH 1: PHÒNG HỌP - SÁNG
        Đức trao Mật Mã cho Vũ (Cố vấn).
        ĐỨC: Cẩn thận nhé.

        CẢNH 2: VĂN PHÒNG - CHIỀU
        Vũ (Cố vấn) cầm Mật Mã lên bàn.
      `;
      const report = CanonInvariantValidator.validate(script, bible, testSeriesId, 2);
      expect(report.status).toBe("PASS");
      expect(report.violations.length).toBe(0);
    });
  });

  describe("Gate 3: Epistemic Knowledge Boundary Gate", () => {
    it("6. Flags fatal contradiction when character mentions unrevealed secret in dialogue", () => {
      // Neither Nam nor Lan know the killer identity yet
      const script = `
        CẢNH 1: PHÒNG ĐIỀU TRA - NGÀY
        LAN: Tôi vừa kiểm tra hiện trường, thủ phạm là Giám đốc Trần!
      `;

      const report = CanonInvariantValidator.validate(script, bible, testSeriesId, 2);
      expect(report.status).toBe("FAIL");
      const knowViolation = report.violations.find((v) => v.type === "epistemic_knowledge_violation");
      expect(knowViolation).toBeDefined();
      expect(knowViolation!.characterName).toBe("Lan");
    });
  });

  describe("AutoBridgeGenerator & Auto-Repair Patch", () => {
    it("7. Automatically synthesizes a bridge scene, patches the script, and reconciles violations to PASS", () => {
      const scriptWithPropViolation = `
CẢNH 1: PHÒNG KHÁCH - SÁNG
Nam ngồi đọc báo cáo.

CẢNH 2: CĂN CỨ BÍ MẬT - ĐÊM
Lan rút Chìa Khóa Thời Gian ra và kích hoạt hệ thống điều khiển.
LAN: Hệ thống đã nhận diện chìa khóa.
      `.trim();

      const result = AutoBridgeGenerator.validateAndAutoRepair(
        scriptWithPropViolation,
        bible,
        testSeriesId,
        2,
        { persistToBible: true }
      );

      expect(result.isFullyReconciled).toBe(true);
      expect(result.appliedBridges.length).toBe(1);

      const bridge = result.appliedBridges[0];
      expect(bridge.reconciledViolationType).toBe("prop_custody_violation");
      expect(bridge.slugline).toContain("CẦU NỐI CHUYỂN GIAO ĐẠO CỤ");

      // Verify the repaired script includes the bridge scene before Scene 2
      expect(result.repairedScript).toContain("[CẦU NỐI CHUYỂN GIAO ĐẠO CỤ]");
      expect(result.repairedScript).toContain("trao Chìa Khóa Thời Gian cho Lan");

      // Verify validation of the repaired script is PASS
      expect(result.validationReport.status).toBe("PASS");
      expect(result.validationReport.violations.length).toBe(0);

      // Verify Story Bible now records Lan as the new holder of the key prop
      const updatedProp = bible.getKeyProp("prop_chia_khoa", testSeriesId);
      expect(updatedProp?.current_holder_id).toBe("char_lan");
    });
  });
});
