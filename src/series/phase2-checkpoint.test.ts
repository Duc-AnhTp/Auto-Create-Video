import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { EpisodicPipeline } from "./episodic-pipeline.js";
import { BibleManager } from "../bible/bible-manager.js";
import { existsSync, readFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { join } from "node:path";

describe("Phase 2 Verification: Shot Takes, Checkpointing, Resume, Reroll & Remux", () => {
  const testOutputDir = join("output", "test-phase2-series");
  const testDbPath = join(testOutputDir, "story_bible.db");

  beforeEach(async () => {
    if (existsSync(testOutputDir)) {
      try {
        await rm(testOutputDir, { recursive: true, force: true });
      } catch {}
    }
  });

  afterEach(async () => {
    if (existsSync(testOutputDir)) {
      try {
        await rm(testOutputDir, { recursive: true, force: true });
      } catch {}
    }
  });

  describe("1. Story Bible SQLite Shot Takes Management", () => {
    it("records, lists, and approves takes correctly in SQLite", () => {
      const bible = new BibleManager(":memory:");

      // Record Take 1
      bible.recordShotTake({
        id: "cyber_ep01_sc01_sh01_take01",
        series_id: "cyber-saigon",
        episode_number: 1,
        shot_id: "sc01_sh01",
        take_number: 1,
        provider: "mock",
        prompt: "Khung cảnh hẻm tối",
        local_path: "output/shots/sc01_sh01_take01.mp4",
        duration_sec: 4.0,
        qa_status: "PASS",
        is_approved: true,
        cost_usd: 0.05,
      });

      // Record Take 2
      bible.recordShotTake({
        id: "cyber_ep01_sc01_sh01_take02",
        series_id: "cyber-saigon",
        episode_number: 1,
        shot_id: "sc01_sh01",
        take_number: 2,
        provider: "mock",
        prompt: "Khung cảnh hẻm tối có ánh đèn neon nhấp nháy",
        local_path: "output/shots/sc01_sh01_take02.mp4",
        duration_sec: 4.0,
        qa_status: "PASS",
        is_approved: false,
        cost_usd: 0.05,
      });

      const takes = bible.listShotTakes("cyber-saigon", 1, "sc01_sh01");
      expect(takes.length).toBe(2);
      expect(takes[0].take_number).toBe(1);
      expect(takes[1].take_number).toBe(2);

      // Take 1 is initially approved
      const initialApproved = bible.getApprovedTakeForShot("cyber-saigon", 1, "sc01_sh01");
      expect(initialApproved?.id).toBe("cyber_ep01_sc01_sh01_take01");

      // Approve Take 2
      bible.approveShotTake("cyber_ep01_sc01_sh01_take02");
      const updatedApproved = bible.getApprovedTakeForShot("cyber-saigon", 1, "sc01_sh01");
      expect(updatedApproved?.id).toBe("cyber_ep01_sc01_sh01_take02");

      // Take 1 is no longer approved
      const take1 = bible.getShotTake("cyber_ep01_sc01_sh01_take01");
      expect(take1?.is_approved).toBe(false);
    });
  });

  describe("2. Checkpointing and Resume Lifecycle", () => {
    it("creates checkpoint.json and successfully resumes completed shots", async () => {
      const pipeline = new EpisodicPipeline(":memory:");
      const bible = pipeline.getBible();

      bible.upsertSeriesMetadata({
        id: "cyber-saigon",
        title: "Sài Gòn 2088",
        genre: "Cyberpunk",
        visual_style: "Cinematic 35mm, neon lights",
        aspect_ratio: "9:16",
        fps: 30,
        created_at: new Date().toISOString(),
      });

      const rawScript = `
TẬP 1: BẢN HỢP ĐỒNG BÓNG ĐÊM
Logline: Minh bí mật bàn giao chip lượng tử.

CẢNH 1: QUÁN BAR HẺM 9 - ĐÊM
CÚ MÁY 1 (establishing, 4s): Khung cảnh hẻm tối.
CÚ MÁY 2 (medium, 4s): Minh ngồi trong góc khuất.
MINH: Cầm lấy con chip này.
`.trim();

      // Initial run
      const result = await pipeline.produceEpisode(rawScript, {
        seriesId: "cyber-saigon",
        outputDir: testOutputDir,
        provider: "mock",
        mockTts: true,
        skipRender: true,
      });

      expect(result.episodeNumber).toBe(1);
      const checkpointPath = join(testOutputDir, "checkpoint.json");
      expect(existsSync(checkpointPath)).toBe(true);

      const job = JSON.parse(readFileSync(checkpointPath, "utf8"));
      expect(job.status).toBe("completed");
      expect(job.shots["sc1_sh1"].status).toBe("completed");
      expect(job.shots["sc1_sh2"].status).toBe("completed");
      expect(job.shots["sc1_sh1"].activeTakeId).toContain("take01");

      // Verify shot_takes were recorded in Bible
      const takesSh1 = bible.listShotTakes("cyber-saigon", 1, "sc1_sh1");
      expect(takesSh1.length).toBe(1);
      expect(takesSh1[0].is_approved).toBe(true);

      // Now run with resume: true -> should reuse checkpoint and succeed
      const resumedResult = await pipeline.produceEpisode(rawScript, {
        seriesId: "cyber-saigon",
        outputDir: testOutputDir,
        provider: "mock",
        mockTts: true,
        skipRender: true,
        resume: true,
      });

      expect(resumedResult.episodeNumber).toBe(1);
      expect(existsSync(resumedResult.videoPath)).toBe(true);
    });
  });

  describe("3. Single Shot Re-roll & Remux Without Full Re-generation", () => {
    it("re-rolls a single shot, creates take02, and remuxes the episode", async () => {
      const pipeline = new EpisodicPipeline(":memory:");
      const bible = pipeline.getBible();

      bible.upsertSeriesMetadata({
        id: "cyber-saigon",
        title: "Sài Gòn 2088",
        genre: "Cyberpunk",
        visual_style: "Cinematic 35mm, neon lights",
        aspect_ratio: "9:16",
        fps: 30,
        created_at: new Date().toISOString(),
      });

      const rawScript = `
TẬP 1: BẢN HỢP ĐỒNG BÓNG ĐÊM
Logline: Minh bí mật bàn giao chip lượng tử.

CẢNH 1: QUÁN BAR HẺM 9 - ĐÊM
CÚ MÁY 1 (establishing, 4s): Khung cảnh hẻm tối.
CÚ MÁY 2 (medium, 4s): Minh ngồi trong góc khuất.
MINH: Cầm lấy con chip này.
`.trim();

      // Initial production
      await pipeline.produceEpisode(rawScript, {
        seriesId: "cyber-saigon",
        outputDir: testOutputDir,
        provider: "mock",
        mockTts: true,
        skipRender: true,
      });

      // Re-roll shot 2 only!
      const rerollResult = await pipeline.rerollShot({
        seriesId: "cyber-saigon",
        episodeNumber: 1,
        shotId: "sc1_sh2",
        outputDir: testOutputDir,
        promptOverride: "Minh nhìn thẳng vào ống kính với ánh mắt kiên định",
        provider: "mock",
      });

      expect(rerollResult.shotId).toBe("sc1_sh2");
      expect(rerollResult.takeId).toContain("take02");
      expect(existsSync(rerollResult.videoPath)).toBe(true);

      // Verify takes in Story Bible
      const takesSh2 = bible.listShotTakes("cyber-saigon", 1, "sc1_sh2");
      expect(takesSh2.length).toBe(2);
      expect(takesSh2[1].take_number).toBe(2);
      expect(takesSh2[1].is_approved).toBe(true);

      // Verify checkpoint active take updated
      const checkpoint = await pipeline.loadCheckpoint(testOutputDir);
      expect(checkpoint?.shots["sc1_sh2"].activeTakeId).toBe(rerollResult.takeId);

      // Remux episode
      const remuxResult = await pipeline.remuxEpisode({
        seriesId: "cyber-saigon",
        episodeNumber: 1,
        outputDir: testOutputDir,
        skipRender: true,
      });

      expect(existsSync(remuxResult.videoPath)).toBe(true);
    });
  });
});
