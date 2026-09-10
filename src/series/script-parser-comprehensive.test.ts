import { describe, it, expect, beforeEach } from "vitest";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  parseRawScreenplay,
  enrichWithBibleContext,
  normalizeScript,
  ScreenplayParseError,
} from "./script-normalizer.js";
import {
  EpisodicScriptSchema,
  validateScriptIntegrity,
  ScriptIntegrityError,
  migrateScriptToLatest,
} from "./series-schema.js";
import { BibleManager } from "../bible/bible-manager.js";

describe("Comprehensive Script Parser & Schema Acceptance Test Suite", () => {
  let bible: BibleManager;

  beforeEach(() => {
    bible = new BibleManager(":memory:");

    bible.upsertSeriesMetadata({
      id: "cyber-saigon",
      title: "Sài Gòn 2088",
      genre: "Cyberpunk Noir",
      visualStyle: "Cinematic 35mm, gritty cyberpunk, neon lights, rainy Saigon alleys, photorealistic 8k",
      aspectRatio: "9:16",
      fps: 30,
      created_at: new Date().toISOString(),
    });

    bible.upsertCharacter({
      id: "char_minh",
      name: "Minh",
      role: "protagonist",
      visual_summary: "30 tuổi, thám tử tư lạnh lùng, áo khoác dạ",
      voice_profile_id: "elevenlabs:voice_minh_123",
      status: "alive",
      face_reference_image: "assets/characters/minh_face.jpg",
      distinguishing_marks: "Vết sẹo mảnh ngang mày trái",
    });

    bible.upsertCharacter({
      id: "char_an",
      name: "An",
      role: "supporting",
      visual_summary: "24 tuổi, nữ hacker tóc bạch kim, hoodie dạ quang",
      voice_profile_id: "lucylab:voice_an_456",
      status: "alive",
      face_reference_image: "assets/characters/an_face.jpg",
    });

    bible.upsertCharacter({
      id: "char_linh",
      name: "Linh",
      role: "supporting",
      visual_summary: "28 tuổi, nữ đặc vụ ngầm, đồ tác chiến đen",
      voice_profile_id: "elevenlabs:voice_linh_789",
      status: "alive",
    });

    bible.upsertLocation({
      id: "loc_bar_hem9",
      name: "Quán Bar Hẻm 9",
      visual_summary: "Quán bar ngầm dưới lòng đất ngập khói thuốc, đèn neon đỏ",
    });

    bible.upsertKeyProp({
      id: "prop_chip",
      name: "Con Chip Lượng Tử",
      visual_summary: "Chip vi xử lý lượng tử phát ánh sáng xanh ngọc",
      current_holder_id: "char_minh",
      status: "intact",
    });
  });

  // ── Criterion 1: Repo sample scripts parsed accurately with correct scenes, shots, dialogues ──
  it("parses example script cyber-saigon-ep1.txt with exact scenes, shots and dialogues", async () => {
    const filePath = join("scripts", "example-series", "cyber-saigon-ep1.txt");
    const rawContent = await readFile(filePath, "utf8");

    const parsed = parseRawScreenplay(rawContent);
    expect(parsed.episodeNumber).toBe(1);
    expect(parsed.title).toBe("BẢN HỢP ĐỒNG BÓNG ĐÊM");
    expect(parsed.logline).toContain("Thám tử Minh bí mật bàn giao Con Chip Lượng Tử cho hacker An");
    expect(parsed.scenes.length).toBe(1);

    const scene = parsed.scenes[0];
    expect(scene.sceneNumber).toBe(1);
    expect(scene.locationHeader).toBe("QUÁN BAR HẺM 9 - ĐÊM");
    expect(scene.charactersMentioned).toContain("Minh");
    expect(scene.charactersMentioned).toContain("An");
    expect(scene.propsMentioned).toContain("Con Chip Lượng Tử");
    expect(scene.shots.length).toBe(4);

    // Shot 1: establishing, 4s, no dialogue
    expect(scene.shots[0].shotType).toBe("establishing");
    expect(scene.shots[0].durationSec).toBe(4.0);
    expect(scene.shots[0].dialogues.length).toBe(0);

    // Shot 2: medium, 4s, Minh dialogue
    expect(scene.shots[1].shotType).toBe("medium");
    expect(scene.shots[1].durationSec).toBe(4.0);
    expect(scene.shots[1].dialogues.length).toBe(1);
    expect(scene.shots[1].dialogues[0].speaker).toBe("MINH");
    expect(scene.shots[1].dialogues[0].text).toContain("Cầm lấy con chip này");

    // Shot 3: close_up, 4s, An dialogue
    expect(scene.shots[2].shotType).toBe("close_up");
    expect(scene.shots[2].dialogues.length).toBe(1);
    expect(scene.shots[2].dialogues[0].speaker).toBe("AN");
    expect(scene.shots[2].dialogues[0].text).toContain("Chip mã hóa 5 lớp");

    // Shot 4: action, 3s, Minh dialogue
    expect(scene.shots[3].shotType).toBe("action");
    expect(scene.shots[3].durationSec).toBe(3.0);
    expect(scene.shots[3].dialogues.length).toBe(1);
    expect(scene.shots[3].dialogues[0].speaker).toBe("MINH");
    expect(scene.shots[3].dialogues[0].text).toContain("Cửa sau! Đi mau!");

    // Enrich with Bible
    const enriched = enrichWithBibleContext(parsed, bible);
    expect(enriched.scenes[0].shots[1].dialogues[0].characterId).toBe("char_minh");
    expect(enriched.scenes[0].shots[2].dialogues[0].characterId).toBe("char_an");
    expect(enriched.unresolvedCharacters.length).toBe(0);
  });

  it("parses example script cyber-saigon-pilot-2min.txt (32 shots across 4 scenes)", async () => {
    const filePath = join("scripts", "example-series", "cyber-saigon-pilot-2min.txt");
    const rawContent = await readFile(filePath, "utf8");

    const parsed = parseRawScreenplay(rawContent);
    expect(parsed.episodeNumber).toBe(1);
    expect(parsed.scenes.length).toBe(4);

    expect(parsed.scenes[0].shots.length).toBe(8);
    expect(parsed.scenes[1].shots.length).toBe(8);
    expect(parsed.scenes[2].shots.length).toBe(8);
    expect(parsed.scenes[3].shots.length).toBe(8);

    const totalShots = parsed.scenes.reduce((acc, sc) => acc + sc.shots.length, 0);
    expect(totalShots).toBe(32);
  });

  it("parses example script cyber-saigon-ep2.txt accurately", async () => {
    const filePath = join("scripts", "example-series", "cyber-saigon-ep2.txt");
    const rawContent = await readFile(filePath, "utf8");

    const parsed = parseRawScreenplay(rawContent);
    expect(parsed.episodeNumber).toBe(2);
    expect(parsed.title).toBe("CUỘC PHỤC KÍCH TẠI BẾN BẠCH ĐẰNG");
    expect(parsed.scenes.length).toBe(3);
    expect(parsed.scenes[0].shots.length).toBe(4);
    expect(parsed.scenes[1].shots.length).toBe(4);
    expect(parsed.scenes[2].shots.length).toBe(6);
  });

  // ── Criterion 2: Multi-dialogue in single shot without overwriting ──
  it("supports multiple dialogue lines from multiple characters in the same shot without overwriting", () => {
    const scriptText = `
TẬP 1: BÀN GIAO
CẢNH 1: QUÁN BAR HẺM 9 - ĐÊM
Nhân vật: Minh, An

CÚ MÁY 1 (medium, 5s): Minh và An ngồi đối diện nhau qua chiếc bàn kim loại ẩm ướt.
MINH: Cầm lấy con chip này.
AN: Có bẫy không?
MINH: Không còn thời gian đâu, bọn chúng tới rồi!
    `;

    const parsed = parseRawScreenplay(scriptText);
    expect(parsed.scenes[0].shots.length).toBe(1);

    const shot = parsed.scenes[0].shots[0];
    expect(shot.dialogues.length).toBe(3);

    // Verify chronological order and speakers
    expect(shot.dialogues[0].speaker).toBe("MINH");
    expect(shot.dialogues[0].text).toBe("Cầm lấy con chip này.");
    expect(shot.dialogues[0].dialogueId).toBe("sc01_sh01_d01");

    expect(shot.dialogues[1].speaker).toBe("AN");
    expect(shot.dialogues[1].text).toBe("Có bẫy không?");
    expect(shot.dialogues[1].dialogueId).toBe("sc01_sh01_d02");

    expect(shot.dialogues[2].speaker).toBe("MINH");
    expect(shot.dialogues[2].text).toBe("Không còn thời gian đâu, bọn chúng tới rồi!");
    expect(shot.dialogues[2].dialogueId).toBe("sc01_sh01_d03");

    // Legacy dialogue accessor returns first line
    expect(shot.dialogue?.speaker).toBe("MINH");
    expect(shot.dialogue?.text).toBe("Cầm lấy con chip này.");

    // Enrich and check Bible resolution
    const enriched = enrichWithBibleContext(parsed, bible);
    const enrichedShot = enriched.scenes[0].shots[0];
    expect(enrichedShot.dialogues.length).toBe(3);
    expect(enrichedShot.dialogues[0].characterId).toBe("char_minh");
    expect(enrichedShot.dialogues[1].characterId).toBe("char_an");
    expect(enrichedShot.dialogues[2].characterId).toBe("char_minh");
  });

  // ── Criterion 3: Vietnamese diacritics, quotes and colons inside text preserved ──
  it("preserves Vietnamese diacritics, quotation marks, and interior colons in dialogue", () => {
    const scriptText = `
TẬP 1: THỬ NGHIỆM DẤU CÂU
CẢNH 1: QUÁN BAR HẺM 9 - ĐÊM
CÚ MÁY 1 (close_up, 4s): Minh cảnh giác nhìn quanh.
MINH (thì thào): "Chú ý: tín hiệu quét sinh trắc học đã bật, đừng động đậy!"
AN (hốt hoảng): "Thời gian còn lại: chính xác là 3 phút."
    `;

    const parsed = parseRawScreenplay(scriptText);
    const shot = parsed.scenes[0].shots[0];
    expect(shot.dialogues.length).toBe(2);

    // Turn 1
    const d1 = shot.dialogues[0];
    expect(d1.speaker).toBe("MINH");
    expect(d1.actingInstruction).toBe("thì thào");
    // Outer quotes stripped, but interior colon and exclamation preserved
    expect(d1.subtitleText).toBe("Chú ý: tín hiệu quét sinh trắc học đã bật, đừng động đậy!");
    expect(d1.text).toBe("Chú ý: tín hiệu quét sinh trắc học đã bật, đừng động đậy!");
    expect(d1.rawText).toContain('MINH (thì thào): "Chú ý: tín hiệu quét sinh trắc học đã bật, đừng động đậy!"');

    // Turn 2
    const d2 = shot.dialogues[1];
    expect(d2.speaker).toBe("AN");
    expect(d2.actingInstruction).toBe("hốt hoảng");
    expect(d2.subtitleText).toBe("Thời gian còn lại: chính xác là 3 phút.");

    const enriched = enrichWithBibleContext(parsed, bible);
    const enrichedShot = enriched.scenes[0].shots[0];
    expect(enrichedShot.dialogues[0].actingInstruction).toBe("thì thào");
    expect(enrichedShot.dialogues[0].subtitleText).toBe("Chú ý: tín hiệu quét sinh trắc học đã bật, đừng động đậy!");
    // TTS text has phonetic normalization for Vietnamese numbers
    expect(enrichedShot.dialogues[1].ttsText).toContain("ba phút");
  });

  // ── Criterion 4: Descriptive error reporting with line/column/fix hint ──
  it("throws ScreenplayParseError with exact line numbers on invalid inputs", () => {
    // 1. Completely empty text
    expect(() => parseRawScreenplay("")).toThrow(ScreenplayParseError);
    try {
      parseRawScreenplay("");
    } catch (e: any) {
      expect(e).toBeInstanceOf(ScreenplayParseError);
      expect(e.line).toBe(1);
      expect(e.fixHint).toContain("CẢNH 1:");
    }

    // 2. Dialogue before any scene or shot
    const orphanedDialogue = `
MINH: Cầm lấy con chip này.
CẢNH 1: QUÁN BAR HẺM 9 - ĐÊM
CÚ MÁY 1 (medium, 4s): Minh ngồi đối diện An.
    `;
    try {
      parseRawScreenplay(orphanedDialogue);
      expect.unreachable("Should have thrown error on dialogue before scene");
    } catch (e: any) {
      expect(e).toBeInstanceOf(ScreenplayParseError);
      expect(e.line).toBe(2);
      expect(e.snippet).toContain("MINH: Cầm lấy con chip này.");
    }

    // 3. Dialogue inside scene but before any shot
    const dialogueBeforeShot = `
CẢNH 1: QUÁN BAR HẺM 9 - ĐÊM
MINH: Cầm lấy con chip này.
CÚ MÁY 1 (medium, 4s): Minh ngồi đối diện An.
    `;
    try {
      parseRawScreenplay(dialogueBeforeShot);
      expect.unreachable("Should have thrown error on dialogue before shot");
    } catch (e: any) {
      expect(e).toBeInstanceOf(ScreenplayParseError);
      expect(e.line).toBe(3);
      expect(e.fixHint).toContain("CÚ MÁY");
    }

    // 4. Scene without any shots
    const emptyScene = `
CẢNH 1: QUÁN BAR HẺM 9 - ĐÊM
Nhân vật: Minh
    `;
    expect(() => parseRawScreenplay(emptyScene)).toThrow(ScreenplayParseError);
  });

  // ── Criterion 5: JSON round-trip without data loss and migration ──
  it("preserves 100% data fidelity on JSON round-trip and migrates legacy v2.0 JSON", () => {
    const scriptText = `
TẬP 1: ROUND TRIP TEST
LOGLINE: Kiểm tra round trip không mất mát dữ liệu
CẢNH 1: QUÁN BAR HẺM 9 - ĐÊM
CÚ MÁY 1 (medium, 4.5s): Minh đưa chip cho An
MINH: Cầm lấy chip này
AN: Đã nhận được
    `;

    const original = parseRawScreenplay(scriptText);
    const jsonString = JSON.stringify(original);
    const roundTripped = parseRawScreenplay(jsonString);

    expect(roundTripped.title).toBe(original.title);
    expect(roundTripped.scenes.length).toBe(original.scenes.length);
    expect(roundTripped.scenes[0].shots[0].dialogues.length).toBe(2);
    expect(roundTripped.scenes[0].shots[0].dialogues[0].text).toBe("Cầm lấy chip này");
    expect(roundTripped.scenes[0].shots[0].dialogues[1].text).toBe("Đã nhận được");

    // Legacy v2.0 script migration test
    const legacyV2Json = {
      version: "2.0",
      seriesId: "cyber-saigon",
      episodeNumber: 1,
      title: "Legacy Episode",
      logline: "Legacy logline",
      scenes: [
        {
          sceneNumber: 1,
          locationId: "loc_bar_hem9",
          locationName: "Quán Bar",
          shots: [
            {
              shotId: "sc01_sh01",
              shotType: "medium",
              durationSec: 4.0,
              visualPrompt: "Minh ngồi",
              dialogue: {
                characterId: "char_minh",
                speakerName: "Minh",
                text: "Tôi có mặt ở đây.",
              },
            },
          ],
        },
      ],
    };

    const migrated = migrateScriptToLatest(legacyV2Json);
    expect(migrated.schemaVersion).toBe("3.0");
    expect(migrated.scenes[0].sceneId).toBe("sc01");
    expect(migrated.scenes[0].shots[0].dialogues.length).toBe(1);
    expect(migrated.scenes[0].shots[0].dialogues[0].dialogueId).toBe("sc01_sh01_d01");
    expect(migrated.scenes[0].shots[0].dialogues[0].text).toBe("Tôi có mặt ở đây.");
    expect(migrated.scenes[0].shots[0].dialogues[0].subtitleText).toBe("Tôi có mặt ở đây.");
  });

  // ── Criterion 6: Unresolved character detection and mapping ──
  it("detects unresolved characters and enforces mapping when strictCharacters is set", async () => {
    const scriptWithUnknownChar = `
TẬP 1: BẤT NGỜ
CẢNH 1: QUÁN BAR HẺM 9 - ĐÊM
CÚ MÁY 1 (medium, 4s): Một người lạ bước vào.
LÍNH GÁC: Ai cho phép các người vào đây?
    `;

    // 1. Normal enrichment tags character as unresolved
    const intermediate = parseRawScreenplay(scriptWithUnknownChar);
    const enriched = enrichWithBibleContext(intermediate, bible);
    expect(enriched.unresolvedCharacters).toContain("LÍNH GÁC");
    expect(enriched.scenes[0].shots[0].dialogues[0].isUnresolved).toBe(true);
    expect(enriched.scenes[0].shots[0].dialogues[0].characterId).toBe("unresolved_l_nh_g_c");

    // 2. Strict character mode throws ScriptIntegrityError
    expect(() =>
      enrichWithBibleContext(intermediate, bible, { strictCharacters: true })
    ).toThrow(ScriptIntegrityError);

    // 3. Providing characterMapping resolves the character cleanly
    const enrichedWithMapping = enrichWithBibleContext(intermediate, bible, {
      characterMapping: {
        "LÍNH GÁC": "char_minh", // Map to existing registered character
      },
      strictCharacters: true,
    });
    expect(enrichedWithMapping.unresolvedCharacters.length).toBe(0);
    expect(enrichedWithMapping.scenes[0].shots[0].dialogues[0].isUnresolved).toBe(false);
    expect(enrichedWithMapping.scenes[0].shots[0].dialogues[0].characterId).toBe("char_minh");
  });

  // ── Criterion 7: Script Integrity Validation (duplicate IDs & missing references) ──
  it("detects duplicate scene, shot, or dialogue IDs in validateScriptIntegrity", () => {
    const scriptWithDuplicates: any = {
      schemaVersion: "3.0",
      version: "3.0",
      seriesId: "cyber-saigon",
      episodeNumber: 1,
      title: "Duplicate Test",
      logline: "Test",
      scenes: [
        {
          sceneId: "sc01",
          sceneNumber: 1,
          locationId: "loc_bar_hem9",
          locationName: "Quán Bar",
          shots: [
            {
              shotId: "sc01_sh01",
              shotType: "medium",
              durationSec: 4.0,
              visualPrompt: "Shot 1",
              dialogues: [
                {
                  dialogueId: "sc01_sh01_d01",
                  characterId: "char_minh",
                  speakerName: "Minh",
                  text: "Line 1",
                },
              ],
            },
            {
              // Duplicate shotId!
              shotId: "sc01_sh01",
              shotType: "medium",
              durationSec: 4.0,
              visualPrompt: "Shot 1 duplicate",
              dialogues: [
                {
                  // Duplicate dialogueId!
                  dialogueId: "sc01_sh01_d01",
                  characterId: "char_minh",
                  speakerName: "Minh",
                  text: "Line 2",
                },
              ],
            },
          ],
        },
      ],
    };

    const validated = EpisodicScriptSchema.parse(scriptWithDuplicates);
    const report = validateScriptIntegrity(validated);
    expect(report.isValid).toBe(false);
    const duplicateShotIssue = report.issues.find(
      (i) => i.type === "DUPLICATE_ID" && i.message.includes("sc01_sh01")
    );
    expect(duplicateShotIssue).toBeDefined();
  });
});
