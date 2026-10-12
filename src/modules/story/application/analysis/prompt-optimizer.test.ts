import { describe, it, expect } from "vitest";
import { PromptOptimizer } from "./prompt-optimizer.js";
import type { EpisodeSummaryRecord, SeriesMetadataRecord, CharacterRecord } from "../../../../contracts/story.js";

describe("PromptOptimizer", () => {
  it("estimates token counts conservatively for Vietnamese and multilingual text", () => {
    const text = "Tập 1: Chiến Binh Thời Gian. Đây là cuộc hành trình đầy gian khổ của Nam và Mai.";
    const tokens = PromptOptimizer.estimateTokens(text);
    expect(tokens).toBeGreaterThan(15);
    expect(tokens).toBeLessThan(45);
  });

  it("compresses prompt text by stripping redundant whitespace and polite filler", () => {
    const verbosePrompt = `
      Xin lưu ý rằng vui lòng giúp tôi chuyển thể   kịch bản này.

      CẢNH 1: RỪNG NGUYÊN SINH - ĐÊM
      Hãy giúp tôi đảm bảo ánh sáng đẹp.
    `;
    const compressed = PromptOptimizer.compressPromptText(verbosePrompt);
    expect(compressed).not.toContain("vui lòng");
    expect(compressed).not.toContain("Xin lưu ý rằng");
    expect(compressed).not.toContain("Hãy giúp tôi");
    expect(compressed).toContain("CẢNH 1: RỪNG NGUYÊN SINH - ĐÊM");
    expect(compressed.length).toBeLessThan(verbosePrompt.length);
  });

  it("applies rolling exponential decay to past episode summaries", () => {
    const summaries: EpisodeSummaryRecord[] = [
      {
        episode_number: 1,
        title: "Khởi Đầu",
        logline: "Nam tìm thấy cổ vật bí ẩn trong hang đá. Cuộc chiến bắt đầu.",
        major_events: ["Nam tìm thấy cổ vật", "Quái vật thức tỉnh"],
        created_at: new Date().toISOString(),
      },
      {
        episode_number: 2,
        title: "Chạy Trốn",
        logline: "Nam và Mai trốn chạy qua thung lũng. Họ chạm trán tay sai hắc ám.",
        major_events: ["Chạy qua thung lũng", "Mai bị thương"],
        created_at: new Date().toISOString(),
      },
      {
        episode_number: 3,
        title: "Bẫy Rập",
        logline: "Mai bị bắt cóc. Nam phải tìm cách cứu cô trước bình minh.",
        major_events: ["Mai bị bắt", "Nam tìm kiếm manh mối"],
        created_at: new Date().toISOString(),
      },
      {
        episode_number: 4,
        title: "Tái Ngộ",
        logline: "Nam đột nhập sào huyệt giải cứu Mai. Bí mật thân thế hé lộ.",
        major_events: ["Đột nhập", "Cứu Mai"],
        created_at: new Date().toISOString(),
      },
      {
        episode_number: 5,
        title: "Quyết Đấu",
        logline: "Trận chiến đỉnh điểm tại đỉnh tháp. Nam phong ấn ác quỷ.",
        major_events: ["Trận chiến đỉnh tháp", "Ác quỷ bị phong ấn"],
        created_at: new Date().toISOString(),
      },
    ];

    // Evaluate for Episode 6
    const decayed = PromptOptimizer.applyRollingContextDecay(summaries, 6);

    // Episode 5 (N-1) must be detailed
    const ep5 = decayed.find((d) => d.episodeNumber === 5);
    expect(ep5).toBeDefined();
    expect(ep5?.tier).toBe("detailed");
    expect(ep5?.text).toContain("Trận chiến đỉnh điểm");
    expect(ep5?.text).toContain("Biến cố: Trận chiến đỉnh tháp");

    // Episode 4 & 3 (N-2, N-3) must be concise
    const ep4 = decayed.find((d) => d.episodeNumber === 4);
    expect(ep4?.tier).toBe("concise");
    expect(ep4?.text).toBe("Tập 4: Nam đột nhập sào huyệt giải cứu Mai.");
    expect(ep4?.text).not.toContain("Bí mật thân thế hé lộ");

    const ep3 = decayed.find((d) => d.episodeNumber === 3);
    expect(ep3?.tier).toBe("concise");
    expect(ep3?.text).toBe("Tập 3: Mai bị bắt cóc.");

    // Episode 1..2 (< N-3) must be merged into macro tier
    const macro = decayed.find((d) => d.tier === "macro");
    expect(macro).toBeDefined();
    expect(macro?.text).toContain("Tiền truyện Tập 1-2");
    expect(macro?.text).toContain("Nam tìm thấy cổ vật bí ẩn trong hang đá -> Nam và Mai trốn chạy qua thung lũng");
  });

  it("filters active characters strictly for the target scene", () => {
    const characters: CharacterRecord[] = [
      { id: "char_nam", name: "Nam", role: "protagonist", visual_summary: "Chiến binh trẻ", status: "alive" },
      { id: "char_mai", name: "Mai", role: "supporting", visual_summary: "Nữ cung thủ", status: "alive" },
      { id: "char_king", name: "Quốc Vương", role: "minor", visual_summary: "Vua già", status: "alive" },
      { id: "char_villain", name: "Hắc Báo", role: "antagonist", visual_summary: "Thủ lĩnh hắc ám", status: "alive" },
    ];

    // Scene only has Nam and Mai
    const filtered = PromptOptimizer.filterActiveCharactersForScene(
      characters,
      ["char_nam", "char_mai"],
      "char_nam"
    );

    expect(filtered.length).toBe(2);
    expect(filtered.map((c) => c.name)).toEqual(["Nam", "Mai"]);
    expect(filtered.some((c) => c.name === "Quốc Vương")).toBe(false);
  });

  it("leaves a short static prefix uncached instead of padding it with repeated instructions", () => {
    const seriesMeta: SeriesMetadataRecord = {
      id: "series_time_warrior",
      title: "Chiến Binh Thời Gian",
      genre: "Khoa học viễn tưởng / Huyền huyễn",
      visual_style: "Cinematic Anamorphic 35mm, chiaroscuro lighting",
      aspect_ratio: "16:9",
      created_at: new Date().toISOString(),
    };

    const payload = PromptOptimizer.buildCacheablePromptStructure({
      seriesMeta,
      coreWorldRules: ["Năng lượng thời gian chỉ được dùng trong 60 giây", "Cổ vật không thể bị phá hủy"],
      turnaroundArchetypes: [
        { name: "Nam", visualSummary: "Chiến binh mặc giáp đồng hồ, tóc đen ngắn, sẹo ngang trán" },
        { name: "Mai", visualSummary: "Nữ cung thủ áo lam, mắt biếc, mang cung ánh sáng" },
      ],
      dynamicUserPrompt: "Tập 1: Nam phát hiện cổ vật. Mục tiêu: Tìm đường thoát khỏi hang đá.",
      episodeNumber: 1,
    });

    expect(payload.isCacheEligible).toBe(false);
    expect(payload.estimatedStaticTokens).toBeLessThan(PromptOptimizer.ANTHROPIC_CACHE_MIN_TOKENS);
    expect(payload.systemPromptBlocks[0].cache_control).toBeUndefined();
    expect(payload.systemPromptBlocks[0].text).not.toContain("HƯỚNG DẪN BỔ TRỢ THỊ GIÁC");
    expect(payload.userPromptBlocks[0].text).toContain("Tập 1: Nam phát hiện cổ vật");
  });

  it("marks a genuinely large static prefix as cache eligible", () => {
    const coreWorldRules = Array.from(
      { length: 140 },
      (_, index) => `Quy tắc ${index + 1}: mọi quyết định phải giữ nguyên quan hệ nhân quả, kiến thức nhân vật và lịch sử đạo cụ của thế giới.`
    );
    const payload = PromptOptimizer.buildCacheablePromptStructure({
      seriesMeta: null,
      coreWorldRules,
      dynamicUserPrompt: "Viết tập tiếp theo.",
      episodeNumber: 2,
    });

    expect(payload.isCacheEligible).toBe(true);
    expect(payload.estimatedStaticTokens).toBeGreaterThanOrEqual(PromptOptimizer.ANTHROPIC_CACHE_MIN_TOKENS);
    expect(payload.systemPromptBlocks[0].cache_control).toEqual({ type: "ephemeral" });
    expect(payload.systemPromptBlocks[0].text.match(/Quy tắc 1:/g)).toHaveLength(1);
  });

  it("compresses verbose screenplay to Compact Cinema Notation and expands back losslessly", () => {
    const verboseScript = `
TẬP 1: BÌNH MINH ĐẪM MÁU
Logline: Chuyến hành trình bắt đầu.

CẢNH 1: RỪNG GIÀ - ĐÊM
Nhân vật: Nam, Mai
CÚ MÁY 1 (establishing, 4s): Toàn cảnh rừng già mờ sương, bóng đen ẩn hiện.
CÚ MÁY 2 (medium, 4s): Nam thận trọng cầm đuốc tiến vào.
NAM: [thì thầm, lo lắng] Cẩn thận, có bẫy xung quanh đây.
CÚ MÁY 3 (close_up, 4s): Cận cảnh ánh mắt căng thẳng của Mai.
MAI: [dứt khoát] Tôi đã sẵn sàng cung tên.
    `.trim();

    const compact = PromptOptimizer.toCompactCinemaNotation(verboseScript);

    // Verify compact shorthand form
    expect(compact).toContain("C1.1 [EST|4s]: Toàn cảnh rừng già mờ sương, bóng đen ẩn hiện.");
    expect(compact).toContain("C1.2 [MED|4s]: Nam thận trọng cầm đuốc tiến vào.");
    expect(compact).toContain("C1.3 [CU|4s]: Cận cảnh ánh mắt căng thẳng của Mai.");

    // Measure token savings: Compact must be noticeably smaller
    const verboseTokens = PromptOptimizer.estimateTokens(verboseScript);
    const compactTokens = PromptOptimizer.estimateTokens(compact);
    expect(compactTokens).toBeLessThan(verboseTokens);

    // Expand back
    const expanded = PromptOptimizer.expandCompactCinemaNotation(compact);
    expect(expanded).toContain("CÚ MÁY 1 (establishing, 4s): Toàn cảnh rừng già mờ sương, bóng đen ẩn hiện.");
    expect(expanded).toContain("CÚ MÁY 2 (medium, 4s): Nam thận trọng cầm đuốc tiến vào.");
    expect(expanded).toContain("CÚ MÁY 3 (close_up, 4s): Cận cảnh ánh mắt căng thẳng của Mai.");
    expect(expanded).toContain("NAM: [thì thầm, lo lắng] Cẩn thận, có bẫy xung quanh đây.");
  });

  it("handles OTS_BA and TWO shot types correctly in compact notation", () => {
    const script = `
CẢNH 1: ĐỐI THOẠI
CÚ MÁY 1 (two_shot, 5s): Nam và Mai đứng cạnh nhau bên bàn cờ.
CÚ MÁY 2 (ots_b_a, 4s): Góc qua vai Mai nhìn sang Nam đang trầm ngâm.
    `.trim();

    const compact = PromptOptimizer.toCompactCinemaNotation(script);
    expect(compact).toContain("C1.1 [TWO|5s]: Nam và Mai đứng cạnh nhau bên bàn cờ.");
    expect(compact).toContain("C1.2 [OTS_BA|4s]: Góc qua vai Mai nhìn sang Nam đang trầm ngâm.");

    const expanded = PromptOptimizer.expandCompactCinemaNotation(compact);
    expect(expanded).toContain("CÚ MÁY 1 (two_shot, 5s): Nam và Mai đứng cạnh nhau bên bàn cờ.");
    expect(expanded).toContain("CÚ MÁY 2 (ots_b_a, 4s): Góc qua vai Mai nhìn sang Nam đang trầm ngâm.");
  });
});
