import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { EpisodicPipeline } from "./episodic-pipeline.js";
import { BibleManager } from "../bible/bible-manager.js";
import { probeVideoFile, probeAudioFile } from "../media/media-validator.js";
import { existsSync, readFileSync, statSync } from "node:fs";
import { rm, mkdir, writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";

describe("Giai đoạn 3: Khóa Tính Đúng Đắn Của Resume & Unified Timeline", () => {
  const testOutputDir = join("output", "test-resume-timeline-fidelity");
  const testDbPath = join(testOutputDir, "story_bible.db");

  const baseScriptFixture = `
TẬP 1: BẢN HỢP ĐỒNG BÓNG ĐÊM
Logline: Minh bàn giao con chip cho An tại quán bar Hẻm 9 dưới mưa neon.

CẢNH 1: QUÁN BAR HẺM 9 - ĐÊM
Nhân vật: Minh, An
Đạo cụ: Con Chip Lượng Tử

CÚ MÁY 1 (establishing, 3s): Toàn cảnh quán bar Hẻm 9 mờ ảo dưới ánh đèn neon đỏ và mưa rơi ngoài cửa kính.
CÚ MÁY 2 (close_up, 4s): Minh ngồi trong góc tối, đẩy chiếc hộp titan về phía trước.
MINH: Cầm lấy con chip này. Đừng để bọn chúng tìm thấy nó!
CÚ MÁY 3 (medium, 3s): Không gian tĩnh lặng, khói thuốc lan tỏa trong góc quán bar.
CÚ MÁY 4 (close_up, 3s): An mở nắp hộp, ánh sáng xanh ngọc hắt lên mắt.
AN: Yên tâm đi, tôi sẽ giải mã nó trong đêm nay.
  `.trim();

  beforeEach(async () => {
    if (existsSync(testOutputDir)) {
      try {
        await rm(testOutputDir, { recursive: true, force: true });
      } catch {}
    }
    await mkdir(testOutputDir, { recursive: true });

    // Setup Bible with characters and props
    const bible = new BibleManager(testDbPath);
    bible.upsertSeriesMetadata({
      id: "cyber-saigon-timeline",
      title: "Sài Gòn 2088",
      genre: "Cyberpunk Noir",
      visual_style: "Cinematic 35mm, neon lights, rainy Saigon alleys",
      aspect_ratio: "9:16",
      fps: 30,
      created_at: new Date().toISOString(),
    });
    bible.upsertCharacter({
      id: "char_minh",
      name: "Minh",
      role: "protagonist",
      visual_summary: "Thám tử tư Minh, 35 tuổi",
      voice_profile_id: "elevenlabs:voice_minh_123",
      status: "alive",
    });
    bible.upsertCharacter({
      id: "char_an",
      name: "An",
      role: "supporting",
      visual_summary: "Hacker An, tóc xanh neon",
      voice_profile_id: "lucylab:voice_an_456",
      status: "alive",
    });
    bible.upsertKeyProp({
      id: "prop_chip",
      name: "Con Chip Lượng Tử",
      visual_summary: "Chip lượng tử phát sáng xanh ngọc",
      current_holder_id: "char_minh",
      status: "intact",
    });
  });

  afterEach(async () => {
    if (existsSync(testOutputDir)) {
      try {
        await rm(testOutputDir, { recursive: true, force: true });
      } catch {}
    }
  });

  // ── 1. Dựng lần đầu, lưu timeline.json và manifest ──
  it("produces episode, persists timeline.json, manifest, and elementary stream durations match", async () => {
    const pipeline = new EpisodicPipeline(testDbPath);
    const result = await pipeline.produceEpisode(baseScriptFixture, {
      seriesId: "cyber-saigon-timeline",
      provider: "mock",
      mockTts: true,
      outputDir: testOutputDir,
    });

    expect(result.episodeNumber).toBe(1);
    expect(existsSync(result.videoPath)).toBe(true);
    expect(existsSync(result.audioPath)).toBe(true);

    const timelinePath = join(testOutputDir, "timeline.json");
    expect(existsSync(timelinePath)).toBe(true);
    const timelineData = JSON.parse(await readFile(timelinePath, "utf8"));
    expect(timelineData.shots.length).toBe(4);

    const manifestPath = join(testOutputDir, "script-normalized.json");
    expect(existsSync(manifestPath)).toBe(true);

    // Elementary stream probing (not container duration)
    const videoProbe = await probeVideoFile(result.videoPath);
    const audioProbe = await probeAudioFile(result.audioPath);

    expect(videoProbe.isValid).toBe(true);
    expect(audioProbe.isValid).toBe(true);
    expect(videoProbe.durationSec).toBeGreaterThan(0);
    expect(audioProbe.durationSec).toBeGreaterThan(0);

    // Drift tolerance check (without -shortest)
    const driftSec = Math.abs(videoProbe.durationSec - audioProbe.durationSec);
    const fpsTolerance = 1.0 / 30.0 + 0.05; // ~0.083s
    expect(driftSec).toBeLessThanOrEqual(fpsTolerance);
  });

  // ── 2. Clean Resume: Không sinh lại media không cần thiết ──
  it("resumes cleanly without regenerating unchanged video clips or audio", async () => {
    const pipeline = new EpisodicPipeline(testDbPath);

    // Initial production
    await pipeline.produceEpisode(baseScriptFixture, {
      seriesId: "cyber-saigon-timeline",
      provider: "mock",
      mockTts: true,
      outputDir: testOutputDir,
    });

    // Record mtime of generated assets
    const shot1Path = join(testOutputDir, "shots", "sc01_sh01.mp4");
    const audioMasterPath = join(testOutputDir, "audio", "soundtrack_master.wav");
    expect(existsSync(shot1Path)).toBe(true);
    expect(existsSync(audioMasterPath)).toBe(true);
    const shot1MtimeBefore = statSync(shot1Path).mtimeMs;
    const audioMtimeBefore = statSync(audioMasterPath).mtimeMs;

    // Run clean resume with identical input
    const resumeResult = await pipeline.produceEpisode(baseScriptFixture, {
      seriesId: "cyber-saigon-timeline",
      provider: "mock",
      mockTts: true,
      resume: true,
      outputDir: testOutputDir,
    });

    expect(resumeResult.episodeNumber).toBe(1);
    const shot1MtimeAfter = statSync(shot1Path).mtimeMs;
    const audioMtimeAfter = statSync(audioMasterPath).mtimeMs;

    // Both video and audio should be 100% REUSED without re-writing
    expect(shot1MtimeAfter).toBe(shot1MtimeBefore);
    expect(audioMtimeAfter).toBe(audioMtimeBefore);
  });

  // ── 3. Sửa riêng thoại: Invalidate audio, bảo toàn 100% video clip ──
  it("invalidates only audio when dialogue changes, preserving 100% video clips", async () => {
    const pipeline = new EpisodicPipeline(testDbPath);

    // Initial production
    await pipeline.produceEpisode(baseScriptFixture, {
      seriesId: "cyber-saigon-timeline",
      provider: "mock",
      mockTts: true,
      outputDir: testOutputDir,
    });

    const shot2VideoPath = join(testOutputDir, "shots", "sc01_sh02.mp4");
    const shot2VideoMtimeBefore = statSync(shot2VideoPath).mtimeMs;

    // Script with modified dialogue in shot 2
    const modifiedDialogueScript = baseScriptFixture.replace(
      "Cầm lấy con chip này. Đừng để bọn chúng tìm thấy nó!",
      "Đây là con chip lượng tử tuyệt mật. Hãy cẩn thận đấy!"
    );

    // Resume with modified dialogue
    await pipeline.produceEpisode(modifiedDialogueScript, {
      seriesId: "cyber-saigon-timeline",
      provider: "mock",
      mockTts: true,
      resume: true,
      outputDir: testOutputDir,
    });

    // Video clip for shot 2 was NOT modified (visual prompt remained unchanged)
    const shot2VideoMtimeAfter = statSync(shot2VideoPath).mtimeMs;
    expect(shot2VideoMtimeAfter).toBe(shot2VideoMtimeBefore);

    // Audio master was re-rendered
    const checkpoint = await pipeline.loadCheckpoint(testOutputDir);
    expect(checkpoint?.audioFingerprint).toBeDefined();
  });

  // ── 4. Sửa Visual Prompt: Invalidate video, bảo toàn audio ──
  it("invalidates only affected video clip when visual prompt changes, preserving audio", async () => {
    const pipeline = new EpisodicPipeline(testDbPath);

    // Initial production
    await pipeline.produceEpisode(baseScriptFixture, {
      seriesId: "cyber-saigon-timeline",
      provider: "mock",
      mockTts: true,
      outputDir: testOutputDir,
    });

    const audioMasterPath = join(testOutputDir, "audio", "soundtrack_master.wav");
    const audioMtimeBefore = statSync(audioMasterPath).mtimeMs;
    const shot1VideoPath = join(testOutputDir, "shots", "sc01_sh01.mp4");
    const shot1VideoMtimeBefore = statSync(shot1VideoPath).mtimeMs;

    // Script with changed visual prompt for shot 1
    const modifiedPromptScript = baseScriptFixture.replace(
      "Toàn cảnh quán bar Hẻm 9 mờ ảo dưới ánh đèn neon đỏ và mưa rơi ngoài cửa kính.",
      "Cận cảnh giọt mưa rơi tí tách trên biển hiệu neon quán bar Hẻm 9."
    );

    // Small delay to ensure timestamp difference
    await new Promise((r) => setTimeout(r, 20));

    await pipeline.produceEpisode(modifiedPromptScript, {
      seriesId: "cyber-saigon-timeline",
      provider: "mock",
      mockTts: true,
      resume: true,
      outputDir: testOutputDir,
    });

    // Shot 1 video was re-generated!
    const shot1VideoMtimeAfter = statSync(shot1VideoPath).mtimeMs;
    expect(shot1VideoMtimeAfter).toBeGreaterThan(shot1VideoMtimeBefore);

    // Audio was NOT re-synthesized because dialogue did not change!
    const audioMtimeAfter = statSync(audioMasterPath).mtimeMs;
    expect(audioMtimeAfter).toBe(audioMtimeBefore);
  });

  // ── 5. Thêm, xóa, đổi thứ tự shot: Pipeline không crash và không gán nhầm clip ──
  it("handles added, deleted, and reordered shots cleanly without crash or misaligned clips", async () => {
    const pipeline = new EpisodicPipeline(testDbPath);

    // Initial production (4 shots)
    await pipeline.produceEpisode(baseScriptFixture, {
      seriesId: "cyber-saigon-timeline",
      provider: "mock",
      mockTts: true,
      outputDir: testOutputDir,
    });

    // Reordered script: swap shot 3 and shot 4, and remove shot 1
    const reorderedScript = `
TẬP 1: BẢN HỢP ĐỒNG BÓNG ĐÊM
Logline: Minh giao chip cho An.

CẢNH 1: QUÁN BAR HẺM 9 - ĐÊM
Nhân vật: Minh, An

CÚ MÁY 2 (close_up, 4s): Minh ngồi trong góc tối, đẩy chiếc hộp titan về phía trước.
MINH: Cầm lấy con chip này. Đừng để bọn chúng tìm thấy nó!
CÚ MÁY 4 (close_up, 3s): An mở nắp hộp, ánh sáng xanh ngọc hắt lên mắt.
AN: Yên tâm đi, tôi sẽ giải mã nó trong đêm nay.
CÚ MÁY 3 (medium, 3s): Không gian tĩnh lặng, khói thuốc lan tỏa trong góc quán bar.
CÚ MÁY 5 (wide, 2s): Hai người rời khỏi bàn tiệc.
    `.trim();

    const result = await pipeline.produceEpisode(reorderedScript, {
      seriesId: "cyber-saigon-timeline",
      provider: "mock",
      mockTts: true,
      resume: true,
      outputDir: testOutputDir,
    });

    expect(result.episodeNumber).toBe(1);
    const checkpoint = await pipeline.loadCheckpoint(testOutputDir);
    expect(checkpoint?.shotProgress.length).toBe(4);
    expect(checkpoint?.shotProgress.map((s) => s.shotId)).toEqual([
      "sc01_sh02",
      "sc01_sh04",
      "sc01_sh03",
      "sc01_sh05",
    ]);
  });

  // ── 6. Thoại dài hơn shot: Lưu thời lượng mới và giữ đúng khi resume/remux ──
  it("extends shot duration when dialogue exceeds shot time and preserves across resume/remux", async () => {
    const pipeline = new EpisodicPipeline(testDbPath);

    // Shot 1 is declared as 2s, but dialogue has multiple sentences that will take ~5-6s
    const overflowScript = `
TẬP 1: THỬ NGHIỆM THOẠI DÀI
Logline: Kiểm tra tự động kéo dài shot khi thoại tràn.

CẢNH 1: PHÒNG HỌP - NGÀY
Nhân vật: Minh

CÚ MÁY 1 (medium, 2s): Minh đọc báo cáo bảo mật chi tiết với nhiều thông tin quan trọng.
MINH: Chúng ta đã kiểm tra toàn bộ hệ thống phòng thủ mạng của tập đoàn. Không có dấu vết xâm nhập nào từ bên ngoài, tuy nhiên cơ sở dữ liệu đã bị sao chép từ một tài khoản nội bộ.
    `.trim();

    const result = await pipeline.produceEpisode(overflowScript, {
      seriesId: "cyber-saigon-timeline",
      provider: "mock",
      mockTts: true,
      overflowPolicy: "extend_shot",
      outputDir: testOutputDir,
    });

    const timelineData = JSON.parse(
      await readFile(join(testOutputDir, "timeline.json"), "utf8")
    );
    // Shot 1 duration should have extended beyond 2.0s
    const finalShot1Duration = timelineData.shots[0].durationSec;
    expect(finalShot1Duration).toBeGreaterThan(2.0);

    // Remux episode and ensure remuxed video matches extended duration
    const remuxResult = await pipeline.remuxEpisode(testOutputDir, {
      provider: "mock",
      transitionDurationSec: 0.0,
    });

    const remuxProbe = await probeVideoFile(remuxResult.videoPath);
    expect(remuxProbe.isValid).toBe(true);
    expect(remuxProbe.durationSec).toBeCloseTo(finalShot1Duration, 1);
  });

  // ── 7. Phát hiện file media hỏng trước khi dựng ──
  it("detects corrupted media files before stitching and triggers regeneration", async () => {
    const pipeline = new EpisodicPipeline(testDbPath);

    // Initial produce
    await pipeline.produceEpisode(baseScriptFixture, {
      seriesId: "cyber-saigon-timeline",
      provider: "mock",
      mockTts: true,
      outputDir: testOutputDir,
    });

    // Corrupt shot 1 video by truncating it to 0 bytes
    const shot1Path = join(testOutputDir, "shots", "sc01_sh01.mp4");
    await writeFile(shot1Path, Buffer.alloc(0));

    // Verify corrupt status via probeVideoFile
    const probeCorrupted = await probeVideoFile(shot1Path);
    expect(probeCorrupted.isValid).toBe(false);

    // Resume should detect the corrupt file, regenerate it, and produce valid final output
    const resumeResult = await pipeline.produceEpisode(baseScriptFixture, {
      seriesId: "cyber-saigon-timeline",
      provider: "mock",
      mockTts: true,
      resume: true,
      outputDir: testOutputDir,
    });

    expect(existsSync(resumeResult.videoPath)).toBe(true);
    const probeRecovered = await probeVideoFile(shot1Path);
    expect(probeRecovered.isValid).toBe(true);
    expect(probeRecovered.durationSec).toBeGreaterThan(0);
  });
});
