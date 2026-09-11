import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { EpisodicPipeline } from "./episodic-pipeline.js";
import { BibleManager } from "../bible/bible-manager.js";
import { normalizeScript } from "./script-normalizer.js";
import { buildMasterTimeline } from "./audio-assembler.js";
import { EpisodicScriptSchema } from "./series-schema.js";
import { startSeriesReviewServer } from "../review/server.js";
import { existsSync, readFileSync } from "node:fs";
import { readFile, rm, mkdir } from "node:fs/promises";
import { join } from "node:path";
import axios from "axios";

describe("Phase 4 Verification: 2-3 Minute Pilot Film Production & Review Dashboard", () => {
  const testOutputDir = join("output", "test-phase4-pilot");
  const pilotScriptPath = join("scripts", "example-series", "cyber-saigon-pilot-2min.txt");

  beforeEach(async () => {
    BibleManager.closeAll();
    if (existsSync(testOutputDir)) {
      try {
        await rm(testOutputDir, { recursive: true, force: true });
      } catch {}
    }
    await mkdir(testOutputDir, { recursive: true });
  });

  afterEach(async () => {
    BibleManager.closeAll();
    if (existsSync(testOutputDir)) {
      try {
        await rm(testOutputDir, { recursive: true, force: true });
      } catch {}
    }
  });

  describe("1. Pilot Film 2-3 Minute Script Validation", () => {
    it("parses and validates the 32-shot 144-second (2m 24s) pilot script", async () => {
      const bible = new BibleManager(":memory:");
      bible.upsertSeriesMetadata({
        id: "cyber-saigon",
        title: "Sài Gòn 2088",
        genre: "Cyberpunk Noir",
        visual_style: "Cinematic 35mm, high contrast neon lighting",
        aspect_ratio: "9:16",
        fps: 30,
        created_at: new Date().toISOString(),
      });

      bible.upsertCharacter({
        id: "minh",
        name: "Minh",
        role: "protagonist",
        visual_summary: "Kỹ sư công nghệ",
        face_reference_image: "assets/characters/minh.jpg",
        status: "alive",
      });
      bible.upsertCharacter({
        id: "an",
        name: "An",
        role: "protagonist",
        visual_summary: "Hacker",
        face_reference_image: "assets/characters/an.jpg",
        status: "alive",
      });
      bible.upsertCharacter({
        id: "linh",
        name: "Linh",
        role: "supporting",
        visual_summary: "Nữ điệp viên",
        face_reference_image: "assets/characters/linh.jpg",
        status: "alive",
      });

      const rawScriptText = await readFile(pilotScriptPath, "utf8");
      const normalized = normalizeScript(rawScriptText, bible, { seriesId: "cyber-saigon" });

      // 1. Validate Schema
      const validated = EpisodicScriptSchema.parse(normalized);
      expect(validated.seriesId).toBe("cyber-saigon");
      expect(validated.episodeNumber).toBe(1);

      // 2. Validate 4 scenes and exactly 32 shots
      expect(validated.scenes.length).toBe(4);
      const totalShots = validated.scenes.reduce((acc, s) => acc + s.shots.length, 0);
      expect(totalShots).toBe(32);

      // 3. Validate total duration: exactly 144 seconds (2m 24s)
      const totalDuration = validated.scenes.reduce(
        (acc, s) => acc + s.shots.reduce((shAcc, sh) => shAcc + sh.durationSec, 0),
        0
      );
      expect(totalDuration).toBe(144);
      expect(totalDuration).toBeGreaterThanOrEqual(120); // >= 2 min
      expect(totalDuration).toBeLessThanOrEqual(180);    // <= 3 min
    });
  });

  describe("2. Master Timeline Zero-Drift Synchronization on 2-3 Minute Film", () => {
    it("guarantees sample-accurate alignment between video track and dialogue track across 144s", async () => {
      const bible = new BibleManager(":memory:");
      const rawScriptText = await readFile(pilotScriptPath, "utf8");
      const script = await normalizeScript(rawScriptText, bible, { seriesId: "cyber-saigon" });

      const timeline = buildMasterTimeline(script);

      expect(timeline.totalDurationSec).toBe(144);
      expect(timeline.videoTrack.length).toBe(32);

      // Check that every shot in videoTrack is contiguous with zero gaps
      for (let i = 0; i < timeline.videoTrack.length; i++) {
        const item = timeline.videoTrack[i];
        if (i === 0) {
          expect(item.startSec).toBe(0);
        } else {
          const prev = timeline.videoTrack[i - 1];
          expect(Math.abs(item.startSec - prev.endSec)).toBeLessThan(0.001);
        }
        expect(Math.abs(item.endSec - (item.startSec + item.durationSec))).toBeLessThan(0.001);
      }

      // Check that every dialogue cue aligns exactly with its shot's startSec
      for (const cue of timeline.dialogueTrack) {
        const matchingVideoShot = timeline.videoTrack.find((v) => v.shotId === cue.shotId);
        expect(matchingVideoShot).toBeDefined();
        expect(cue.startSec).toBe(matchingVideoShot!.startSec);
      }

      // Last shot ends exactly at 144 seconds
      const lastShot = timeline.videoTrack[timeline.videoTrack.length - 1];
      expect(lastShot.endSec).toBe(144);
    });
  });

  describe("3. End-to-End Production & Story Bible Canon Delta Commit", () => {
    it("produces the 2-3 minute film, records all 32 shots in SQLite, and commits Canon Delta", async () => {
      const pipeline = new EpisodicPipeline(":memory:");
      const bible = pipeline.getBible();

      bible.upsertSeriesMetadata({
        id: "cyber-saigon",
        title: "Sài Gòn 2088",
        genre: "Cyberpunk Noir",
        visual_style: "Cinematic 35mm, high contrast neon lighting",
        aspect_ratio: "9:16",
        fps: 30,
        created_at: new Date().toISOString(),
      });

      bible.upsertCharacter({
        id: "minh",
        name: "Minh",
        role: "protagonist",
        visual_summary: "Kỹ sư phản kháng",
        face_reference_image: "assets/characters/minh.jpg",
        status: "alive",
      });
      bible.upsertCharacter({
        id: "an",
        name: "An",
        role: "protagonist",
        visual_summary: "Hacker lượng tử",
        face_reference_image: "assets/characters/an.jpg",
        status: "alive",
      });
      bible.upsertCharacter({
        id: "linh",
        name: "Linh",
        role: "supporting",
        visual_summary: "Nữ điệp viên",
        face_reference_image: "assets/characters/linh.jpg",
        status: "alive",
      });
      bible.upsertKeyProp({
        id: "chip_luong_tu",
        name: "Chip Lượng Tử",
        visual_summary: "Con chip chứa dữ liệu giải phóng thế giới ngầm",
        current_holder_id: "minh",
        status: "intact",
      });

      const rawScriptText = await readFile(pilotScriptPath, "utf8");

      const deltaChanges = {
        prop_transfers: [
          {
            prop_id: "chip_luong_tu",
            new_holder_id: "an",
            status: "intact",
          },
        ],
        major_events: [
          "Minh và An giải mã thành công chip lượng tử tại tháp Skyline",
          "Dữ liệu mật của tập đoàn đã bị phát tán ra toàn bộ thành phố",
        ],
        world_state_updates: {
          "corporation_alert_level": "RED",
          "skyline_tower_breached": true,
        },
      };

      const result = await pipeline.produceEpisode(rawScriptText, {
        seriesId: "cyber-saigon",
        outputDir: testOutputDir,
        provider: "mock",
        mockTts: true,
        commitCanon: true,
        _testOnlyAllowMockCommit: true,
        narrativeDelta: deltaChanges,
      });

      expect(result.episodeNumber).toBe(1);
      expect(result.script.scenes.length).toBe(4);
      expect(existsSync(result.videoPath)).toBe(true);
      expect(existsSync(result.audioPath)).toBe(true);

      // Verify checkpoint was recorded and completed
      const checkpointPath = join(testOutputDir, "checkpoint.json");
      expect(existsSync(checkpointPath)).toBe(true);
      const job = JSON.parse(readFileSync(checkpointPath, "utf8"));
      expect(job.status).toBe("completed");
      expect(Object.keys(job.shots).length).toBe(32);

      // Verify all 32 shot takes were recorded into SQLite Story Bible
      const allTakes = bible.listShotTakes("cyber-saigon", 1);
      expect(allTakes.length).toBe(32);
      expect(allTakes.every((t) => t.is_approved)).toBe(true);

      // Verify Story Bible Canon Delta updates took effect
      const updatedProp = bible.getKeyProp("chip_luong_tu");
      expect(updatedProp?.current_holder_id).toBe("an"); // Chip transferred from Minh to An!

      const worldState = bible.getAllWorldState();
      expect(worldState["corporation_alert_level"]).toBe("RED");
      expect(worldState["skyline_tower_breached"]).toBe(true);

      // Verify Canon History has episode 1 recorded
      const history = bible.getCanonHistory();
      expect(history.length).toBe(1);
      expect(history[0].episode_number).toBe(1);
      expect(history[0].major_events.length).toBe(2);
    }, 120000);
  });

  describe("4. Series Review Server & Take Approval Verification", () => {
    it("hosts the review dashboard, lists takes, and allows approving takes via API", async () => {
      const bible = new BibleManager(":memory:");
      const rawScriptText = await readFile(pilotScriptPath, "utf8");
      const script = normalizeScript(rawScriptText, bible, { seriesId: "cyber-saigon" });

      // Record 2 takes for shot 1
      bible.recordShotTake({
        id: "cyber_ep01_sc1_sh1_take01",
        series_id: "cyber-saigon",
        episode_number: 1,
        shot_id: "sc1_sh1",
        take_number: 1,
        provider: "mock",
        prompt: "Khung cảnh Hẻm 9",
        local_path: "output/shots/sc1_sh1_take01.mp4",
        duration_sec: 5.0,
        qa_status: "WARN",
        is_approved: true,
      });

      bible.recordShotTake({
        id: "cyber_ep01_sc1_sh1_take02",
        series_id: "cyber-saigon",
        episode_number: 1,
        shot_id: "sc1_sh1",
        take_number: 2,
        provider: "mock",
        prompt: "Khung cảnh Hẻm 9 ánh neon rực rỡ",
        local_path: "output/shots/sc1_sh1_take02.mp4",
        duration_sec: 5.0,
        qa_status: "PASS",
        is_approved: false,
      });

      const serverPromise = startSeriesReviewServer({
        script,
        bible,
        seriesId: "cyber-saigon",
        episodeNumber: 1,
        port: 3999,
        autoOpen: false,
      });

      const serverUrl = await serverPromise.ready;
      expect(serverUrl).toContain("http://127.0.0.1:3999");

      // 1. GET / (HTML Dashboard)
      const htmlRes = await axios.get(serverUrl);
      expect(htmlRes.status).toBe(200);
      expect(htmlRes.data).toContain("Episodic AI Film Series: TẬP 1: BẢN HỢP ĐỒNG BÓNG ĐÊM (PILOT 2-3 PHÚT)");
      expect(htmlRes.data).toContain("CẢNH 1: QUÁN BAR HẺM 9");
      expect(htmlRes.data).toContain("CẢNH 4: CẦU MỐNG CỔ");

      // 2. GET /api/series/takes
      const takesRes = await axios.get(`${serverUrl}/api/series/takes`);
      expect(takesRes.status).toBe(200);
      expect(Array.isArray(takesRes.data.takes)).toBe(true);
      expect(takesRes.data.takes.length).toBe(2);

      // 3. POST /api/series/approve-take
      const approveRes = await axios.post(`${serverUrl}/api/series/approve-take`, {
        takeId: "cyber_ep01_sc1_sh1_take02",
      });
      expect(approveRes.status).toBe(200);
      expect(approveRes.data.success).toBe(true);
      expect(approveRes.data.approvedTakeId).toBe("cyber_ep01_sc1_sh1_take02");

      // Verify in bible that take 2 is now approved and take 1 is unapproved
      const take1 = bible.getShotTake("cyber_ep01_sc1_sh1_take01");
      const take2 = bible.getShotTake("cyber_ep01_sc1_sh1_take02");
      expect(Boolean(take1?.is_approved)).toBe(false);
      expect(Boolean(take2?.is_approved)).toBe(true);

      // 4. Finalize and close server
      await serverPromise.close();
    });
  });

  describe("5. Checkpoint Resume, Single-Shot Reroll & Remux on 2-3 Minute Film", () => {
    it("supports rerolling an individual shot and remuxing the 2-3 minute film without regenerating other shots", async () => {
      const pipeline = new EpisodicPipeline(":memory:");
      const bible = pipeline.getBible();

      bible.upsertSeriesMetadata({
        id: "cyber-saigon",
        title: "Sài Gòn 2088",
        genre: "Cyberpunk Noir",
        visual_style: "Cinematic 35mm, high contrast neon lighting",
        aspect_ratio: "9:16",
        fps: 30,
        created_at: new Date().toISOString(),
      });

      const rawScriptText = await readFile(pilotScriptPath, "utf8");

      // Initial production run
      const initialResult = await pipeline.produceEpisode(rawScriptText, {
        seriesId: "cyber-saigon",
        outputDir: testOutputDir,
        provider: "mock",
        mockTts: true,
      });
      expect(initialResult.episodeNumber).toBe(1);

      const takesBeforeReroll = bible.listShotTakes("cyber-saigon", 1);
      expect(takesBeforeReroll.length).toBe(32);

      // Reroll single shot sc1_sh1
      const rerollResult = await pipeline.rerollShot({
        seriesId: "cyber-saigon",
        episodeNumber: 1,
        shotId: "sc1_sh1",
        outputDir: testOutputDir,
        provider: "mock",
        promptOverride: "Khung cảnh Hẻm 9 Sài Gòn 2088 góc nhìn mới lạ",
        remuxAfterReroll: false,
        forceApprove: true,
      });

      expect(rerollResult.shotId).toBe("sc1_sh1");
      expect(rerollResult.takeId).toBe("cyber_ep01_sc1_sh1_take02");
      expect(existsSync(rerollResult.videoPath)).toBe(true);

      // Verify shot takes count is now 33 (31 original + 2 takes for shot 1)
      const takesAfterReroll = bible.listShotTakes("cyber-saigon", 1);
      expect(takesAfterReroll.length).toBe(33);

      const shot1Takes = takesAfterReroll.filter((t) => t.shot_id === "sc1_sh1");
      expect(shot1Takes.length).toBe(2);
      // New take should be approved, old take should be unapproved
      const take1 = shot1Takes.find((t) => t.take_number === 1);
      const take2 = shot1Takes.find((t) => t.take_number === 2);
      expect(Boolean(take1?.is_approved)).toBe(false);
      expect(Boolean(take2?.is_approved)).toBe(true);

      // Test remuxing the full 144s pilot film using the approved takes
      const remuxResult = await pipeline.remuxEpisode({
        seriesId: "cyber-saigon",
        episodeNumber: 1,
        outputDir: testOutputDir,
      });

      expect(remuxResult.episodeNumber).toBe(1);
      expect(existsSync(remuxResult.videoPath)).toBe(true);
      expect(existsSync(remuxResult.audioPath)).toBe(true);

      // Verify checkpoint has the new take recorded
      const checkpointPath = join(testOutputDir, "checkpoint.json");
      const job = JSON.parse(readFileSync(checkpointPath, "utf8"));
      expect(job.shots["sc1_sh1"].activeTakeId).toBe("cyber_ep01_sc1_sh1_take02");
    }, 120000);
  });
});
