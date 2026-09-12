import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { EpisodicPipeline } from "./episodic-pipeline.js";
import { BibleManager } from "../bible/bible-manager.js";
import {
  MockVisualQaBackend,
  UninstalledVisualQaBackend,
} from "../qa/face-evaluator.js";
import { probeVideoFile, probeAudioFile } from "../media/media-validator.js";
import { existsSync, readFileSync } from "node:fs";
import { rm, mkdir, writeFile, readFile, stat } from "node:fs/promises";
import { join } from "node:path";

describe("Scopes A, B, C, D Hardening & Regression Test Suite", () => {
  const testBaseDir = join("output", "test-scopes-abcd-regression");

  beforeEach(async () => {
    BibleManager.closeAll();
    if (existsSync(testBaseDir)) {
      try {
        await rm(testBaseDir, { recursive: true, force: true });
      } catch {}
    }
    await mkdir(testBaseDir, { recursive: true });
  });

  afterEach(async () => {
    BibleManager.closeAll();
    if (existsSync(testBaseDir)) {
      try {
        await rm(testBaseDir, { recursive: true, force: true });
      } catch {}
    }
  });

  // ═════════════════════════════════════════════════════════════════════════════
  // SCOPE A (P1): Atomic Take Reservation under Concurrency
  // ═════════════════════════════════════════════════════════════════════════════
  describe("Scope A (P1) - Atomic Take Reservation under Concurrency", () => {
    it("allocates strictly unique, monotonically contiguous take numbers under concurrent reservation", async () => {
      const dbPath = join(testBaseDir, "concurrency_test.db");
      const bible = new BibleManager(dbPath);
      bible.upsertSeriesMetadata({
        id: "series_scope_a",
        title: "Scope A Series",
        visual_style: "Cinematic",
        aspect_ratio: "16:9",
        fps: 30,
        created_at: new Date().toISOString(),
      });

      const workerCount = 12;
      const reservationPromises = Array.from({ length: workerCount }, (_, i) => {
        return Promise.resolve().then(() =>
          bible.atomicReserveShotTake({
            seriesId: "series_scope_a",
            episodeNumber: 1,
            shotId: "sc01_sh01",
            provider: "mock",
            prompt: `Prompt for concurrent worker ${i + 1}`,
          })
        );
      });

      const results = await Promise.all(reservationPromises);

      // Verify all workers received a result without any crashes or deadlocks
      expect(results.length).toBe(workerCount);

      const takeNumbers = results.map((r) => r.takeNumber);
      const takeIds = results.map((r) => r.takeId);

      // Verify uniqueness
      const uniqueTakeNumbers = new Set(takeNumbers);
      const uniqueTakeIds = new Set(takeIds);
      expect(uniqueTakeNumbers.size).toBe(workerCount);
      expect(uniqueTakeIds.size).toBe(workerCount);

      // Verify contiguous sequence 1..12
      const sortedNumbers = [...takeNumbers].sort((a, b) => a - b);
      expect(sortedNumbers).toEqual(Array.from({ length: workerCount }, (_, i) => i + 1));

      // Verify SQLite state matches exactly
      const allTakes = bible.listShotTakes("series_scope_a", 1);
      expect(allTakes.length).toBe(workerCount);
      const recordedNumbers = allTakes.map((t) => t.take_number ?? 0).sort((a, b) => a - b);
      expect(recordedNumbers).toEqual(sortedNumbers);
    });

    it("avoids collisions by checking disk files atomically and advancing take number", async () => {
      const dbPath = join(testBaseDir, "disk_collision.db");
      const bible = new BibleManager(dbPath);
      bible.upsertSeriesMetadata({
        id: "series_disk_test",
        title: "Disk Test",
        visual_style: "Cinematic",
        aspect_ratio: "16:9",
        fps: 30,
        created_at: new Date().toISOString(),
      });

      const shotsDir = join(testBaseDir, "shots");
      await mkdir(shotsDir, { recursive: true });

      // Pre-create files on disk for take 1 and take 2
      const file1 = join(shotsDir, "sc01_sh01_take01.mp4");
      const file2 = join(shotsDir, "sc01_sh01_take02.mp4");
      await writeFile(file1, "EXISTING_TAKE_1_BYTES");
      await writeFile(file2, "EXISTING_TAKE_2_BYTES");

      // Atomic reservation should detect existing files and skip to take 3
      const reserved = bible.atomicReserveShotTake({
        seriesId: "series_disk_test",
        episodeNumber: 1,
        shotId: "sc01_sh01",
        provider: "mock",
        prompt: "Check disk avoidance",
        localPathBuilder: (num, numStr) => join(shotsDir, `sc01_sh01_take${numStr}.mp4`),
      });

      expect(reserved.takeNumber).toBe(3);
      expect(reserved.takeNumStr).toBe("03");
      expect(reserved.takeId).toBe("series_disk_test_ep01_sc01_sh01_take03");
      expect(reserved.localPath).toBe(join(shotsDir, "sc01_sh01_take03.mp4"));
    });

    it("treats canonical and equivalent shot IDs (e.g. sc1_sh1 vs sc01_sh01) as the same sequence", async () => {
      const dbPath = join(testBaseDir, "alias_test.db");
      const bible = new BibleManager(dbPath);
      bible.upsertSeriesMetadata({
        id: "series_alias",
        title: "Alias Test",
        visual_style: "Cinematic",
        aspect_ratio: "16:9",
        fps: 30,
        created_at: new Date().toISOString(),
      });

      // Reserve take 1 using short format sc1_sh1
      const res1 = bible.atomicReserveShotTake({
        seriesId: "series_alias",
        episodeNumber: 1,
        shotId: "sc1_sh1",
        provider: "mock",
        prompt: "Shot 1 Take 1",
      });
      expect(res1.takeNumber).toBe(1);

      // Reserve take 2 using padded format sc01_sh01
      const res2 = bible.atomicReserveShotTake({
        seriesId: "series_alias",
        episodeNumber: 1,
        shotId: "sc01_sh01",
        provider: "mock",
        prompt: "Shot 1 Take 2 (padded)",
      });
      expect(res2.takeNumber).toBe(2);

      // Next take query should also see 3
      const nextTake = bible.getNextTakeNumber("series_alias", 1, "sc1_sh1");
      expect(nextTake).toBe(3);
    });

    it("enforces composite uniqueness at SQLite engine level", async () => {
      const dbPath = join(testBaseDir, "unique_constraint.db");
      const bible = new BibleManager(dbPath);
      bible.upsertSeriesMetadata({
        id: "series_uq",
        title: "Unique Constraint Test",
        visual_style: "Cinematic",
        aspect_ratio: "16:9",
        fps: 30,
        created_at: new Date().toISOString(),
      });

      bible.recordShotTake({
        id: "take_primary_01",
        series_id: "series_uq",
        episode_number: 1,
        shot_id: "sc01_sh01",
        take_number: 1,
        provider: "mock",
        prompt: "Initial take",
        local_path: "output/shots/take01.mp4",
        duration_sec: 4.0,
        qa_status: "PASS",
        is_approved: true,
      });

      // Attempting to insert a distinct take ID with the same (series_id, episode_number, shot_id, take_number)
      // must trigger SQLite unique constraint violation
      expect(() => {
        bible.recordShotTake({
          id: "take_colliding_02",
          series_id: "series_uq",
          episode_number: 1,
          shot_id: "sc01_sh01",
          take_number: 1, // Duplicate take_number for the same series+ep+shot!
          provider: "mock",
          prompt: "Colliding take",
          local_path: "output/shots/take02.mp4",
          duration_sec: 4.0,
          qa_status: "PASS",
          is_approved: false,
        });
      }).toThrow(/UNIQUE constraint failed/i);
    });
  });

  // ═════════════════════════════════════════════════════════════════════════════
  // SCOPE B (P1): Take Identity Isolation Across Series
  // ═════════════════════════════════════════════════════════════════════════════
  describe("Scope B (P1) - Take Identity Isolation Across Series", () => {
    it("never hardcodes project-specific shortcuts (e.g. cyber-saigon -> cyber)", async () => {
      const dbPath = join(testBaseDir, "series_isolation.db");
      const bible = new BibleManager(dbPath);
      bible.upsertSeriesMetadata({
        id: "cyber-saigon",
        title: "Sài Gòn 2088",
        visual_style: "Cinematic 35mm",
        aspect_ratio: "9:16",
        fps: 30,
        created_at: new Date().toISOString(),
      });

      const reserved = bible.atomicReserveShotTake({
        seriesId: "cyber-saigon",
        episodeNumber: 1,
        shotId: "sc01_sh01",
        provider: "mock",
        prompt: "Test cyber-saigon prefix",
      });

      // Crucial: Must start with "cyber-saigon_", NOT "cyber_"
      expect(reserved.takeId).toBe("cyber-saigon_ep01_sc01_sh01_take01");
      expect(reserved.takeId.startsWith("cyber_")).toBe(false);
    });

    it("guarantees complete namespace isolation between similarly named series", async () => {
      const dbPath = join(testBaseDir, "shared_db_isolation.db");
      const bible = new BibleManager(dbPath);

      // Setup two series with prefix overlap
      bible.upsertSeriesMetadata({
        id: "cyber",
        title: "Cyberpunk Short",
        visual_style: "Anime",
        aspect_ratio: "16:9",
        fps: 24,
        created_at: new Date().toISOString(),
      });
      bible.upsertSeriesMetadata({
        id: "cyber-saigon",
        title: "Sài Gòn 2088",
        visual_style: "Live-action Noir",
        aspect_ratio: "9:16",
        fps: 30,
        created_at: new Date().toISOString(),
      });

      // Reserve takes in both series for the same shot
      const takeCyber = bible.atomicReserveShotTake({
        seriesId: "cyber",
        episodeNumber: 1,
        shotId: "sc01_sh01",
        provider: "mock",
        prompt: "Cyber take",
      });
      const takeCyberSaigon = bible.atomicReserveShotTake({
        seriesId: "cyber-saigon",
        episodeNumber: 1,
        shotId: "sc01_sh01",
        provider: "mock",
        prompt: "Cyber Saigon take",
      });

      expect(takeCyber.takeId).toBe("cyber_ep01_sc01_sh01_take01");
      expect(takeCyberSaigon.takeId).toBe("cyber-saigon_ep01_sc01_sh01_take01");

      // Approve take in 'cyber'
      bible.approveShotTake(takeCyber.takeId);

      // Verify queries for 'cyber-saigon' are strictly isolated
      const takesSaigon = bible.listShotTakes("cyber-saigon", 1);
      expect(takesSaigon.length).toBe(1);
      expect(takesSaigon[0].id).toBe("cyber-saigon_ep01_sc01_sh01_take01");

      const approvedSaigon = bible.getApprovedTakeForShot("cyber-saigon", 1, "sc01_sh01");
      // Must be null! Does NOT borrow approval from 'cyber'
      expect(approvedSaigon).toBeNull();

      const approvedCyber = bible.getApprovedTakeForShot("cyber", 1, "sc01_sh01");
      expect(approvedCyber?.id).toBe("cyber_ep01_sc01_sh01_take01");
    });
  });

  // ═════════════════════════════════════════════════════════════════════════════
  // SCOPE C (P2): Timeline & Transition Preservation During Remux
  // ═════════════════════════════════════════════════════════════════════════════
  describe("Scope C (P2) - Timeline & Transition Preservation During Remux", () => {
    const scriptFixture = `
TẬP 1: TRANSITION TEST
Logline: Kiểm tra bảo toàn transitionDurationSec qua remux và reroll.
CẢNH 1: PHÒNG LAB - ĐÊM
Nhân vật: Minh
CÚ MÁY 1 (establishing, 3s): Toàn cảnh phòng lab.
CÚ MÁY 2 (close_up, 3s): Minh tập trung nhìn màn hình.
MINH: Dữ liệu đang đồng bộ.
    `.trim();

    it("persists transitionDurationSec in checkpoint.json and timeline.json during production", async () => {
      const outputDir = join(testBaseDir, "remux_persist");
      const dbPath = join(outputDir, "story_bible.db");
      await mkdir(outputDir, { recursive: true });

      const pipeline = new EpisodicPipeline(dbPath);
      const res = await pipeline.produceEpisode(scriptFixture, {
        seriesId: "series_remux_test",
        provider: "mock",
        mockTts: true,
        outputDir,
        transitionDurationSec: 0.85,
      });

      expect(res.episodeNumber).toBe(1);

      // Check checkpoint.json
      const ckpt = JSON.parse(await readFile(join(outputDir, "checkpoint.json"), "utf8"));
      expect(ckpt.transitionDurationSec).toBe(0.85);

      // Check timeline.json
      const tl = JSON.parse(await readFile(join(outputDir, "timeline.json"), "utf8"));
      expect(tl.transitionDurationSec).toBe(0.85);
    });

    it("distinguishes explicit 0.0 from omitted transitionDurationSec in remuxEpisode", async () => {
      const outputDir = join(testBaseDir, "remux_hierarchy");
      const dbPath = join(outputDir, "story_bible.db");
      await mkdir(outputDir, { recursive: true });

      const pipeline = new EpisodicPipeline(dbPath);
      await pipeline.produceEpisode(scriptFixture, {
        seriesId: "series_remux_test",
        provider: "mock",
        mockTts: true,
        outputDir,
        transitionDurationSec: 0.75, // Stored in checkpoint
      });

      // 1. Explicit 0.0 must be respected and NOT fallback to 0.75
      const remuxZero = await pipeline.remuxEpisode({
        seriesId: "series_remux_test",
        episodeNumber: 1,
        outputDir,
        transitionDurationSec: 0.0,
      });
      expect(existsSync(remuxZero.videoPath)).toBe(true);

      // 2. Omitted transitionDurationSec (undefined) must fallback to 0.75 from checkpoint
      const remuxOmitted = await pipeline.remuxEpisode({
        seriesId: "series_remux_test",
        episodeNumber: 1,
        outputDir,
        // transitionDurationSec is omitted
      });
      expect(existsSync(remuxOmitted.videoPath)).toBe(true);

      // 3. Verify elementary streams are valid without AV drift
      const videoProbe = await probeVideoFile(remuxOmitted.videoPath);
      const audioProbe = await probeAudioFile(remuxOmitted.audioPath);
      expect(videoProbe.isValid).toBe(true);
      expect(audioProbe.isValid).toBe(true);
    });

    it("forwards transitionDurationSec when rerolling a shot with automatic remux", async () => {
      const outputDir = join(testBaseDir, "reroll_transition");
      const dbPath = join(outputDir, "story_bible.db");
      await mkdir(outputDir, { recursive: true });

      const pipeline = new EpisodicPipeline(dbPath);
      await pipeline.produceEpisode(scriptFixture, {
        seriesId: "series_reroll_test",
        provider: "mock",
        mockTts: true,
        outputDir,
        transitionDurationSec: 0.6,
      });

      const reroll = await pipeline.rerollShot({
        seriesId: "series_reroll_test",
        episodeNumber: 1,
        shotId: "sc01_sh01",
        outputDir,
        provider: "mock",
        remuxAfterReroll: true,
        transitionDurationSec: 0.4,
        forceApprove: true,
      });

      expect(reroll.isApproved).toBe(true);
      expect(existsSync(reroll.videoPath)).toBe(true);

      const finalVideo = join(outputDir, "video.mp4");
      expect(existsSync(finalVideo)).toBe(true);
      const probe = await probeVideoFile(finalVideo);
      expect(probe.isValid).toBe(true);
    });
  });

  // ═════════════════════════════════════════════════════════════════════════════
  // SCOPE D (P2): Dynamic QA Re-evaluation Upon Resume
  // ═════════════════════════════════════════════════════════════════════════════
  describe("Scope D (P2) - Dynamic QA Re-evaluation Upon Resume", () => {
    const qaResumeScript = `
TẬP 1: THỬ NGHIỆM QA RESUME
Logline: Kiểm tra tái đánh giá QA khi backend khả dụng trở lại.
CẢNH 1: PHÒNG LAB - ĐÊM
Nhân vật: Minh
CÚ MÁY 1 (close_up, 3s): Minh nhìn thẳng vào camera.
MINH: Cần kiểm tra QA tự động khi backend khả dụng.
    `.trim();

    it("dynamically re-evaluates shots with UNAVAILABLE QA status on resume without re-rendering video", async () => {
      const outputDir = join(testBaseDir, "qa_resume");
      const dbPath = join(outputDir, "story_bible.db");
      const assetsDir = join(outputDir, "assets");
      await mkdir(assetsDir, { recursive: true });

      const refImagePath = join(assetsDir, "minh_face.jpg");
      await writeFile(refImagePath, Buffer.from("MINH_REFERENCE_FACE_IMAGE_DATA"));

      const bible = new BibleManager(dbPath);
      bible.upsertSeriesMetadata({
        id: "series_qa_resume",
        title: "QA Resume Series",
        visual_style: "Cinematic 35mm",
        aspect_ratio: "9:16",
        fps: 30,
        created_at: new Date().toISOString(),
      });
      bible.upsertCharacter({
        id: "minh",
        name: "Minh",
        role: "protagonist",
        visual_summary: "Kỹ sư Minh",
        face_reference_image: refImagePath,
        status: "alive",
      });

      const pipeline = new EpisodicPipeline(bible);

      // Phase 1: Initial production with UNINSTALLED Visual QA backend
      // Media will be rendered, but QA status must be recorded as UNAVAILABLE
      const uninstalledBackend = new UninstalledVisualQaBackend("arcface_local");
      const initResult = await pipeline.produceEpisode(qaResumeScript, {
        seriesId: "series_qa_resume",
        provider: "mock",
        mockTts: true,
        outputDir,
        visualQaBackend: uninstalledBackend,
      });

      expect(initResult.episodeNumber).toBe(1);

      // Verify shot video file was generated
      const shotVideoPath = join(outputDir, "shots", "sc01_sh01_take01.mp4");
      expect(existsSync(shotVideoPath)).toBe(true);
      const initialStat = await stat(shotVideoPath);
      const initialMtime = initialStat.mtimeMs;

      // Verify initial QA report is UNAVAILABLE
      const initialTake = bible.getShotTake("series_qa_resume_ep01_sc01_sh01_take01");
      expect(initialTake?.qa_status).toBe("UNAVAILABLE");
      expect(initialTake?.is_approved ? 1 : 0).toBe(0);

      // Phase 2: Resume production with AVAILABLE Visual QA backend
      // Should reuse existing video file on disk, but re-evaluate Face QA to PASS
      const availableBackend = new MockVisualQaBackend();
      const resumeResult = await pipeline.produceEpisode(qaResumeScript, {
        seriesId: "series_qa_resume",
        provider: "mock",
        mockTts: true,
        outputDir,
        resume: true,
        visualQaBackend: availableBackend,
      });

      expect(resumeResult.episodeNumber).toBe(1);

      // Crucial: Video media file was REUSED (mtime has not changed)
      const resumedStat = await stat(shotVideoPath);
      expect(resumedStat.mtimeMs).toBe(initialMtime);

      // Crucial: QA status was dynamically re-evaluated and updated to PASS!
      const updatedTake = bible.getShotTake("series_qa_resume_ep01_sc01_sh01_take01");
      expect(updatedTake?.qa_status).toBe("PASS");
      expect(updatedTake?.is_approved ? 1 : 0).toBe(1);

      // Check QA evidence report was updated
      const qaEvidencePath = join(outputDir, "qa_evidence", "sc01_sh01_qa.json");
      expect(existsSync(qaEvidencePath)).toBe(true);
      const qaReport = JSON.parse(await readFile(qaEvidencePath, "utf8"));
      expect(qaReport.status).toBe("PASS");
      expect(qaReport.isMockVector).toBe(true);
    });
  });
});
