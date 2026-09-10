import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { EpisodicPipeline } from "./episodic-pipeline.js";
import { BibleManager } from "../bible/bible-manager.js";
import { downloadVideoFromUrl, VideoModelGateway } from "../gateway/video-gateway.js";
import { resolveImageToDataUriOrUrl } from "../gateway/asset-resolver.js";
import { KlingAdapter } from "../gateway/adapters/kling-adapter.js";
import { RunwayAdapter } from "../gateway/adapters/runway-adapter.js";
import {
  FaceQaEvaluator,
  generateDeterministicEmbedding,
  cosineSimilarity,
} from "../qa/face-evaluator.js";
import { generateValidMp4Buffer } from "../assets/mock-media-generator.js";
import { existsSync, readFileSync } from "node:fs";
import { writeFile, rm, mkdir } from "node:fs/promises";
import { join } from "node:path";
import axios from "axios";

describe("Phase 3 Verification: Video Gateway CDN Downloader, Asset Resolver & Face QA Auto Re-Roll", () => {
  const testOutputDir = join("output", "test-phase3-series");

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
    vi.restoreAllMocks();
  });

  describe("1. Video Gateway CDN Downloader (Task #16)", () => {
    it("downloads video from a Base64 Data URI to local destination path", async () => {
      const validMp4Buf = generateValidMp4Buffer(2.0);
      const dataUri = `data:video/mp4;base64,${validMp4Buf.toString("base64")}`;
      const destPath = join(testOutputDir, "downloaded_data_uri.mp4");

      const result = await downloadVideoFromUrl(dataUri, destPath);
      expect(result).toBe(destPath);
      expect(existsSync(destPath)).toBe(true);

      const savedBuf = readFileSync(destPath);
      expect(savedBuf.length).toBe(validMp4Buf.length);
      expect(savedBuf.subarray(4, 8).toString("ascii")).toBe("ftyp");
    });

    it("copies video from an existing local file or file:// URL", async () => {
      const srcPath = join(testOutputDir, "source.mp4");
      const validMp4Buf = generateValidMp4Buffer(1.5);
      await writeFile(srcPath, validMp4Buf);

      const destPath = join(testOutputDir, "copied.mp4");
      const result = await downloadVideoFromUrl(`file://${srcPath}`, destPath);
      expect(result).toBe(destPath);
      expect(existsSync(destPath)).toBe(true);
    });

    it("downloads video from an HTTP/HTTPS CDN URL using axios stream", async () => {
      const validMp4Buf = generateValidMp4Buffer(2.0);
      const mockCdnUrl = "https://cdn.example.com/shots/sc01_sh01.mp4";

      // Mock axios.get for the CDN download
      const axiosGetSpy = vi.spyOn(axios, "get").mockResolvedValueOnce({
        data: validMp4Buf.buffer,
        status: 200,
        statusText: "OK",
        headers: {},
        config: {} as any,
      });

      const destPath = join(testOutputDir, "cdn_downloaded.mp4");
      const result = await downloadVideoFromUrl(mockCdnUrl, destPath);

      expect(result).toBe(destPath);
      expect(existsSync(destPath)).toBe(true);
      expect(axiosGetSpy).toHaveBeenCalledWith(mockCdnUrl, expect.objectContaining({ responseType: "arraybuffer" }));
    });
  });

  describe("2. Asset Resolver & Base64 Normalization (Task #17)", () => {
    it("leaves remote URLs and existing Data URIs untouched", async () => {
      const httpUrl = "https://example.com/assets/characters/minh.jpg";
      const dataUri = "data:image/jpeg;base64,/9j/4AAQSkZJRg==";

      expect(await resolveImageToDataUriOrUrl(httpUrl)).toBe(httpUrl);
      expect(await resolveImageToDataUriOrUrl(dataUri)).toBe(dataUri);
    });

    it("converts a local image file to a valid Base64 Data URI", async () => {
      const tempImgPath = join(testOutputDir, "test_minh_face.jpg");
      const fakeJpegData = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
      await writeFile(tempImgPath, fakeJpegData);

      const resolved = await resolveImageToDataUriOrUrl(tempImgPath);
      expect(resolved).toBeDefined();
      expect(resolved?.startsWith("data:image/jpeg;base64,")).toBe(true);
      expect(resolved).toContain(fakeJpegData.toString("base64"));
    });

    it("KlingAdapter and RunwayAdapter submit jobs with Base64 Data URIs when given local image paths", async () => {
      const tempImgPath = join(testOutputDir, "ref_face.png");
      const fakePngData = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
      await writeFile(tempImgPath, fakePngData);

      // 1. Test KlingAdapter
      const kling = new KlingAdapter({ apiKey: "test-kling-key" });
      const axiosPostSpy = vi.spyOn(axios, "post").mockResolvedValueOnce({
        data: { code: 0, data: { task_id: "kling_task_123" } },
      });

      await kling.submitJob({
        shotId: "sh01",
        backend: "api_kling",
        priority: "hero",
        durationSec: 5,
        prompt: "Minh nhìn thẳng",
        referenceImage: tempImgPath,
      });

      expect(axiosPostSpy).toHaveBeenCalledTimes(1);
      const klingPayload = axiosPostSpy.mock.calls[0][1] as any;
      expect(klingPayload.image).toBeDefined();
      expect(klingPayload.image.startsWith("data:image/png;base64,")).toBe(true);

      // 2. Test RunwayAdapter
      const runway = new RunwayAdapter({ apiKey: "test-runway-key" });
      axiosPostSpy.mockResolvedValueOnce({
        data: { id: "runway_task_456" },
      });

      await runway.submitJob({
        shotId: "sh02",
        backend: "api_runway",
        priority: "hero",
        durationSec: 5,
        prompt: "Minh bước đi",
        referenceImage: tempImgPath,
      });

      expect(axiosPostSpy).toHaveBeenCalledTimes(2);
      const runwayPayload = axiosPostSpy.mock.calls[1][1] as any;
      expect(runwayPayload.promptImage).toBeDefined();
      expect(runwayPayload.promptImage.startsWith("data:image/png;base64,")).toBe(true);
    });
  });

  describe("3. Face QA Evaluator & Auto Re-Roll (Task #18)", () => {
    it("correctly evaluates tri-state decisions: PASS, WARN, FAIL", () => {
      const evaluator = new FaceQaEvaluator({ tPass: 0.80, tWarn: 0.68, maxReRolls: 2 });
      const refVec = generateDeterministicEmbedding("char_minh");

      // Case 1: Identical/very close vector -> PASS
      const passVec = [...refVec];
      const passReport = evaluator.evaluateShot("shot1", "minh", [passVec], refVec);
      expect(passReport.status).toBe("PASS");
      expect(passReport.shouldReRoll).toBe(false);
      expect(passReport.maxSimilarity).toBeGreaterThanOrEqual(0.80);

      // Construct an exact orthogonal unit vector by 2D coordinate swapping: [-v1, v0, -v3, v2, ...]
      const orthoVec: number[] = [];
      for (let i = 0; i < refVec.length; i += 2) {
        orthoVec.push(-refVec[i + 1]);
        orthoVec.push(refVec[i]);
      }

      // Case 2: Borderline similarity -> WARN (similarity = 0.74 in [0.68, 0.80))
      const warnUnit = refVec.map((v, i) => 0.74 * v + 0.672606868832 * orthoVec[i]);

      const warnSim = cosineSimilarity(warnUnit, refVec);
      expect(warnSim).toBeGreaterThanOrEqual(0.68);
      expect(warnSim).toBeLessThan(0.80);

      const warnReport = evaluator.evaluateShot("shot2", "minh", [warnUnit], refVec);
      expect(warnReport.status).toBe("WARN");
      expect(warnReport.shouldReRoll).toBe(false);

      // Case 3: Drifted face (< tWarn) -> FAIL with shouldReRoll = true (similarity = 0.20 < 0.68)
      const failVec = refVec.map((v, i) => 0.20 * v + 0.9797958971 * orthoVec[i]);
      const failReport = evaluator.evaluateShot("shot3", "minh", [failVec], refVec);
      expect(failReport.status).toBe("FAIL");
      expect(failReport.shouldReRoll).toBe(true);
      expect(failReport.reRollAttempt).toBe(1);
    });

    it("triggers automatic re-roll when Face QA detects drift in EpisodicPipeline", async () => {
      const pipeline = new EpisodicPipeline(":memory:");
      const bible = pipeline.getBible();

      bible.upsertSeriesMetadata({
        id: "cyber-saigon",
        title: "Sài Gòn 2088",
        genre: "Cyberpunk",
        visual_style: "Cinematic 35mm",
        aspect_ratio: "9:16",
        fps: 30,
        created_at: new Date().toISOString(),
      });

      bible.upsertCharacter({
        id: "minh",
        name: "Minh",
        role: "protagonist",
        visual_summary: "Kỹ sư công nghệ 30 tuổi",
        face_reference_image: "assets/characters/minh.jpg",
        status: "alive",
      });

      const rawScript = `
TẬP 1: BẢN HỢP ĐỒNG BÓNG ĐÊM
Logline: Minh bí mật bàn giao chip lượng tử.

CẢNH 1: QUÁN BAR HẺM 9 - ĐÊM
CÚ MÁY 1 (close_up, 4s): Minh ngồi trong góc khuất.
MINH: Cầm lấy con chip này.
`.trim();

      const refEmbedding = generateDeterministicEmbedding("char_minh");
      const driftEmbedding = generateDeterministicEmbedding("char_unrelated_random");
      const passEmbedding = [...refEmbedding];

      let extractionCallCount = 0;

      // Mock extractor: First call returns drift (FAIL), subsequent calls return pass (PASS)
      const mockExtractor = vi.fn().mockImplementation(async () => {
        extractionCallCount++;
        if (extractionCallCount === 1) {
          return { frameEmbeddings: [driftEmbedding], referenceEmbedding: refEmbedding };
        }
        return { frameEmbeddings: [passEmbedding], referenceEmbedding: refEmbedding };
      });

      const result = await pipeline.produceEpisode(rawScript, {
        seriesId: "cyber-saigon",
        outputDir: testOutputDir,
        provider: "mock",
        mockTts: true,
        skipRender: true,
        faceFeatureExtractor: mockExtractor,
      });

      expect(result.episodeNumber).toBe(1);

      // Verify that auto re-roll was triggered!
      // In Story Bible, there should now be 2 takes for sc1_sh1 (take01 failed, take02 was generated)
      const takes = bible.listShotTakes("cyber-saigon", 1, "sc1_sh1");
      expect(takes.length).toBe(2);
      expect(takes[0].take_number).toBe(1);
      expect(takes[1].take_number).toBe(2);
      expect(takes[1].is_approved).toBe(true);

      // Verify take QA statuses in SQLite
      expect(takes[0].qa_status).toBe("FAIL");
      expect(takes[1].qa_status).toBe("PASS");
    });
  });
});
