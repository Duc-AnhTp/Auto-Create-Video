import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { StoryToScreenplayGenerator } from "./story-to-screenplay.js";
import { BibleManager } from "../bible/bible-manager.js";
import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import { join } from "node:path";

describe("Story/Prompt-to-Screenplay AI Generator", () => {
  let bible: BibleManager;
  const seriesId = "test-cyber-series";

  beforeEach(() => {
    BibleManager.closeAll();
    bible = new BibleManager(":memory:");

    // Setup Series and initial Canon Memory
    bible.upsertSeriesMetadata({
      id: seriesId,
      title: "Huyền Thoại Sài Gòn",
      genre: "Cyberpunk Action",
      visual_style: "Cinematic 35mm, neon noir",
      aspect_ratio: "9:16",
      fps: 30,
      created_at: new Date().toISOString(),
    });

    bible.upsertCharacter({
      id: "char_minh",
      series_id: seriesId,
      name: "Minh",
      role: "protagonist",
      visual_summary: "Minh, 30 tuổi, áo khoác da đen, ánh mắt sắc lạnh",
      status: "alive",
    });

    bible.upsertCharacter({
      id: "char_an",
      series_id: seriesId,
      name: "An",
      role: "supporting",
      visual_summary: "An, 26 tuổi, hacker tóc ngắn, đeo kính phản quang",
      status: "alive",
    });

    bible.upsertKeyProp({
      id: "prop_chip",
      series_id: seriesId,
      name: "Con Chip Lượng Tử",
      current_holder_id: "char_an",
      description: "Con chip chứa dữ liệu giải mã mật",
    });
  });

  afterEach(() => {
    BibleManager.closeAll();
  });

  it("1. Generates valid episodic screenplay from short prompt using rule-based engine", async () => {
    const generator = new StoryToScreenplayGenerator(bible);

    const result = await generator.generateScreenplay({
      seriesId,
      prompt: "Minh và An xâm nhập vào trung tâm dữ liệu Skyline để truy xuất tập tin bí mật.",
      episodeNumber: 1,
      skipAudit: true,
    });

    expect(result.generatorUsed).toBe("rule_based");
    expect(result.rawScreenplay).toContain("TẬP 1:");
    expect(result.rawScreenplay).toContain("Logline:");
    expect(result.rawScreenplay).toContain("CẢNH 1:");
    expect(result.rawScreenplay).toContain("CẢNH 2:");
    expect(result.rawScreenplay).toContain("CẢNH 3:");

    expect(result.script.episodeNumber).toBe(1);
    expect(result.script.scenes.length).toBe(3);
    expect(result.charactersUsed.length).toBeGreaterThan(0);
    expect(result.shotCount).toBeGreaterThanOrEqual(9);
    expect(result.estimatedDurationSec).toBeGreaterThan(20);
  });

  it("2. Extracts dialogue quotes and binds known canon props from novel story text", async () => {
    const generator = new StoryToScreenplayGenerator(bible);

    const novelStory = `
Bến Bạch Đằng chìm trong màn sương đêm lạnh buốt. Minh đi phía trước, cẩn trọng rà soát từng bóng container.
An ôm chặt Con Chip Lượng Tử trong ba lô, thì thầm: “Tín hiệu định vị của chúng ta sắp bị lộ rồi.”
Cả hai tăng tốc, hướng thẳng về chiếc ca nô ngầm đang nổ máy chờ sẵn dưới chân cầu tàu.
    `.trim();

    const result = await generator.generateScreenplay({
      seriesId,
      storyText: novelStory,
      episodeNumber: 2,
      skipAudit: true,
    });

    expect(result.rawScreenplay).toContain("TẬP 2:");
    expect(result.propsUsed).toContain("Con Chip Lượng Tử");
    expect(result.rawScreenplay).toContain("Tín hiệu định vị của chúng ta sắp bị lộ rồi.");
  });

  it("3. Successfully orchestrates with Custom LLM invoker and injects canon history", async () => {
    // Record Episode 1 summary into Bible
    bible.setEpisodeLifecycle({ seriesId, episodeNumber: 1, status: "approved" });
    bible.commitEpisode(
      {
        series_id: seriesId,
        episode_number: 1,
        title: "Bản Hợp Đồng Bí Mật",
        logline: "Minh tìm thấy chip lượng tử.",
        major_events: ["Minh tìm thấy chip lượng tử tại quán bar"],
        delta_changes: {},
        created_at: new Date().toISOString(),
      },
      { major_events: ["Minh tìm thấy chip lượng tử tại quán bar"] }
    );

    let capturedPrompt = "";
    const mockLlmInvoker = async (prompt: string, systemPrompt?: string): Promise<string> => {
      capturedPrompt = prompt;
      return `
TẬP 2: TRUY ĐUỔI BẾN CẢNG
Logline: Minh và An trốn chạy sự truy lùng của tập đoàn sau khi lấy được chip.

CẢNH 1: BẾN TÀU - ĐÊM
Nhân vật: Minh, An
Đạo cụ: Con Chip Lượng Tử
CÚ MÁY 1 (establishing, 4s): Toàn cảnh bến tàu đêm sương mù.
CÚ MÁY 2 (medium, 4s): Minh quan sát động tĩnh lính gác.
MINH: Mau lên tàu, chúng đang tới!
CÚ MÁY 3 (close_up, 4s): An mở ba lô kiểm tra con chip.
AN: Chip vẫn an toàn!

CẢNH 2: CẦU TÀU - ĐÊM
Nhân vật: Minh, An
CÚ MÁY 1 (action, 4s): Lính tuần tra nổ súng cảnh cáo.
CÚ MÁY 2 (action, 4s): Minh bắn trả yểm trợ cho An.
MINH: Nhảy xuống ca nô!

CẢNH 3: MẶT NƯỚC - ĐÊM
Nhân vật: Minh, An
CÚ MÁY 1 (wide, 4s): Chiếc ca nô phóng vút đi trên mặt nước.
CÚ MÁY 2 (close_up, 4s): An thở phào nhìn lại bờ sông.
AN: Chúng ta đã thoát.
CÚ MÁY 3 (wide, 4s): Ca nô biến mất trong làn sương đêm.
      `.trim();
    };

    const generator = new StoryToScreenplayGenerator(bible);

    const result = await generator.generateScreenplay({
      seriesId,
      prompt: "Minh và An bị phục kích ở bến tàu nhưng đã trốn thoát thành công.",
      episodeNumber: 2,
      customLlmInvoker: mockLlmInvoker,
      skipAudit: true,
    });

    expect(result.generatorUsed).toBe("llm");
    expect(capturedPrompt).toContain("KÝ ỨC VÀ BỘ NHỚ CANON");
    expect(capturedPrompt).toContain("Minh tìm thấy chip lượng tử tại quán bar");
    expect(result.script.episodeNumber).toBe(2);
    expect(result.script.title).toBe("TRUY ĐUỔI BẾN CẢNG");
    expect(result.script.scenes.length).toBe(3);
  });
});
