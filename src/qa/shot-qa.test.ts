import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { join } from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { existsSync } from "node:fs";
import {
  FaceQaEvaluator,
  UninstalledVisualQaBackend,
  MockVisualQaBackend,
  STYLE_CALIBRATION_PROFILES,
  FrameEvaluationSample,
  ExtractedFace,
} from "./face-evaluator.js";
import { StoryBibleManager } from "../bible/bible-manager.js";

describe("Shot Visual Reference Management & Quality Assurance Engine (Yêu cầu 1-11)", () => {
  let testDir: string;
  let dbPath: string;

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), "shot-qa-test-"));
    dbPath = join(testDir, "test_story_bible.db");
  });

  afterEach(async () => {
    if (existsSync(testDir)) {
      await rm(testDir, { recursive: true, force: true });
    }
  });

  // ==========================================================================
  // YÊU CẦU 1: Quản lý bộ ảnh tham chiếu có phiên bản
  // ==========================================================================
  describe("Yêu cầu 1: Versioned Reference Assets Management", () => {
    it("persists multi-angle faces, full body, wardrobe, location, and prop reference assets with versioning", () => {
      const bible = new StoryBibleManager(dbPath);

      // Multi-angle faces for character
      bible.addReferenceAsset({
        id: "ref_hero_face_front_v1",
        series_id: "series_cyber",
        entity_type: "character",
        entity_id: "char_hero",
        asset_kind: "face_front",
        image_path: "assets/hero/face_front_v1.png",
        version: 1,
        is_active: true,
        description: "Hero direct frontal face portrait under neutral studio lighting",
      });

      bible.addReferenceAsset({
        id: "ref_hero_face_three_quarter_v1",
        series_id: "series_cyber",
        entity_type: "character",
        entity_id: "char_hero",
        asset_kind: "face_three_quarter",
        image_path: "assets/hero/face_3q_v1.png",
        version: 1,
        is_active: true,
        description: "Hero 45-degree angle profile",
      });

      bible.addReferenceAsset({
        id: "ref_hero_face_profile_v1",
        series_id: "series_cyber",
        entity_type: "character",
        entity_id: "char_hero",
        asset_kind: "face_profile",
        image_path: "assets/hero/face_profile_v1.png",
        version: 1,
        is_active: true,
        description: "Hero 90-degree lateral profile",
      });

      // Full-body turnaround
      bible.addReferenceAsset({
        id: "ref_hero_turnaround_v1",
        series_id: "series_cyber",
        entity_type: "character",
        entity_id: "char_hero",
        asset_kind: "turnaround",
        image_path: "assets/hero/turnaround_v1.png",
        version: 1,
        is_active: true,
        description: "Full body 8-point turnaround sheet",
      });

      // Wardrobe, location, prop
      bible.addReferenceAsset({
        id: "ref_hero_wardrobe_combat_v1",
        series_id: "series_cyber",
        entity_type: "wardrobe",
        entity_id: "wardrobe_combat",
        asset_kind: "full_body",
        image_path: "assets/wardrobe/combat_v1.png",
        version: 1,
        is_active: true,
      });

      bible.addReferenceAsset({
        id: "ref_loc_neon_alley_v1",
        series_id: "series_cyber",
        entity_type: "location",
        entity_id: "loc_neon_alley",
        asset_kind: "environment",
        image_path: "assets/locations/neon_alley_v1.png",
        version: 1,
        is_active: true,
      });

      bible.addReferenceAsset({
        id: "ref_prop_cipher_chip_v1",
        series_id: "series_cyber",
        entity_type: "prop",
        entity_id: "prop_cipher_chip",
        asset_kind: "prop_detail",
        image_path: "assets/props/cipher_chip_v1.png",
        version: 1,
        is_active: true,
      });

      // Query active references
      const heroAssets = bible.listReferenceAssets("series_cyber", "character", "char_hero");
      expect(heroAssets.length).toBe(4);
      expect(heroAssets.map((a) => a.asset_kind)).toContain("face_front");
      expect(heroAssets.map((a) => a.asset_kind)).toContain("face_three_quarter");
      expect(heroAssets.map((a) => a.asset_kind)).toContain("face_profile");
      expect(heroAssets.map((a) => a.asset_kind)).toContain("turnaround");

      // Deprecate v1 and add v2
      bible.deprecateReferenceAsset("ref_hero_face_front_v1");
      bible.addReferenceAsset({
        id: "ref_hero_face_front_v2",
        series_id: "series_cyber",
        entity_type: "character",
        entity_id: "char_hero",
        asset_kind: "face_front",
        image_path: "assets/hero/face_front_v2_hires.png",
        version: 2,
        is_active: true,
        description: "Updated 4K frontal portrait with refined lighting",
      });

      const updatedHeroAssets = bible.listReferenceAssets("series_cyber", "character", "char_hero", true);
      expect(updatedHeroAssets.length).toBe(4);
      const activeFront = updatedHeroAssets.find((a) => a.asset_kind === "face_front");
      expect(activeFront?.version).toBe(2);
      expect(activeFront?.image_path).toBe("assets/hero/face_front_v2_hires.png");

      bible.close();
    });
  });

  // ==========================================================================
  // YÊU CẦU 2 & 3: Tách nhận diện khỏi storyboard; Cho phép duyệt storyboard & lưu bản tham chiếu
  // ==========================================================================
  describe("Yêu cầu 2 & 3: Identity Decoupling & Storyboard Approval with Reference Tracking", () => {
    it("decouples character biometric identity from composition layout and records bound references", () => {
      const bible = new StoryBibleManager(dbPath);

      // Record storyboard keyframe specifying camera staging and composition layout
      bible.recordStoryboardKeyframe({
        id: "sb_cyber_ep01_sc01_sh01_v1",
        series_id: "series_cyber",
        episode_number: 1,
        shot_id: "sc01_sh01",
        version: 1,
        composition_layout: "Subject positioned on left third power point, wide angle Dutch tilt",
        camera_framing: "medium",
        image_path: "storyboards/ep01_sc01_sh01_layout.png",
        is_approved: false,
        used_references_json: JSON.stringify([
          "ref_hero_face_front_v2",
          "ref_hero_wardrobe_combat_v1",
          "ref_loc_neon_alley_v1",
        ]),
      });

      // Verify keyframe exists but not yet approved
      const pendingSb = bible.getStoryboardKeyframe("sb_cyber_ep01_sc01_sh01_v1");
      expect(pendingSb).toBeDefined();
      expect(pendingSb?.is_approved).toBe(false);

      const beforeApproval = bible.getApprovedStoryboardForShot("series_cyber", 1, "sc01_sh01");
      expect(beforeApproval).toBeNull();

      // Director approves storyboard prior to video rendering
      bible.approveStoryboardKeyframe("sb_cyber_ep01_sc01_sh01_v1");

      const approvedSb = bible.getApprovedStoryboardForShot("series_cyber", 1, "sc01_sh01");
      expect(approvedSb).toBeDefined();
      expect(approvedSb?.id).toBe("sb_cyber_ep01_sc01_sh01_v1");
      expect(approvedSb?.is_approved).toBe(true);

      // Verify bound reference assets are tracked precisely
      const usedRefs = JSON.parse(approvedSb!.used_references_json);
      expect(usedRefs).toEqual([
        "ref_hero_face_front_v2",
        "ref_hero_wardrobe_combat_v1",
        "ref_loc_neon_alley_v1",
      ]);

      bible.close();
    });
  });

  // ==========================================================================
  // YÊU CẦU 4 & 5: Backend vắng mặt trả NOT_RUN/UNAVAILABLE, không PASS
  // ==========================================================================
  describe("Yêu cầu 4 & 5: Genuine QA Pipeline & Uninstalled Backend Safety", () => {
    it("returns NOT_RUN or UNAVAILABLE when backend is uninstalled, NEVER faking a PASS", async () => {
      const uninstalledBackend = new UninstalledVisualQaBackend("insightface / onnxruntime");
      const readiness = await uninstalledBackend.checkReadiness();

      expect(readiness.status).toBe("NOT_INSTALLED");
      expect(readiness.isAvailable).toBe(false);
      expect(readiness.notes).toContain("Chưa cài đặt dependencies");

      const evaluator = new FaceQaEvaluator({
        backend: uninstalledBackend,
        styleCategory: "photorealistic",
      });

      const sampleFrames: FrameEvaluationSample[] = [
        {
          frameIndex: 0,
          timestampSec: 0.0,
          detectedFaces: [],
        },
      ];

      const result = await evaluator.evaluateMultiFrame(
        "sh_hero_01",
        "char_hero",
        sampleFrames,
        [1, 0, 0]
      );

      expect(result.status).toBe("UNAVAILABLE");
      expect(result.backendAvailability).toBe("NOT_INSTALLED");
      expect(result.notes).toContain("UNAVAILABLE");
      expect(result.notes).not.toContain("100% nhất quán");
      expect(result.reviewEscalation?.required).toBe(true);
      expect(result.reviewEscalation?.reason).toBe("BACKEND_UNAVAILABLE");
    });
  });

  // ==========================================================================
  // YÊU CẦU 6: Anti-Cherry-Picking Multi-Frame Evaluation
  // ==========================================================================
  describe("Yêu cầu 6: Anti-Cherry-Picking Multi-Frame Evaluation", () => {
    it("FAILS a shot where a single frame has peak similarity but remaining frames collapse", async () => {
      const backend = new MockVisualQaBackend();
      const evaluator = new FaceQaEvaluator({
        backend,
        styleCategory: "photorealistic", // tPass: 0.72, tWarn: 0.60, tMinPass: 0.52, minStability: 0.75
      });

      const refEmbedding = [1, 0, 0];

      // Simulated 5 frames: Frame 1 is a cherry-picked peak (0.95), frames 2-5 collapse (0.35, 0.40, 0.32, 0.38)
      const testFrames: FrameEvaluationSample[] = [
        {
          frameIndex: 0,
          timestampSec: 0.0,
          detectedFaces: [{ box: [100, 100, 200, 200], confidence: 0.98, embedding: [0.95, 0.312, 0] }],
        },
        {
          frameIndex: 1,
          timestampSec: 0.5,
          detectedFaces: [{ box: [100, 100, 200, 200], confidence: 0.95, embedding: [0.35, 0.936, 0] }],
        },
        {
          frameIndex: 2,
          timestampSec: 1.0,
          detectedFaces: [{ box: [100, 100, 200, 200], confidence: 0.96, embedding: [0.40, 0.916, 0] }],
        },
        {
          frameIndex: 3,
          timestampSec: 1.5,
          detectedFaces: [{ box: [100, 100, 200, 200], confidence: 0.92, embedding: [0.32, 0.947, 0] }],
        },
        {
          frameIndex: 4,
          timestampSec: 2.0,
          detectedFaces: [{ box: [100, 100, 200, 200], confidence: 0.94, embedding: [0.38, 0.924, 0] }],
        },
      ];

      const report = await evaluator.evaluateMultiFrame(
        "shot_cherry_pick_test",
        "char_hero",
        testFrames,
        refEmbedding
      );

      // Peak frame is high (0.95), but minimum similarity collapses to ~0.32
      expect(report.maxSimilarity).toBeGreaterThan(0.90);
      expect(report.minSimilarity).toBeLessThan(0.40);
      expect(report.coverageRatio).toBe(1.0);

      // Must NOT automatically PASS based on peak frame
      expect(report.status).not.toBe("PASS");
      expect(report.status).toBe("FAIL");
      expect(report.stabilityScore).toBeLessThan(0.75); // high variance
      expect(report.suspiciousIntervals?.length).toBeGreaterThan(0);
      expect(report.notes).toContain("Anti-Cherry-Picking Rule");
    });

    it("PASSES a shot with consistent similarity and high temporal stability across all frames", async () => {
      const backend = new MockVisualQaBackend();
      const evaluator = new FaceQaEvaluator({
        backend,
        styleCategory: "photorealistic",
      });

      const refEmbedding = [1, 0, 0];

      // Consistent frames across shot (similarities ~0.85 to ~0.89)
      const testFrames: FrameEvaluationSample[] = [
        {
          frameIndex: 0,
          timestampSec: 0.0,
          detectedFaces: [{ box: [100, 100, 200, 200], confidence: 0.99, embedding: [0.88, 0.474, 0] }],
        },
        {
          frameIndex: 1,
          timestampSec: 0.5,
          detectedFaces: [{ box: [100, 100, 200, 200], confidence: 0.98, embedding: [0.85, 0.526, 0] }],
        },
        {
          frameIndex: 2,
          timestampSec: 1.0,
          detectedFaces: [{ box: [100, 100, 200, 200], confidence: 0.97, embedding: [0.89, 0.455, 0] }],
        },
        {
          frameIndex: 3,
          timestampSec: 1.5,
          detectedFaces: [{ box: [100, 100, 200, 200], confidence: 0.99, embedding: [0.86, 0.510, 0] }],
        },
      ];

      const report = await evaluator.evaluateMultiFrame(
        "shot_consistent_hero",
        "char_hero",
        testFrames,
        refEmbedding
      );

      expect(report.status).toBe("PASS");
      expect(report.minSimilarity).toBeGreaterThanOrEqual(0.52);
      expect(report.meanSimilarity).toBeGreaterThanOrEqual(0.72);
      expect(report.stabilityScore).toBeGreaterThanOrEqual(0.75);
      expect(report.suspiciousIntervals?.length).toBe(0);
      expect(report.shouldReRoll).toBe(false);
    });
  });

  // ==========================================================================
  // YÊU CẦU 7: Ngưỡng có nguồn hiệu chỉnh & phân biệt phong cách
  // ==========================================================================
  describe("Yêu cầu 7: Style-Calibrated Profiles & Empirical Sources", () => {
    it("provides distinct calibrated profiles and explicit disclaimers for photorealistic vs stylized art", () => {
      const photo = STYLE_CALIBRATION_PROFILES.photorealistic;
      const anime = STYLE_CALIBRATION_PROFILES.stylized_anime;
      const render3d = STYLE_CALIBRATION_PROFILES.stylized_3d_render;

      // Profiles differ in thresholds based on representation domain
      expect(photo.tPass).toBeGreaterThan(anime.tPass);
      expect(photo.tWarn).toBeGreaterThan(anime.tWarn);
      expect(photo.tMinPass).toBeGreaterThan(anime.tMinPass);

      // Every profile provides calibration source and explicit disclaimer
      expect(photo.calibrationSource).toContain("ArcFace");
      expect(photo.disclaimer).toContain("Không dùng chung ngưỡng này cho anime hoặc 3D render cách điệu");

      expect(anime.calibrationSource).toContain("Danbooru");
      expect(anime.disclaimer).toContain("Không áp dụng cho người thật");

      expect(render3d.calibrationSource).toContain("3D CGI");
      expect(render3d.disclaimer).toContain("Không dùng chung cho phim người đóng");
    });
  });

  // ==========================================================================
  // YÊU CẦU 8: Chuyển review khi không thấy mặt, mặt quá nhỏ hoặc ghép không chắc chắn
  // ==========================================================================
  describe("Yêu cầu 8: Review Escalation Routing", () => {
    it("routes to manual review with NO_FACE when no faces are detected in shot frames", async () => {
      const evaluator = new FaceQaEvaluator({ styleCategory: "photorealistic" });

      const report = await evaluator.evaluateMultiFrame(
        "shot_no_face_action",
        "char_hero",
        [],
        [1, 0, 0]
      );

      expect(report.status).toBe("WARN");
      expect(report.reviewEscalation?.required).toBe(true);
      expect(report.reviewEscalation?.reason).toBe("NO_FACE");
      expect(report.notes).toContain("No frames extracted from video clip");
    });

    it("routes to manual review with FACE_TOO_SMALL when face resolution is below threshold", async () => {
      const evaluator = new FaceQaEvaluator({ styleCategory: "photorealistic" });

      const tinyFrames: FrameEvaluationSample[] = [
        {
          frameIndex: 0,
          timestampSec: 0.0,
          detectedFaces: [
            {
              box: [50, 50, 32, 32],
              confidence: 0.85,
              embedding: [0.75, 0.661, 0],
              faceAreaRatio: 0.005, // 0.5% of frame area < 1.5% threshold
            },
          ],
        },
      ];

      const report = await evaluator.evaluateMultiFrame(
        "shot_tiny_face",
        "char_hero",
        tinyFrames,
        [1, 0, 0]
      );

      expect(report.reviewEscalation?.required).toBe(true);
      expect(report.reviewEscalation?.reason).toBe("FACE_TOO_SMALL");
      expect(report.notes).toContain("Face size is extremely small");
    });

    it("routes to manual review with AMBIGUOUS_MATCH when multiple characters match with close confidence", async () => {
      const evaluator = new FaceQaEvaluator({ styleCategory: "photorealistic" });

      // Two detected faces in the same frame with almost identical similarities (distance < 0.05)
      const ambiguousFrames: FrameEvaluationSample[] = [
        {
          frameIndex: 0,
          timestampSec: 0.0,
          detectedFaces: [
            { box: [50, 50, 100, 100], confidence: 0.9, embedding: [0.75, 0.661, 0] }, // sim = 0.75
            { box: [200, 50, 100, 100], confidence: 0.9, embedding: [0.73, 0.683, 0] }, // sim = 0.73 (diff = 0.02 < 0.05)
          ],
        },
      ];

      const report = await evaluator.evaluateMultiFrame(
        "shot_ambiguous_faces",
        "char_hero",
        ambiguousFrames,
        [1, 0, 0]
      );

      expect(report.reviewEscalation?.required).toBe(true);
      expect(report.reviewEscalation?.reason).toBe("AMBIGUOUS_MATCH");
      expect(report.notes).toContain("Multiple characters detected with ambiguous similarity");
    });
  });

  // ==========================================================================
  // YÊU CẦU 9: Bền vững quyết định Review, lưu frame minh chứng & Chọn take sau restart
  // ==========================================================================
  describe("Yêu cầu 9: Persistent Review Decisions, Evidence Frames & Take Selection Across Restarts", () => {
    it("preserves take review decisions, QA reports, and evidence frames across SQLite database restarts", () => {
      // 1. First session: Create takes, record QA reports, approve take 02, reject take 01
      let bible: StoryBibleManager | null = new StoryBibleManager(dbPath);

      bible.recordShotTake({
        id: "take_01",
        series_id: "series_cyber",
        episode_number: 1,
        shot_id: "sc01_sh01",
        take_number: 1,
        provider: "mock",
        prompt: "Shot 1 take 1 prompt",
        local_path: "shots/sh01_take01.mp4",
        duration_sec: 4.0,
        qa_status: "WARN",
        qa_score: 0.65,
        qa_notes: "Minor facial drift around frame 3",
        qa_report_json: JSON.stringify({
          status: "WARN",
          meanSimilarity: 0.65,
          minSimilarity: 0.54,
          maxSimilarity: 0.76,
          coverageRatio: 0.8,
          stabilityScore: 0.68,
          evidenceFrames: [
            { timestampSec: 0.0, similarity: 0.76, framePath: "qa_evidence/sh01_t01_f0.jpg" },
            { timestampSec: 1.5, similarity: 0.54, framePath: "qa_evidence/sh01_t01_f3.jpg" },
          ],
        }),
        is_approved: false,
        cost_usd: 0.05,
      });

      bible.recordShotTake({
        id: "take_02",
        series_id: "series_cyber",
        episode_number: 1,
        shot_id: "sc01_sh01",
        take_number: 2,
        provider: "mock",
        prompt: "Shot 1 take 2 prompt with better lighting",
        local_path: "shots/sh01_take02.mp4",
        duration_sec: 4.0,
        qa_status: "PASS",
        qa_score: 0.84,
        qa_notes: "High facial consistency across all evaluated frames",
        qa_report_json: JSON.stringify({
          status: "PASS",
          meanSimilarity: 0.84,
          minSimilarity: 0.81,
          maxSimilarity: 0.88,
          coverageRatio: 1.0,
          stabilityScore: 0.92,
          evidenceFrames: [
            { timestampSec: 0.0, similarity: 0.88, framePath: "qa_evidence/sh01_t02_f0.jpg" },
            { timestampSec: 2.0, similarity: 0.81, framePath: "qa_evidence/sh01_t02_f4.jpg" },
          ],
        }),
        is_approved: false,
        cost_usd: 0.05,
      });

      // Director rejects take 1 and approves take 2
      bible.rejectShotTake("take_01", "Facial identity unstable between 1s and 2s");
      bible.approveShotTake("take_02");

      // Verify immediate state
      const initialApproved = bible.getApprovedTakeForShot("series_cyber", 1, "sc01_sh01");
      expect(initialApproved?.id).toBe("take_02");

      // Close SQLite database cleanly (simulating process exit)
      bible.close();
      bible = null;

      // 2. Second session: Restart by opening a NEW Bible instance on the SAME SQLite file
      const restoredBible = new StoryBibleManager(dbPath);

      // Verify that approved take persists
      const persistentApproved = restoredBible.getApprovedTakeForShot("series_cyber", 1, "sc01_sh01");
      expect(persistentApproved).toBeDefined();
      expect(persistentApproved?.id).toBe("take_02");
      expect(persistentApproved?.is_approved).toBe(true);
      expect(persistentApproved?.qa_status).toBe("PASS");

      // Parse and verify preserved QA evidence report
      const restoredQaReport = JSON.parse(persistentApproved!.qa_report_json!);
      expect(restoredQaReport.stabilityScore).toBe(0.92);
      expect(restoredQaReport.evidenceFrames.length).toBe(2);
      expect(restoredQaReport.evidenceFrames[0].framePath).toBe("qa_evidence/sh01_t02_f0.jpg");

      // Verify take 1 rejection persisted
      const rejectedTake = restoredBible.getShotTake("take_01");
      expect(rejectedTake).toBeDefined();
      expect(rejectedTake?.is_approved).toBe(false);
      expect(rejectedTake?.qa_notes).toContain("[REJECTED] Facial identity unstable between 1s and 2s");

      restoredBible.close();
    });
  });

  // ==========================================================================
  // YÊU CẦU 10: Bounded Re-rolls, Ngân sách & Không ghi đè take đã duyệt
  // ==========================================================================
  describe("Yêu cầu 10: Bounded Re-rolls, Budget Cap & Immutability of Approved Takes", () => {
    it("does not overwrite or de-approve an approved take when generating candidate re-rolls", () => {
      const bible = new StoryBibleManager(dbPath);

      // Existing Take 01 is approved by director
      bible.recordShotTake({
        id: "take_approved_01",
        series_id: "series_cyber",
        episode_number: 1,
        shot_id: "sc01_sh01",
        take_number: 1,
        provider: "mock",
        prompt: "First take",
        local_path: "shots/t1.mp4",
        duration_sec: 3.0,
        qa_status: "PASS",
        is_approved: true,
      });

      expect(bible.getApprovedTakeForShot("series_cyber", 1, "sc01_sh01")?.id).toBe("take_approved_01");

      // New candidate Take 02 is recorded with is_approved = false
      bible.recordShotTake({
        id: "take_candidate_02",
        series_id: "series_cyber",
        episode_number: 1,
        shot_id: "sc01_sh01",
        take_number: 2,
        provider: "mock",
        prompt: "Second re-roll candidate",
        local_path: "shots/t2.mp4",
        duration_sec: 3.0,
        qa_status: "WARN",
        is_approved: false,
      });

      // Approved take MUST remain take_approved_01
      const currentApproved = bible.getApprovedTakeForShot("series_cyber", 1, "sc01_sh01");
      expect(currentApproved?.id).toBe("take_approved_01");

      const allTakes = bible.listShotTakes("series_cyber", 1, "sc01_sh01");
      expect(allTakes.length).toBe(2);
      expect(allTakes.find((t) => t.id === "take_approved_01")?.is_approved).toBe(true);
      expect(allTakes.find((t) => t.id === "take_candidate_02")?.is_approved).toBe(false);

      bible.close();
    });

    it("stops re-rolling when maxReRolls is reached", async () => {
      const evaluator = new FaceQaEvaluator({
        maxReRolls: 2,
        styleCategory: "photorealistic",
      });

      const badFrames: FrameEvaluationSample[] = [
        {
          frameIndex: 0,
          timestampSec: 0.0,
          detectedFaces: [{ box: [100, 100, 150, 150], confidence: 0.95, embedding: [0.2, 0.979, 0] }], // drifting identity
        },
      ];

      // Attempt 1: FAIL -> re-roll allowed
      const r1 = await evaluator.evaluateMultiFrame(
        "shot_loop",
        "char_hero",
        badFrames,
        [1, 0, 0]
      );
      expect(r1.status).toBe("FAIL");
      expect(r1.reRollAttempt).toBe(1);
      expect(r1.shouldReRoll).toBe(true);

      // Attempt 2: FAIL -> re-roll allowed
      const r2 = await evaluator.evaluateMultiFrame(
        "shot_loop",
        "char_hero",
        badFrames,
        [1, 0, 0]
      );
      expect(r2.status).toBe("FAIL");
      expect(r2.reRollAttempt).toBe(2);
      expect(r2.shouldReRoll).toBe(true);

      // Attempt 3: Exceeds maxReRolls -> halts, no more re-rolls
      const r3 = await evaluator.evaluateMultiFrame(
        "shot_loop",
        "char_hero",
        badFrames,
        [1, 0, 0]
      );
      expect(r3.status).toBe("FAIL");
      expect(r3.reRollAttempt).toBe(3);
      expect(r3.shouldReRoll).toBe(false);
      expect(r3.notes).toContain("Re-roll limit (2) reached. Halting for manual review.");
    });
  });

  // ==========================================================================
  // YÊU CẦU 11: Đồng bộ khẩu hình là capability riêng
  // ==========================================================================
  describe("Yêu cầu 11: Lip-Sync Capability Disclosure", () => {
    it("explicitly discloses lip-sync as NOT_SUPPORTED when uninstalled, without bundling it into face QA", async () => {
      const backend = new UninstalledVisualQaBackend("wav2lip / sadtalker");
      const lipSync = await backend.checkLipSyncSupport();

      expect(lipSync.status).toBe("NOT_SUPPORTED");
      expect(lipSync.isAvailable).toBe(false);
      expect(lipSync.modelName).toBe("wav2lip / sadtalker");
      expect(lipSync.notes).toContain("chưa được cài đặt");

      // Mock backend also discloses lip-sync capability transparently
      const mockBackend = new MockVisualQaBackend();
      const mockLipSync = await mockBackend.checkLipSyncSupport();
      expect(mockLipSync.status).toBe("NOT_SUPPORTED");
      expect(mockLipSync.isAvailable).toBe(false);
      expect(mockLipSync.notes).toContain("Capability đồng bộ khẩu hình là module độc lập");
    });
  });
});
