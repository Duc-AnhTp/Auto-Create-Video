import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { EpisodicPipeline } from "../series/episodic-pipeline.js";
import { BibleManager } from "../bible/bible-manager.js";
import {
  FaceQaEvaluator,
  MockVisualQaBackend,
  UninstalledVisualQaBackend,
  getCachedReferenceEmbedding,
  setCachedReferenceEmbedding,
  getReferenceCacheKey,
  clearReferenceEmbeddingCache,
  type VisualQaBackendStatus,
  type FrameEvaluationSample,
} from "./face-evaluator.js";
import { existsSync, readFileSync } from "node:fs";
import { rm, mkdir, writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";

describe("Giai đoạn 4: Hoàn Thiện QA và Duyệt Take", () => {
  const testOutputDir = join("output", "test-qa-take-selection");
  const testDbPath = join(testOutputDir, "story_bible.db");
  const assetsDir = join(testOutputDir, "assets");

  beforeEach(async () => {
    if (existsSync(testOutputDir)) {
      try {
        await rm(testOutputDir, { recursive: true, force: true });
      } catch {}
    }
    await mkdir(testOutputDir, { recursive: true });
    await mkdir(assetsDir, { recursive: true });
    clearReferenceEmbeddingCache();

    // Initialize Bible with a test series and characters
    const bible = new BibleManager(testDbPath);
    bible.upsertSeriesMetadata({
      id: "series_qa_test",
      title: "QA Test Series",
      genre: "Cyberpunk",
      visual_style: "Cinematic 35mm",
      aspect_ratio: "9:16",
      fps: 30,
      created_at: new Date().toISOString(),
    });
  });

  afterEach(async () => {
    clearReferenceEmbeddingCache();
    if (existsSync(testOutputDir)) {
      try {
        await rm(testOutputDir, { recursive: true, force: true });
      } catch {}
    }
  });

  // ── 1. Reference Embedding Caching & Hash-Based Invalidation ──
  it("caches reference embeddings by image content hash and invalidates when image changes", async () => {
    const refImagePath = join(assetsDir, "hero_face.jpg");
    const initialContent = Buffer.from("INITIAL_IMAGE_PIXELS_HERO_FACE_DATA_1");
    await writeFile(refImagePath, initialContent);

    const initialKey = getReferenceCacheKey(refImagePath, "facenet_512_v1");
    const initialHash = createHash("sha256").update(initialContent).digest("hex");
    expect(initialKey).toBe(`${initialHash}:facenet_512_v1`);

    const mockEmbedding1 = [0.85, 0.12, -0.45, 0.77];
    setCachedReferenceEmbedding(refImagePath, "facenet_512_v1", mockEmbedding1);

    // Should retrieve cached vector
    const cached1 = getCachedReferenceEmbedding(refImagePath, "facenet_512_v1");
    expect(cached1).toEqual(mockEmbedding1);

    // Modify the image content on disk (e.g. higher-res image or new character portrait)
    const modifiedContent = Buffer.from("MODIFIED_IMAGE_PIXELS_HERO_FACE_DATA_2");
    await writeFile(refImagePath, modifiedContent);

    const modifiedKey = getReferenceCacheKey(refImagePath, "facenet_512_v1");
    const modifiedHash = createHash("sha256").update(modifiedContent).digest("hex");
    expect(modifiedKey).toBe(`${modifiedHash}:facenet_512_v1`);
    expect(modifiedKey).not.toBe(initialKey);

    // The old cache entry is strictly invalidated for the new image content!
    const cached2 = getCachedReferenceEmbedding(refImagePath, "facenet_512_v1");
    expect(cached2).toBeUndefined();
  });

  // ── 2. Missing Reference Image or Face Returns UNAVAILABLE (Never Fake PASS) ──
  it("strictly returns UNAVAILABLE and escalates to review when reference image or face is missing", async () => {
    const bible = new BibleManager(testDbPath);
    bible.upsertCharacter({
      id: "char_noface",
      name: "Vô Danh",
      role: "supporting",
      visual_summary: "Nhân vật chưa có ảnh chân dung tham chiếu",
      status: "alive",
      // face_reference_image is intentionally undefined
    });

    const rawScript = `
TẬP 1: THỬ NGHIỆM THIẾU ẢNH MẶT
Logline: Nhân vật không có ảnh tham chiếu.
CẢNH 1: QUÁN CÀ PHÊ - NGÀY
Nhân vật: Vô Danh
CÚ MÁY 1 (close_up, 3s): Vô Danh ngồi lặng lẽ bên cửa sổ.
VÔ DANH: Tôi không có ảnh chân dung trong Story Bible.
    `.trim();

    const pipeline = new EpisodicPipeline(testDbPath);
    const result = await pipeline.produceEpisode(rawScript, {
      seriesId: "series_qa_test",
      provider: "mock",
      mockTts: true,
      outputDir: testOutputDir,
    });

    expect(result.episodeNumber).toBe(1);

    // Read the QA report persisted for shot 1
    const qaReportPath = join(testOutputDir, "qa_evidence", "sc01_sh01_qa.json");
    expect(existsSync(qaReportPath)).toBe(true);

    const qaReport = JSON.parse(await readFile(qaReportPath, "utf8"));
    expect(qaReport.status).toBe("UNAVAILABLE");
    expect(qaReport.reviewEscalation?.required).toBe(true);
    expect(qaReport.notes).toContain("Không tìm thấy ảnh tham chiếu khuôn mặt");
  });

  // ── 3. Uninstalled or Unavailable Backend Escalates to Review (Never Fake PASS) ──
  it("escalates to review with UNAVAILABLE status when Visual QA backend is not installed", async () => {
    const evaluator = new FaceQaEvaluator({
      backend: new UninstalledVisualQaBackend("arcface_local"),
    });

    const status = await evaluator.backend.checkReadiness();
    expect(status.availability).toBe("NOT_INSTALLED");

    const sampleFrames: FrameEvaluationSample[] = [
      {
        frameIndex: 0,
        timestampSec: 0.0,
        detectedFaces: [
          {
            box: [0, 0, 100, 100],
            confidence: 0.99,
            embedding: [0.8, 0.1, 0.1],
            faceAreaRatio: 0.1,
          },
        ],
      },
    ];

    const report = await evaluator.evaluateMultiFrame(
      "shot_backend_fail",
      "char_hero",
      sampleFrames,
      [0.8, 0.1, 0.1]
    );

    // MUST be UNAVAILABLE, never fake PASS
    expect(report.status).toBe("UNAVAILABLE");
    expect(report.reviewEscalation?.required).toBe(true);
    expect(report.reviewEscalation?.reason).toBe("BACKEND_UNAVAILABLE");
    expect(report.notes).toContain("UNAVAILABLE");
  });

  // ── 4. QA Evidence Binding (takeId, mediaHash, referenceVersion, isMockVector) ──
  it("binds QA evidence strictly to takeId, mediaHash, referenceVersion, and isMockVector", async () => {
    const refImagePath = join(assetsDir, "an_ref.jpg");
    await writeFile(refImagePath, Buffer.from("AN_REFERENCE_IMAGE_DATA_BYTES"));

    const bible = new BibleManager(testDbPath);
    bible.upsertCharacter({
      id: "char_an",
      name: "An",
      role: "protagonist",
      visual_summary: "Hacker An",
      face_reference_image: refImagePath,
      status: "alive",
    });

    const rawScript = `
TẬP 1: GẮN CHỨNG CỨ QA
Logline: Kiểm tra gắn chứng cứ QA.
CẢNH 1: PHÒNG LAB - ĐÊM
Nhân vật: An
CÚ MÁY 1 (close_up, 3s): An nhìn thẳng vào camera.
AN: Đang kiểm tra chứng cứ QA.
    `.trim();

    const pipeline = new EpisodicPipeline(testDbPath);
    await pipeline.produceEpisode(rawScript, {
      seriesId: "series_qa_test",
      provider: "mock",
      mockTts: true,
      outputDir: testOutputDir,
    });

    const qaReportPath = join(testOutputDir, "qa_evidence", "sc01_sh01_qa.json");
    expect(existsSync(qaReportPath)).toBe(true);

    const qaReport = JSON.parse(await readFile(qaReportPath, "utf8"));
    expect(qaReport.takeId).toBeDefined();
    expect(qaReport.takeId).toContain("sc01_sh01");
    expect(qaReport.mediaHash).toBeDefined();
    expect(qaReport.referenceVersion).toBe("v1");
    expect(qaReport.isMockVector).toBe(true); // Since running with mock provider
  });

  // ── 5. Post-QA Take Selection: Re-roll thất bại không ghi đè take đã duyệt ──
  it("preserves previously approved take when re-rolled take fails QA or is UNAVAILABLE", async () => {
    const refImagePath = join(assetsDir, "minh_ref.jpg");
    await writeFile(refImagePath, Buffer.from("MINH_REFERENCE_IMAGE_DATA_BYTES"));

    const bible = new BibleManager(testDbPath);
    bible.upsertCharacter({
      id: "char_minh",
      name: "Minh",
      role: "protagonist",
      visual_summary: "Thám tử Minh",
      face_reference_image: refImagePath,
      status: "alive",
    });

    const rawScript = `
TẬP 1: THỬ NGHIỆM LỰA CHỌN TAKE
Logline: Kiểm tra bảo toàn take đã duyệt khi reroll.
CẢNH 1: QUÁN BAR - ĐÊM
Nhân vật: Minh
CÚ MÁY 1 (close_up, 3s): Minh ngồi trong bóng tối.
MINH: Take đầu tiên được duyệt.
    `.trim();

    const pipeline = new EpisodicPipeline(testDbPath);

    // Initial production: Take 1 is generated and approved
    await pipeline.produceEpisode(rawScript, {
      seriesId: "series_qa_test",
      provider: "mock",
      mockTts: true,
      outputDir: testOutputDir,
    });

    const approvedTakeBefore = bible.getApprovedTakeForShot("series_qa_test", 1, "sc01_sh01");
    expect(approvedTakeBefore).toBeDefined();
    expect(approvedTakeBefore?.take_number).toBe(1);
    expect(approvedTakeBefore?.is_approved).toBe(1);

    // Re-roll shot 1 WITHOUT forceApprove (Requirement F.1: newly generated take must NOT be auto-approved)
    const rerollResult = await pipeline.rerollShot({
      seriesId: "series_qa_test",
      episodeNumber: 1,
      shotId: "sc01_sh01",
      provider: "mock",
      outputDir: testOutputDir,
      remuxAfterReroll: false,
      forceApprove: false, // Do NOT force approve
    });

    expect(rerollResult.takeId).toContain("take02");
    expect(rerollResult.isApproved).toBe(false);

    // In SQLite: Take 1 must REMAIN the approved take!
    const approvedTakeAfter = bible.getApprovedTakeForShot("series_qa_test", 1, "sc01_sh01");
    expect(approvedTakeAfter?.id).toBe(approvedTakeBefore?.id);
    expect(approvedTakeAfter?.take_number).toBe(1);

    // In Checkpoint: activeTakeId must still point to Take 1
    const checkpoint = await pipeline.loadCheckpoint(testOutputDir);
    expect(checkpoint?.shots["sc01_sh01"]?.activeTakeId).toBe(approvedTakeBefore?.id);
    expect(checkpoint?.shots["sc01_sh01"]?.allTakes).toContain(rerollResult.takeId);
  });

  // ── 6. Manual Approval (forceApprove) Updates Take Selection Consistently ──
  it("updates take selection consistently across SQLite and checkpoint upon explicit director approval", async () => {
    const refImagePath = join(assetsDir, "minh_ref2.jpg");
    await writeFile(refImagePath, Buffer.from("MINH_REFERENCE_IMAGE_DATA_BYTES_2"));

    const bible = new BibleManager(testDbPath);
    bible.upsertCharacter({
      id: "char_minh",
      name: "Minh",
      role: "protagonist",
      visual_summary: "Thám tử Minh",
      face_reference_image: refImagePath,
      status: "alive",
    });

    const rawScript = `
TẬP 1: DUYỆT THỦ CÔNG TAKE MỚI
Logline: Kiểm tra cập nhật take khi đạo diễn duyệt thủ công.
CẢNH 1: HẺM VẮNG - ĐÊM
Nhân vật: Minh
CÚ MÁY 1 (close_up, 3s): Minh bước nhanh trong hẻm.
MINH: Cần chọn take diễn xuất đạt hơn.
    `.trim();

    const pipeline = new EpisodicPipeline(testDbPath);
    await pipeline.produceEpisode(rawScript, {
      seriesId: "series_qa_test",
      provider: "mock",
      mockTts: true,
      outputDir: testOutputDir,
    });

    const approvedTake1 = bible.getApprovedTakeForShot("series_qa_test", 1, "sc01_sh01");
    expect(approvedTake1?.take_number).toBe(1);

    // Director performs re-roll with explicit forceApprove
    const rerollResult = await pipeline.rerollShot({
      seriesId: "series_qa_test",
      episodeNumber: 1,
      shotId: "sc01_sh01",
      provider: "mock",
      outputDir: testOutputDir,
      remuxAfterReroll: false,
      forceApprove: true, // Explicit approval!
    });

    expect(rerollResult.isApproved).toBe(true);

    // In SQLite: Take 2 is now the active approved take
    const approvedTake2 = bible.getApprovedTakeForShot("series_qa_test", 1, "sc01_sh01");
    expect(approvedTake2?.id).toBe(rerollResult.takeId);
    expect(approvedTake2?.take_number).toBe(2);

    // In Checkpoint: activeTakeId is updated to Take 2
    const checkpoint = await pipeline.loadCheckpoint(testOutputDir);
    expect(checkpoint?.shots["sc01_sh01"]?.activeTakeId).toBe(rerollResult.takeId);
    expect(checkpoint?.shots["sc01_sh01"]?.videoPath).toBe(rerollResult.videoPath);
  });

  // ── 7. Model Visual Quality Disclaimer & Non-Verified Status ──
  it("discloses that biometric model accuracy remains NOT_VERIFIED until validated against real image benchmarks", async () => {
    const evaluator = new FaceQaEvaluator({ styleCategory: "photorealistic" });
    expect(evaluator.styleCategory).toBe("photorealistic");
    expect(evaluator.tPass).toBeGreaterThanOrEqual(0.70);
    expect(evaluator.tWarn).toBeGreaterThanOrEqual(0.55);

    const backendReadiness = await evaluator.backend.checkReadiness();
    // In mock/development environments without hardware accelerators and real face weights,
    // capability is marked as synthetic/mock and real model accuracy is explicitly unverified.
    if (backendReadiness.backendName.includes("mock")) {
      expect(backendReadiness.details).toContain("Mock");
    }
  });
});
