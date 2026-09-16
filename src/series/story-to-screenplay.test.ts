import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { StoryToScreenplayGenerator } from "./story-to-screenplay.js";
import { BibleManager } from "../bible/bible-manager.js";
import { extractNarrativeDeltaFromScript } from "./episodic-pipeline.js";
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

  it("4. generateEpisodeFromPlan preserves plannedEp.logline and avoids duplicate coverage ledger IDs", async () => {
    const planId = "test_plan_01";
    bible.upsertSeriesPlan({
      id: planId,
      series_id: seriesId,
      source_id: "src_01",
      revision: 1,
      target_episodes: 2,
      target_duration_per_episode_sec: 60,
      pacing_preset: "standard",
      status: "approved",
      summary_json: "{}",
    });

    bible.upsertPlannedEpisode({
      id: `plan_ep_${planId}_e01`,
      plan_id: planId,
      series_id: seriesId,
      episode_number: 1,
      title: "Khởi Đầu Bí Mật",
      logline: "Minh và An nhận nhiệm vụ đầu tiên tại khu phố ngầm.",
      target_duration_sec: 60,
    });

    const beat1 = bible.recordStoryBeat({
      id: "beat_001",
      source_id: "src_01",
      source_unit_id: "unit_01",
      series_id: seriesId,
      beat_order: 1,
      name: "Cuộc Gặp Định Mệnh",
      description: "Minh gặp An tại quán bar ngầm",
      participating_characters_json: JSON.stringify(["char_minh", "char_an"]),
      is_flashback: 0,
      is_mandatory: 1,
    });

    let capturedPlanPrompt = "";
    const mockPlanInvoker = async (prompt: string): Promise<string> => {
      capturedPlanPrompt = prompt;
      return `
TẬP 1: KHỞI ĐẦU BÍ MẬT
Logline: Minh và An nhận nhiệm vụ đầu tiên tại khu phố ngầm.

CẢNH 1: QUÁN BAR - ĐÊM
Nhân vật: Minh, An
CÚ MÁY 1 (establishing, 4s): Quán bar ngập tràn ánh đèn neon.
CÚ MÁY 2 (medium, 4s): Minh bước vào nhìn thấy An.
MINH: Cô là An?
AN: Đúng vậy, ngồi xuống đi.
      `.trim();
    };

    const generator = new StoryToScreenplayGenerator(bible);
    const result = await generator.generateEpisodeFromPlan({
      seriesId,
      planId,
      episodeNumber: 1,
      customLlmInvoker: mockPlanInvoker,
      skipAudit: true,
    });

    expect(result.generatorUsed).toBe("llm");
    expect(result.script.episodeNumber).toBe(1);
    expect(result.script.title).toBe("KHỞI ĐẦU BÍ MẬT");

    // Verify coverage ledgers have no duplicates
    const ledgers = bible.listCoverageLedgers(planId);
    const shotBeatLedgers = ledgers.filter((l) => l.shot_id && l.beat_id);
    const uniqueKeys = new Set(shotBeatLedgers.map((l) => `${l.beat_id}::${l.shot_id}`));
    expect(shotBeatLedgers.length).toBe(uniqueKeys.size);
  });

  it("5. generateEpisodeFromPlan forwards options.prompt to customLlmInvoker", async () => {
    const planId = "plan_prompt_forward";
    bible.upsertSeriesPlan({
      id: planId,
      series_id: seriesId,
      source_id: "src_01",
      revision: 1,
      total_planned_episodes: 1,
    });
    bible.upsertPlannedEpisode({
      id: `plan_ep_${planId}_e01`,
      plan_id: planId,
      series_id: seriesId,
      episode_number: 1,
      title: "Chỉ Đạo Bổ Sung",
      logline: "Logline cơ bản",
      target_duration_sec: 60,
    });

    let capturedPrompt = "";
    const mockInvoker = async (prompt: string): Promise<string> => {
      capturedPrompt = prompt;
      return `
TẬP 1: CHỈ ĐẠO BỔ SUNG
Logline: Logline cơ bản.

CẢNH 1: QUÁN CAFE - NGÀY
Nhân vật: Minh
CÚ MÁY 1 (establishing, 4s): Quán cafe ven đường.
MINH: Cà phê ngon quá.
      `.trim();
    };

    const generator = new StoryToScreenplayGenerator(bible);
    await generator.generateEpisodeFromPlan({
      seriesId,
      planId,
      episodeNumber: 1,
      prompt: "Tập trung vào không khí căng thẳng và bí ẩn",
      customLlmInvoker: mockInvoker,
      skipAudit: true,
    });

    expect(capturedPrompt).toContain("Tập trung vào không khí căng thẳng và bí ẩn");
  });

  it("6. stripMarkdownFences cleanly removes conversational preamble before code fences", async () => {
    const generator = new StoryToScreenplayGenerator(bible);
    const rawWithPreamble = `
Chào bạn, đây là kịch bản tôi vừa viết cho bạn:
\`\`\`markdown
TẬP 1: BƯỚC NGOẶT
Logline: Một khởi đầu mới.

CẢNH 1: PHÒNG LÀM VIỆC - NGÀY
Nhân vật: Minh
CÚ MÁY 1 (establishing, 4s): Phòng làm việc sáng sủa.
MINH: Bắt đầu thôi.
\`\`\`
Hy vọng bạn hài lòng với kết quả này!
    `.trim();

    // Access stripMarkdownFences via private method cast
    const stripped = (generator as any).stripMarkdownFences(rawWithPreamble);
    expect(stripped.startsWith("TẬP 1: BƯỚC NGOẶT")).toBe(true);
    expect(stripped.includes("Chào bạn")).toBe(false);
    expect(stripped.includes("Hy vọng bạn")).toBe(false);
    expect(stripped.includes("```")).toBe(false);
  });

  it("7. extractNarrativeDeltaFromScript safely skips unpersisted characters and non-existent wardrobes", () => {
    const mockScript = {
      seriesId,
      episodeNumber: 1,
      title: "Test Delta Safety",
      logline: "Kiểm tra an toàn delta",
      scenes: [
        {
          sceneNumber: 1,
          locationName: "Căn cứ ngầm",
          timeOfDay: "NIGHT",
          charactersPresent: [
            { characterId: "char_minh", wardrobeId: "wardrobe_nonexistent" },
            { characterId: "char_ghost_unregistered", wardrobeId: "wardrobe_ghost" },
          ],
          shots: [
            {
              shotId: "s01",
              visualPrompt: "Minh xuất hiện trong bóng tối",
              dialogues: [{ text: "Tôi đã đến." }],
            },
          ],
        },
      ],
    };

    const delta = extractNarrativeDeltaFromScript(mockScript, bible, seriesId);

    // char_minh exists in bible -> should be in status updates
    const minhUpdate = delta.character_status_updates?.find((u) => u.id === "char_minh");
    expect(minhUpdate).toBeDefined();
    expect(minhUpdate?.status).toBe("alive");

    // char_ghost_unregistered does NOT exist in bible -> must NOT be in status updates to avoid DeltaValidationError
    const ghostUpdate = delta.character_status_updates?.find((u) => u.id === "char_ghost_unregistered");
    expect(ghostUpdate).toBeUndefined();

    // wardrobe_nonexistent does NOT exist in bible -> must NOT be in wardrobe updates
    expect(delta.character_wardrobe_updates?.length).toBe(0);

    // Delta validation should succeed without error
    const validation = bible.validateNarrativeDelta(delta);
    expect(validation.valid).toBe(true);
    expect(validation.errors).toHaveLength(0);
  });
});
