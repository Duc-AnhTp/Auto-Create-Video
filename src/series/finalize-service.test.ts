import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { BibleManager } from "../bible/bible-manager.js";
import { finalizeEpisodeProduction } from "./finalize-service.js";
import { createValidMockMp4File } from "../assets/mock-media-generator.js";

describe("Finalize Service (PR2 Production Gatekeeper)", () => {
  const testDbPath = join("data", "test-finalize-service.db");
  const testOutputDir = join("data", "test-finalize-output");
  let bible: BibleManager;

  const seriesId = "series_finalize_test";
  const episodeNumber = 1;

  beforeEach(async () => {
    BibleManager.closeAll();
    await rm(testDbPath, { force: true });
    await rm(testOutputDir, { recursive: true, force: true });
    await mkdir(testOutputDir, { recursive: true });

    bible = new BibleManager(testDbPath);
    bible.upsertSeriesMetadata({
      id: seriesId,
      title: "Test Finalize Series",
      genre: "Drama",
      visual_style: "Cinematic",
      aspect_ratio: "9:16",
      fps: 30,
      created_at: new Date().toISOString(),
    });

    bible.upsertCharacter({
      id: "char_a",
      series_id: seriesId,
      name: "Alice",
      role: "protagonist",
      status: "alive",
    });
  });

  afterEach(async () => {
    BibleManager.closeAll();
    await rm(testDbPath, { force: true });
    await rm(testOutputDir, { recursive: true, force: true });
  });

  it("1. Rejects finalization when script has no scenes", async () => {
    const res = await finalizeEpisodeProduction({
      seriesId,
      episodeNumber,
      script: { title: "Empty Script", scenes: [] },
      bible,
    });

    expect(res.success).toBe(false);
    expect(res.error).toContain("scenes rỗng");
  });

  it("2. Rejects finalization when shots lack approved takes or take file is missing", async () => {
    const script = {
      title: "Tập 1: Mở Đầu",
      scenes: [
        {
          sceneId: "sc_01",
          sceneNumber: 1,
          shots: [{ shotId: "sh_01", durationSec: 3 }],
        },
      ],
    };

    // Case 2a: No approved take exists
    const resNoTake = await finalizeEpisodeProduction({
      seriesId,
      episodeNumber,
      script,
      bible,
    });
    expect(resNoTake.success).toBe(false);
    expect(resNoTake.missingApprovals?.length).toBe(1);
    expect(resNoTake.missingApprovals![0]).toContain("chưa có take được duyệt");

    // Case 2b: Approved take exists but file does not exist on disk
    bible.recordShotTake({
      id: "take_sh_01",
      series_id: seriesId,
      episode_number: episodeNumber,
      shot_id: "sh_01",
      provider: "luma",
      local_path: join(testOutputDir, "non_existent_take.mp4"),
      is_approved: 1,
      created_at: new Date().toISOString(),
    });

    const resMissingFile = await finalizeEpisodeProduction({
      seriesId,
      episodeNumber,
      script,
      bible,
    });
    expect(resMissingFile.success).toBe(false);
    expect(resMissingFile.missingApprovals![0]).toContain("không tồn tại trên đĩa");
  });

  it("3. Provenance Gate: Rejects mock media when allowMockMedia is false", async () => {
    const mockClipPath = join(testOutputDir, "mock_clip.mp4");
    await createValidMockMp4File(mockClipPath, 3, 720, 1280);

    bible.recordShotTake({
      id: "take_mock_01",
      series_id: seriesId,
      episode_number: episodeNumber,
      shot_id: "sh_01",
      provider: "mock",
      local_path: mockClipPath,
      is_approved: 1,
      created_at: new Date().toISOString(),
    });

    const script = {
      title: "Tập 1: Mở Đầu",
      scenes: [
        {
          sceneId: "sc_01",
          sceneNumber: 1,
          charactersPresent: ["char_a"],
          shots: [{ shotId: "sh_01", durationSec: 3 }],
        },
      ],
    };

    // Default allowMockMedia is false
    const resMockBlocked = await finalizeEpisodeProduction({
      seriesId,
      episodeNumber,
      script,
      bible,
      outputDir: testOutputDir,
      allowMockMedia: false,
    });

    expect(resMockBlocked.success).toBe(false);
    expect(resMockBlocked.error).toContain("PROVENANCE GATE");
    expect(resMockBlocked.mockTakesDetected?.length).toBe(1);
  });

  it("4. Assembles, validates QA, computes deterministic commitId and advances coverage ledger", async () => {
    const realClipPath = join(testOutputDir, "real_clip.mp4");
    await createValidMockMp4File(realClipPath, 3, 720, 1280);

    // Setup approved take with production provider
    bible.recordShotTake({
      id: "take_prod_01",
      series_id: seriesId,
      episode_number: episodeNumber,
      shot_id: "sh_01",
      provider: "kling",
      local_path: realClipPath,
      is_approved: 1,
      created_at: new Date().toISOString(),
    });

    bible.upsertSeriesPlan({
      id: "plan_test",
      series_id: seriesId,
      source_id: "src_01",
      revision: 1,
      target_episodes: 1,
      target_duration_per_episode_sec: 60,
      pacing_preset: "standard",
      status: "approved",
      summary_json: "{}",
    });

    // Setup coverage ledger in 'scripted' stage
    bible.upsertCoverageLedger({
      id: "cov_ep1_sh01",
      plan_id: "plan_test",
      series_id: seriesId,
      source_id: "src_01",
      source_unit_id: "unit_01",
      episode_number: episodeNumber,
      scene_number: 1,
      shot_id: "sh_01",
      adaptation_decision: "kept",
      stage: "scripted",
      created_at: new Date().toISOString(),
    });

    const script = {
      title: "Tập 1: Mở Đầu",
      logline: "Alice bước vào hành trình mới.",
      scenes: [
        {
          sceneId: "sc_01",
          sceneNumber: 1,
          charactersPresent: ["char_a"],
          shots: [
            {
              shotId: "sh_01",
              durationSec: 3,
              visualPrompt: "Alice đi qua cổng thành.",
            },
          ],
        },
      ],
    };

    // Run first finalization
    const res1 = await finalizeEpisodeProduction({
      seriesId,
      episodeNumber,
      script,
      bible,
      outputDir: testOutputDir,
      allowMockMedia: true,
    });

    expect(res1.success).toBe(true);
    expect(res1.canonCommitted).toBe(true);
    expect(res1.masterVideoPath).toBeDefined();
    expect(res1.commitId).toBeDefined();

    // Verify coverage ledger stage advanced to 'assembled'
    const updatedLedger = bible.listCoverageLedgers(seriesId).find((l) => l.id === "cov_ep1_sh01");
    expect(updatedLedger?.stage).toBe("assembled");

    // Run second finalization (idempotent verification)
    const res2 = await finalizeEpisodeProduction({
      seriesId,
      episodeNumber,
      script,
      bible,
      outputDir: testOutputDir,
      allowMockMedia: true,
    });

    expect(res2.success).toBe(true);
    expect(res2.commitId).toBe(res1.commitId);
    // Canon already committed, should not duplicate
    expect(res2.canonCommitted).toBe(false);
  });
});
