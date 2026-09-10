import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { EpisodicPipeline } from "./episodic-pipeline.js";
import { BibleManager } from "../bible/bible-manager.js";
import { normalizeScript } from "./script-normalizer.js";
import { buildMasterTimeline } from "./audio-assembler.js";
import { existsSync, readFileSync } from "node:fs";
import { readFile, rm, mkdir } from "node:fs/promises";
import { join } from "node:path";

describe("Multi-Episode Continuity & Canon Memory Verification", () => {
  const testOutputDir = join("output", "test-multi-episode");
  const ep1ScriptPath = join("scripts", "example-series", "cyber-saigon-pilot-2min.txt");
  const ep2ScriptPath = join("scripts", "example-series", "cyber-saigon-ep2.txt");

  beforeEach(async () => {
    if (existsSync(testOutputDir)) {
      try {
        await rm(testOutputDir, { recursive: true, force: true });
      } catch {}
    }
    await mkdir(testOutputDir, { recursive: true });
  });

  afterEach(async () => {
    if (existsSync(testOutputDir)) {
      try {
        await rm(testOutputDir, { recursive: true, force: true });
      } catch {}
    }
  });

  it("successfully maintains permanent Canon Memory and state inheritance across Episode 1 and Episode 2", async () => {
    const pipeline = new EpisodicPipeline(":memory:");
    const bible = pipeline.getBible();

    // 1. Initialize Series Metadata
    bible.upsertSeriesMetadata({
      id: "cyber-saigon",
      title: "Sài Gòn 2088",
      genre: "Cyberpunk Noir",
      visual_style: "Cinematic 35mm, neon noir",
      aspect_ratio: "9:16",
      fps: 30,
      created_at: new Date().toISOString(),
    });

    // 2. Register initial characters & props
    bible.upsertCharacter({
      id: "minh",
      name: "Minh",
      role: "protagonist",
      visual_summary: "Kỹ sư phản kháng",
      distinguishing_marks: "Vết sẹo mảnh ngang mày trái",
      status: "alive",
    });

    bible.upsertCharacter({
      id: "an",
      name: "An",
      role: "protagonist",
      visual_summary: "Hacker lượng tử",
      status: "alive",
    });

    bible.upsertCharacter({
      id: "linh",
      name: "Linh",
      role: "supporting",
      visual_summary: "Nữ điệp viên",
      status: "alive",
    });

    bible.upsertKeyProp({
      id: "chip_luong_tu",
      name: "Chip Lượng Tử",
      visual_summary: "Vi mạch lượng tử phát ánh sáng xanh lục",
      current_holder_id: "minh", // In the beginning, Minh holds it
      status: "intact",
    });

    // Verify initial state
    expect(bible.getKeyProp("chip_luong_tu")?.current_holder_id).toBe("minh");
    expect(bible.getCharacter("minh")?.status).toBe("alive");

    // 3. Produce Episode 1
    const ep1Raw = await readFile(ep1ScriptPath, "utf8");
    const ep1OutputDir = join(testOutputDir, "ep-01");

    const ep1Delta = {
      prop_transfers: [
        {
          prop_id: "chip_luong_tu",
          new_holder_id: "an", // Transferred to An!
          status: "intact",
        },
      ],
      character_status_updates: [
        {
          id: "minh",
          status: "injured",
          distinguishing_marks: "Vết sẹo mảnh ngang mày trái, vết thương trúng đạn laser ở bắp tay phải",
        },
      ],
      world_state_updates: {
        corporation_alert_level: "RED",
        skyline_tower_breached: true,
      },
      major_events: [
        "Minh bàn giao thành công Chip Lượng Tử cho An",
        "Dữ liệu mật của tập đoàn bị phát tán từ tháp Skyline",
      ],
      total_production_cost_usd: 0.15,
    };

    const ep1Result = await pipeline.produceEpisode(ep1Raw, {
      seriesId: "cyber-saigon",
      outputDir: ep1OutputDir,
      provider: "mock",
      mockTts: true,
      skipRender: true,
      narrativeDelta: ep1Delta,
    });

    expect(ep1Result.episodeNumber).toBe(1);
    expect(existsSync(ep1Result.videoPath)).toBe(true);

    // 4. Verify Story Bible state AFTER Episode 1
    const propAfterEp1 = bible.getKeyProp("chip_luong_tu");
    expect(propAfterEp1?.current_holder_id).toBe("an"); // Chip is now held by An!

    const minhAfterEp1 = bible.getCharacter("minh");
    expect(minhAfterEp1?.status).toBe("injured");
    expect(minhAfterEp1?.distinguishing_marks).toContain("bắp tay phải");

    const worldAfterEp1 = bible.getAllWorldState();
    expect(worldAfterEp1["corporation_alert_level"]).toBe("RED");
    expect(worldAfterEp1["skyline_tower_breached"]).toBe(true);

    const takesEp1 = bible.listShotTakes("cyber-saigon", 1);
    expect(takesEp1.length).toBe(32);

    // 5. Produce Episode 2 inheriting the Canon Memory
    const ep2Raw = await readFile(ep2ScriptPath, "utf8");
    const ep2OutputDir = join(testOutputDir, "ep-02");

    const ep2Normalized = normalizeScript(ep2Raw, bible, { seriesId: "cyber-saigon" });
    expect(ep2Normalized.episodeNumber).toBe(2);
    expect(ep2Normalized.scenes.length).toBe(3);

    const ep2Timeline = buildMasterTimeline(ep2Normalized);
    expect(ep2Timeline.videoTrack.length).toBe(14); // 4 + 4 + 6 shots
    expect(ep2Timeline.totalDurationSec).toBe(65);

    const ep2Delta = {
      world_state_updates: {
        bach_dang_wharf_blocked: true,
        submarine_escaped: true,
      },
      major_events: [
        "Ba người mở đường máu qua bến Bạch Đằng bằng ca nô ngầm",
        "Con Chip Lượng Tử đang được vận chuyển đến căn cứ ngầm",
      ],
      total_production_cost_usd: 0.12,
    };

    const ep2Result = await pipeline.produceEpisode(ep2Raw, {
      seriesId: "cyber-saigon",
      outputDir: ep2OutputDir,
      provider: "mock",
      mockTts: true,
      skipRender: true,
      narrativeDelta: ep2Delta,
    });

    expect(ep2Result.episodeNumber).toBe(2);
    expect(existsSync(ep2Result.videoPath)).toBe(true);

    // 6. Verify Story Bible state AFTER Episode 2
    // Chip is STILL with An
    const propAfterEp2 = bible.getKeyProp("chip_luong_tu");
    expect(propAfterEp2?.current_holder_id).toBe("an");

    // World state accumulates
    const worldAfterEp2 = bible.getAllWorldState();
    expect(worldAfterEp2["corporation_alert_level"]).toBe("RED");
    expect(worldAfterEp2["skyline_tower_breached"]).toBe(true);
    expect(worldAfterEp2["submarine_escaped"]).toBe(true);

    // Shot takes isolation per episode
    const takesEp2 = bible.listShotTakes("cyber-saigon", 2);
    expect(takesEp2.length).toBe(14);
    expect(takesEp1.length).toBe(32);

    // Canon History has 2 consecutive episodes
    const canonHistory = bible.getCanonHistory();
    expect(canonHistory.length).toBe(2);
    expect(canonHistory[0].episode_number).toBe(1);
    expect(canonHistory[1].episode_number).toBe(2);
    expect(canonHistory[1].major_events[0]).toContain("Bạch Đằng");
  });
});
