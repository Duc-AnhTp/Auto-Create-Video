import { describe, it, expect, vi } from "vitest";
import { ContextBuilder } from "./context-builder.js";
import type {
  BibleManager,
  SeriesMetadataRecord,
  PlannedEpisodeRecord,
  EpisodeSummaryRecord,
  StoryBeatRecord,
  CharacterRecord,
  ChekhovGunRecord,
} from "../bible/bible-manager.js";

describe("ContextBuilder", () => {
  it("builds episode context including sliding window continuity memory and chekhov warnings", () => {
    const mockSeriesMetadata: SeriesMetadataRecord = {
      id: "cyber_saigon",
      title: "Cyber Sài Gòn 2088",
      visual_style: "Cyberpunk Neon Noir",
      aspect_ratio: "9:16",
    };

    const mockPlannedEpisode: PlannedEpisodeRecord = {
      id: "plan_ep2",
      plan_id: "plan_1",
      series_id: "cyber_saigon",
      episode_number: 2,
      title: "Vết Nứt Đầu Tiên",
      logline: "Minh thâm nhập vào trụ sở tập đoàn.",
      target_duration_sec: 180,
    };

    const mockPrevEpisodeSummary: EpisodeSummaryRecord = {
      series_id: "cyber_saigon",
      episode_number: 1,
      title: "Bóng Đêm Thức Giấc",
      logline: "Minh phát hiện xác chết của người cộng sự.",
      major_events: ["Phát hiện xác chết trong ngõ hẻm", "Lấy được chìa khóa mã hóa"],
      created_at: new Date().toISOString(),
    };

    const mockChekhovGuns: ChekhovGunRecord[] = [
      {
        id: "gun_usb",
        series_id: "cyber_saigon",
        name: "Chiếc USB chứa mã nguồn",
        type: "prop",
        description: "USB tìm thấy bên thi thể",
        planted_at_episode: 1,
        payoff_status: "planted",
        dormant_episodes_count: 2, // At Ep 2: 2 - 1 = 1 if calculated, but test with explicit or evaluate
      },
    ];

    const mockBible = {
      getSeriesMetadata: vi.fn().mockReturnValue(mockSeriesMetadata),
      getSeriesPlan: vi.fn().mockReturnValue(null),
      getActiveSeriesPlan: vi.fn().mockReturnValue({ id: "plan_1" }),
      getPlannedEpisode: vi.fn().mockImplementation((planId: string, epNum: number) => {
        if (epNum === 2) return mockPlannedEpisode;
        return null;
      }),
      listCoverageLedgers: vi.fn().mockReturnValue([]),
      getSourceUnit: vi.fn().mockReturnValue(null),
      listStoryBeats: vi.fn().mockReturnValue([]),
      listCharacters: vi.fn().mockReturnValue([
        {
          id: "char_minh",
          name: "Minh",
          role: "protagonist",
          visual_summary: "Thám tử tư, áo khoác đen viền neon",
          status: "alive",
        },
      ]),
      listKnowledgeStates: vi.fn().mockReturnValue([]),
      listStoryThreads: vi.fn().mockReturnValue([]),
      getNegativeConstraints: vi.fn().mockReturnValue(["Không dùng phép thuật"]),
      getEpisodeSummary: vi.fn().mockImplementation((epNum: number) => {
        if (epNum === 1) return mockPrevEpisodeSummary;
        return null;
      }),
      listChekhovGuns: vi.fn().mockReturnValue([
        {
          id: "gun_usb",
          series_id: "cyber_saigon",
          name: "Chiếc USB chứa mã nguồn",
          type: "prop",
          description: "USB tìm thấy bên thi thể",
          planted_at_episode: 0, // Planted in prologue -> dormant count in Ep 2 = 2
          payoff_status: "planted",
        },
      ]),
      listActiveChekhovGuns: vi.fn().mockImplementation((seriesId: string, currentEp: number) => [
        {
          id: "gun_usb",
          series_id: "cyber_saigon",
          name: "Chiếc USB chứa mã nguồn",
          type: "prop",
          description: "USB tìm thấy bên thi thể",
          planted_at_episode: 0,
          payoff_status: "planted",
          dormant_episodes_count: currentEp - 0, // 2 >= 2
        },
      ]),
    } as unknown as BibleManager;

    const ctx = ContextBuilder.buildEpisodeContext(mockBible, {
      seriesId: "cyber_saigon",
      episodeNumber: 2,
    });

    expect(ctx.seriesId).toBe("cyber_saigon");
    expect(ctx.episodeNumber).toBe(2);

    // Verify Continuity Memory Window from Episode 1
    expect(ctx.continuityMemory).toBeDefined();
    expect(ctx.continuityMemory?.previousEpisodeNumber).toBe(1);
    expect(ctx.continuityMemory?.previousEpisodeTitle).toBe("Bóng Đêm Thức Giấc");
    expect(ctx.continuityMemory?.previousMajorEvents).toContain("Lấy được chìa khóa mã hóa");

    // Verify Chekhov Gun Dormant Warning
    expect(ctx.chekhovReport).toBeDefined();
    expect(ctx.chekhovReport?.dormantWarningGuns.length).toBe(1);
    expect(ctx.chekhovWarningsPrompt).toContain("CHEKHOV'S GUN BỊ LÃNG QUÊN");
    expect(ctx.chekhovWarningsPrompt).toContain("Chiếc USB chứa mã nguồn");

    // Verify Formatted Prompt contains all necessary sections
    expect(ctx.formattedPrompt).toContain("SLIDING WINDOW CONTINUITY MEMORY");
    expect(ctx.formattedPrompt).toContain("Tập trước (Tập 1): Bóng Đêm Thức Giấc");
    expect(ctx.formattedPrompt).toContain("Chiếc USB chứa mã nguồn");
    expect(ctx.formattedPrompt).toContain("Vết Nứt Đầu Tiên");
    expect(ctx.formattedPrompt).toContain("Thám tử tư, áo khoác đen viền neon");
  });
});
