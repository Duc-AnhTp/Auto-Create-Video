import { describe, it, expect, vi } from "vitest";
import { evaluateChekhovGuns, generateChekhovWarningsPrompt } from "./chekhov-tracker.js";
import type { BibleManager, ChekhovGunRecord } from "../bible/bible-manager.js";

describe("ChekhovTracker", () => {
  it("evaluates dormant guns when dormant episode count exceeds threshold", () => {
    const mockGuns: ChekhovGunRecord[] = [
      {
        id: "gun_1",
        series_id: "series_main",
        name: "Mảnh bản đồ cổ",
        type: "prop",
        description: "Mảnh bản đồ tìm thấy trong khoang bí mật",
        planted_at_episode: 1,
        payoff_status: "planted",
        dormant_episodes_count: 3, // In Episode 4 -> dormant count = 3
        created_at: new Date().toISOString(),
      },
      {
        id: "gun_2",
        series_id: "series_main",
        name: "Tin nhắn nặc danh",
        type: "secret",
        description: "Tin nhắn đe dọa gửi lúc nửa đêm",
        planted_at_episode: 3,
        payoff_status: "planted",
        dormant_episodes_count: 1, // In Episode 4 -> dormant count = 1 (< threshold 2)
        created_at: new Date().toISOString(),
      },
    ];

    const mockBible = {
      listActiveChekhovGuns: vi.fn().mockReturnValue(mockGuns),
    } as unknown as BibleManager;

    const report = evaluateChekhovGuns(mockBible, "series_main", 4, 2);

    expect(report.currentEpisode).toBe(4);
    expect(report.totalActiveGuns).toBe(2);
    expect(report.dormantWarningGuns.length).toBe(1);
    expect(report.dormantWarningGuns[0].name).toBe("Mảnh bản đồ cổ");
  });

  it("generates formatted warning prompt when dormant guns exist", () => {
    const mockReport = {
      currentEpisode: 4,
      totalActiveGuns: 1,
      dormantWarningGuns: [
        {
          id: "gun_1",
          series_id: "series_main",
          name: "Chiếc nhẫn ngọc bích",
          type: "prop",
          description: "Vật gia bảo của gia tộc họ Vũ",
          planted_at_episode: 1,
          payoff_status: "planted" as const,
          dormant_episodes_count: 3,
        },
      ],
      allActiveGuns: [],
    };

    const prompt = generateChekhovWarningsPrompt(mockReport);

    expect(prompt).toContain("CHEKHOV'S GUN BỊ LÃNG QUÊN");
    expect(prompt).toContain("Chiếc nhẫn ngọc bích");
    expect(prompt).toContain("Đã gài từ Tập 1");
    expect(prompt).toContain("bỏ quên 3 tập");
    expect(prompt).toContain("Chỉ thị: Hãy tạo tình huống giải quyết");
  });

  it("returns empty prompt when no dormant guns exist", () => {
    const mockReport = {
      currentEpisode: 2,
      totalActiveGuns: 1,
      dormantWarningGuns: [],
      allActiveGuns: [],
    };

    const prompt = generateChekhovWarningsPrompt(mockReport);
    expect(prompt).toBe("");
  });
});
