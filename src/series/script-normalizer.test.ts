import { describe, it, expect, beforeEach } from "vitest";
import {
  parseRawScreenplay,
  enrichWithBibleContext,
  normalizeScript,
  ContinuityError,
} from "./script-normalizer.js";
import { BibleManager } from "../bible/bible-manager.js";

describe("ScriptNormalizer & Bible Context Enrichment", () => {
  let bible: BibleManager;

  beforeEach(() => {
    bible = new BibleManager(":memory:");

    // Setup Master Series
    bible.upsertSeriesMetadata({
      id: "cyber-saigon-2088",
      title: "Cyber Saigon 2088",
      genre: "Cyberpunk Action Drama",
      visualStyle: "Cinematic 35mm, gritty cyber-noir, neon reflections, anamorphic lens flare",
      aspectRatio: "9:16",
      fps: 30,
      created_at: new Date().toISOString(),
    });

    // Setup Characters
    bible.upsertCharacter({
      id: "char_minh",
      name: "Minh",
      role: "protagonist",
      visual_summary: "30 tuổi, thám tử tư lạnh lùng, tóc đen ngắn",
      personality_traits: ["quyết đoán", "thận trọng"],
      voice_profile_id: "voice_minh_elevenlabs",
      status: "alive",
      face_reference_image: "assets/characters/minh_face.jpg",
      distinguishing_marks: "Vết sẹo mảnh cắt ngang lông mày trái",
      current_wardrobe_id: "w_minh_coat",
    });

    bible.upsertWardrobe({
      id: "w_minh_coat",
      character_id: "char_minh",
      outfit_name: "Áo măng tô dạ",
      visual_description: "Áo măng tô dạ nâu sờn vai, sơ mi trắng bên trong",
      is_default: true,
    });

    bible.upsertCharacter({
      id: "char_an",
      name: "An",
      role: "supporting",
      visual_summary: "24 tuổi, nữ hacker tóc bạch kim",
      personality_traits: ["nhanh nhẹn", "tinh nghịch"],
      voice_profile_id: "voice_an_lucylab",
      status: "alive",
      face_reference_image: "assets/characters/an_face.jpg",
      current_wardrobe_id: "w_an_hoodie",
    });

    bible.upsertWardrobe({
      id: "w_an_hoodie",
      character_id: "char_an",
      outfit_name: "Hoodie dạ quang",
      visual_description: "Áo hoodie đen in mạch điện dạ quang xanh ngọc",
      is_default: true,
    });

    // Setup Locations
    bible.upsertLocation({
      id: "loc_bar_hem_9",
      name: "Quán Bar Hẻm 9",
      visual_summary: "Quán bar ngầm cũ kỹ dưới lòng đất, bàn ghế kim loại han gỉ",
      atmospheric_rules: "Mưa axit nhỏ giọt qua kẽ nứt trần nhà",
      reference_image_path: "assets/locations/bar_hem_9.jpg",
    });

    // Setup Props
    bible.upsertKeyProp({
      id: "prop_chip",
      name: "Con Chip Lượng Tử",
      visual_summary: "Con chip titan phủ vàng có đèn LED đỏ",
      current_holder_id: "char_minh",
      status: "intact",
    });
  });

  it("parses structured screenplay text format accurately", () => {
    const rawText = `
TIÊU ĐỀ: Cuộc Gặp Hẻm Số 9
TẬP: 1
TÓM TẮT: Minh tìm đến Quán Bar Hẻm 9 để trao đổi con chip với An.
BGM: cyber_suspense

CẢNH 1: Quán Bar Hẻm 9 - Đêm
NHÂN VẬT: Minh, An
ĐẠO CỤ: Con Chip Lượng Tử

[SHOT 1: TOÀN CẢNH]
HÌNH ẢNH: Minh đẩy cửa bước vào quán bar ẩm ướt dưới mưa neon
THỜI LƯỢNG: 4.5s
DẪN CHUYỆN: Mưa axit đêm nay khiến không khí Hẻm Số 9 nặng nề hơn bao giờ hết.

[SHOT 2: CẬN CẢNH]
HÌNH ẢNH: Minh ngồi đối diện An, đặt tay lên bàn
THỜI LƯỢNG: 3.0s
THOẠI: Minh: Tôi mang món đồ giá $500 đến cho cô.
    `;

    const intermediate = parseRawScreenplay(rawText);
    expect(intermediate.title).toBe("Cuộc Gặp Hẻm Số 9");
    expect(intermediate.episodeNumber).toBe(1);
    expect(intermediate.bgm).toBe("cyber_suspense");
    expect(intermediate.scenes.length).toBe(1);
    expect(intermediate.scenes[0].shots.length).toBe(2);

    expect(intermediate.scenes[0].shots[0].shotType).toBe("wide");
    expect(intermediate.scenes[0].shots[0].dialogue?.type).toBe("voiceover");
    expect(intermediate.scenes[0].shots[1].dialogue?.speaker).toBe("Minh");
  });

  it("enriches shots with persistent visual style, character face, wardrobe and scars", () => {
    const rawText = `
TIÊU ĐỀ: Cuộc Gặp Hẻm Số 9
TẬP: 1

CẢNH 1: Quán Bar Hẻm 9 - Đêm
NHÂN VẬT: Minh

[SHOT 1: CẬN CẢNH]
HÌNH ẢNH: Minh nhìn chằm chằm vào chiếc ly rỗng
NHÂN VẬT CHÍNH: Minh
THỜI LƯỢNG: 3.5s
THOẠI: Minh: Đã quá muộn rồi.
    `;

    const intermediate = parseRawScreenplay(rawText);
    const enriched = enrichWithBibleContext(intermediate, bible);

    expect(enriched.schemaVersion).toBe("3.0");
    expect(enriched.aspectRatio).toBe("9:16");
    expect(enriched.scenes.length).toBe(1);

    const shot1 = enriched.scenes[0].shots[0];
    // Master Visual Prompt contains Series Style + Location + Character marks & wardrobe
    expect(shot1.visualPrompt).toContain("Cinematic 35mm, gritty cyber-noir");
    expect(shot1.visualPrompt).toContain("Quán Bar Hẻm 9");
    expect(shot1.visualPrompt).toContain("Vết sẹo mảnh cắt ngang lông mày trái");
    expect(shot1.visualPrompt).toContain("Áo măng tô dạ");
    expect(shot1.referenceImage).toBe("assets/characters/minh_face.jpg");

    // Dialogue is assigned to char_minh with correct voiceProfileId
    expect(shot1.dialogue?.characterId).toBe("char_minh");
    expect(shot1.dialogue?.voiceProfileId).toBe("voice_minh_elevenlabs");
  });

  it("normalizes numbers and currencies in dialogue for Vietnamese TTS", () => {
    const rawText = `
TIÊU ĐỀ: Cuộc Đàm Phán
TẬP: 1

CẢNH 1: Quán Bar Hẻm 9 - Đêm
[SHOT 1: TRUNG CẢNH]
HÌNH ẢNH: An mở vali
NHÂN VẬT CHÍNH: An
THỜI LƯỢNG: 3s
THOẠI: An: Giá con chip này là $500 và nó dùng pin 5000mAh.
    `;

    const intermediate = parseRawScreenplay(rawText);
    const enriched = enrichWithBibleContext(intermediate, bible);
    const shot = enriched.scenes[0].shots[0];

    expect(shot.dialogue?.text).toContain("năm trăm đô la");
    expect(shot.dialogue?.text).toContain("năm nghìn mi li am pe giờ");
  });

  it("throws ContinuityError when script violates deceased character constraints", async () => {
    // Kill off Minh in Bible
    bible.updateCharacterStatus("char_minh", "deceased");

    const rawText = `
TIÊU ĐỀ: Điệp Vụ Tử Thần
TẬP: 2

CẢNH 1: Quán Bar Hẻm 9 - Đêm
[SHOT 1: TRUNG CẢNH]
HÌNH ẢNH: Minh xuất hiện cười nói vui vẻ với mọi người
THỜI LƯỢNG: 3s
THOẠI: Minh: Tôi đã trở lại.
    `;

    await expect(normalizeScript(rawText, bible)).rejects.toThrow(ContinuityError);
  });
});
