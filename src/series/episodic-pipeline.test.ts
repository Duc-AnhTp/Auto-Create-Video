import { describe, it, expect, beforeEach } from "vitest";
import { EpisodicPipeline } from "./episodic-pipeline.js";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { rm } from "node:fs/promises";

describe("EpisodicPipeline (Toàn Trình 8 Bước Sản Xuất Phim Dài Tập)", () => {
  const testOutputDir = join("output", "test-series-pipeline");

  beforeEach(async () => {
    if (existsSync(testOutputDir)) {
      try {
        await rm(testOutputDir, { recursive: true, force: true });
      } catch {}
    }
  });

  it("produces an episode end-to-end with mock provider and commits narrative delta to Bible", async () => {
    const pipeline = new EpisodicPipeline(":memory:");
    const bible = pipeline.getBible();

    // 1. Setup Series Bible Metadata
    bible.upsertSeriesMetadata({
      id: "cyber-saigon",
      title: "Sài Gòn 2088",
      genre: "Cyberpunk Noir",
      visual_style: "Cinematic 35mm, gritty cyberpunk, neon lights, rainy Saigon alleys, photorealistic 8k",
      negative_prompt: "cartoon, anime, 3D render, deformed faces",
      aspect_ratio: "9:16",
      fps: 30,
      created_at: new Date().toISOString(),
    });

    // 2. Setup Characters
    bible.upsertCharacter({
      id: "char_minh",
      name: "Minh",
      role: "protagonist",
      visual_summary: "Thám tử tư Minh, 35 tuổi, râu quai nón",
      face_reference_image: "assets/characters/minh_face.jpg",
      distinguishing_marks: "Vết sẹo mảnh ngang mày trái",
      voice_profile_id: "elevenlabs:voice_minh_123",
      status: "alive",
    });

    bible.upsertWardrobe({
      id: "wardrobe_minh_default",
      character_id: "char_minh",
      outfit_name: "Măng tô cổ điển",
      visual_description: "Áo măng tô dạ màu nâu xám sờn vai, sơ mi trắng mở cúc",
      is_default: 1,
    });

    bible.upsertCharacter({
      id: "char_an",
      name: "An",
      role: "supporting",
      visual_summary: "Hacker An, 22 tuổi, tóc nhuộm xanh neon",
      face_reference_image: "assets/characters/an_face.jpg",
      voice_profile_id: "lucylab:voice_an_456",
      status: "alive",
    });

    // 3. Setup Location & Key Prop
    bible.upsertLocation({
      id: "loc_bar_hem9",
      name: "Quán Bar Hẻm 9",
      visual_summary: "Quán bar ngầm ngập tràn khói và ánh đèn neon đỏ",
      lighting_mood: "neon red and cyan contrast",
    });

    bible.upsertKeyProp({
      id: "prop_chip",
      name: "Con Chip Lượng Tử",
      visual_summary: "Chip vi xử lý lượng tử phát ánh sáng xanh ngọc",
      current_holder_id: "char_minh",
      status: "intact",
    });

    // 4. Input Raw Script
    const rawScript = `
TẬP 1: BẢN HỢP ĐỒNG BÓNG ĐÊM
Logline: Minh giao con chip lượng tử bí mật cho hacker An tại một quán bar ngầm.

CẢNH 1: QUÁN BAR HẺM 9 - ĐÊM
Nhân vật: Minh, An
Đạo cụ: Con Chip Lượng Tử

CÚ MÁY 1 (establishing, 4s): Toàn cảnh quán bar Hẻm 9 mờ ảo dưới ánh đèn neon.
CÚ MÁY 2 (close_up, 4s): Minh ngồi trong góc tối, đẩy chiếc hộp nhỏ về phía trước.
MINH: Cầm lấy con chip này. Đừng để bọn chúng tìm thấy nó!
CÚ MÁY 3 (medium, 3s): An mở hộp kiểm tra, mắt phản chiếu ánh sáng xanh ngọc.
AN: Yên tâm đi, tôi sẽ giải mã nó trong đêm nay.
    `.trim();

    // 5. Produce Episode
    const result = await pipeline.produceEpisode(rawScript, {
      seriesId: "cyber-saigon",
      provider: "mock",
      mockTts: true,
      skipRender: true,
      outputDir: testOutputDir,
      narrativeDelta: {
        prop_transfers: [{ propId: "prop_chip", newHolderId: "char_an" }],
        majorEvents: ["Minh bàn giao thành công Con Chip Lượng Tử cho An."],
      },
    });

    expect(result.episodeNumber).toBe(1);
    expect(result.title).toBe("BẢN HỢP ĐỒNG BÓNG ĐÊM");
    expect(result.auditPassed).toBe(true);
    expect(existsSync(result.videoPath)).toBe(true);
    expect(existsSync(result.audioPath)).toBe(true);
    expect(existsSync(join(testOutputDir, "script-normalized.json"))).toBe(true);

    // 6. Verify Bible State Progression (Delta committed)
    const updatedProp = bible.getKeyProp("prop_chip");
    expect(updatedProp?.current_holder_id).toBe("char_an");

    const history = bible.getCanonHistory();
    expect(history.length).toBe(1);
    expect(history[0].title).toBe("BẢN HỢP ĐỒNG BÓNG ĐÊM");
  });
});
