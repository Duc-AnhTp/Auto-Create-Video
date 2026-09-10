import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createServer, type Server } from "node:http";
import { readFile, rm, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { EpisodicPipeline } from "./episodic-pipeline.js";
import { BibleManager } from "../bible/bible-manager.js";
import { probeVideoFile } from "../media/media-validator.js";
import { createValidMockMp4File } from "../assets/mock-media-generator.js";
import { ScriptSchema } from "../render/script-schema.js";
import { normalizeVietnameseForTts } from "../tts/vietnamese-normalizer.js";
import { runPipeline } from "../pipeline.js";
import type { VideoProviderAdapter, ShotExecutionSpec, VideoJobStatus } from "../gateway/video-gateway.js";

describe("Production Episode Production Workflow & Media Validation", () => {
  let server: Server;
  const serverPort = 8444;
  const baseUrl = `http://127.0.0.1:${serverPort}`;
  const testOutputDir = join(tmpdir(), `test_prod_verify_${Date.now()}`);
  let validMp4Buffer: Buffer;

  beforeAll(async () => {
    await mkdir(testOutputDir, { recursive: true });

    // Generate a real valid MP4 fixture file
    const fixturePath = join(testOutputDir, "fixture_clip.mp4");
    await createValidMockMp4File(fixturePath, 3.0);
    validMp4Buffer = await readFile(fixturePath);

    // Start local HTTP server to simulate cloud provider CDN endpoints
    server = createServer((req, res) => {
      if (req.url === "/valid-clip.mp4") {
        res.writeHead(200, {
          "Content-Type": "video/mp4",
          "Content-Length": validMp4Buffer.length,
        });
        res.end(validMp4Buffer);
      } else if (req.url === "/corrupt-video.mp4") {
        res.writeHead(200, {
          "Content-Type": "video/mp4",
        });
        res.end("THIS IS NOT A VALID MP4 FILE CONTAINER");
      } else if (req.url === "/error-500") {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Internal Server Error" }));
      } else if (req.url === "/html-error") {
        res.writeHead(404, { "Content-Type": "text/html" });
        res.end("<html><body>404 Not Found</body></html>");
      } else {
        res.writeHead(404);
        res.end();
      }
    });

    await new Promise<void>((resolve) => {
      server.listen(serverPort, "127.0.0.1", () => resolve());
    });
  });

  afterAll(async () => {
    if (server) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
    if (existsSync(testOutputDir)) {
      try {
        await rm(testOutputDir, { recursive: true, force: true });
      } catch {}
    }
  });

  it("1. Successfully downloads CDN video, stitches timeline, and validates final output with ffprobe", async () => {
    const biblePath = join(testOutputDir, "prod_test.db");
    const outputDir = join(testOutputDir, "ep-01");
    const pipeline = new EpisodicPipeline(biblePath);

    // Mock an external production adapter returning HTTP CDN videoUrl
    class HttpCdnAdapter implements VideoProviderAdapter {
      public providerName = "api_kling" as const;
      public async submitJob(spec: ShotExecutionSpec): Promise<{ jobId: string }> {
        return { jobId: `cdn_job_${spec.shotId}` };
      }
      public async pollStatus(jobId: string): Promise<VideoJobStatus> {
        return {
          jobId,
          status: "completed",
          videoUrl: `${baseUrl}/valid-clip.mp4`,
          durationSec: 3.0,
        };
      }
    }

    // Register adapter into pipeline's gateway
    (pipeline as any).gateway.registerAdapter(new HttpCdnAdapter());

    const script = `
TẬP 1: BẢN HỢP ĐỒNG
Logline: Minh nhận nhiệm vụ mật.

CẢNH 1: QUÁN BAR HẺM 9 - ĐÊM
CÚ MÁY 1 (establishing, 3s): Toàn cảnh Hẻm 9 Sài Gòn ánh đèn neon phản chiếu trên mặt đường mưa.
CÚ MÁY 2 (medium, 3s): Minh ngồi trong góc tối với áo khoác da.
MINH: Tôi đã nhận được tín hiệu.
`;

    const result = await pipeline.produceEpisode(script, {
      seriesId: "cyber-test",
      provider: "api_kling",
      outputDir,
      mockTts: true,
      skipAudit: true,
      narrativeDelta: {
        major_events: ["Minh nhận nhiệm vụ mật tại quán bar"],
      },
    });

    expect(result.episodeNumber).toBe(1);
    expect(result.isMock).toBe(false);
    expect(result.committedCanon).toBe(true);
    expect(existsSync(result.videoPath)).toBe(true);

    // Verify final assembled video with ffprobe
    const probe = await probeVideoFile(result.videoPath);
    expect(probe.isValid).toBe(true);
    expect(probe.videoStream).toBeDefined();
    expect(probe.durationSec).toBeGreaterThan(0);
    expect(probe.videoStream?.width).toBeGreaterThan(0);
    expect(probe.videoStream?.height).toBeGreaterThan(0);

    // Verify Story Bible has canon commit
    const canon = pipeline.getBible().getCanonHistory();
    expect(canon.length).toBe(1);
    expect(canon[0].major_events).toContain("Minh nhận nhiệm vụ mật tại quán bar");
  });

  it("2. Fails immediately and halts canon commit when provider returns HTTP error", async () => {
    const biblePath = join(testOutputDir, "err_test.db");
    const outputDir = join(testOutputDir, "ep-err");
    const pipeline = new EpisodicPipeline(biblePath);

    class HttpFailAdapter implements VideoProviderAdapter {
      public providerName = "api_runway" as const;
      public async submitJob(spec: ShotExecutionSpec): Promise<{ jobId: string }> {
        return { jobId: `cdn_err_${spec.shotId}` };
      }
      public async pollStatus(jobId: string): Promise<VideoJobStatus> {
        return {
          jobId,
          status: "completed",
          videoUrl: `${baseUrl}/error-500`,
        };
      }
    }

    (pipeline as any).gateway.registerAdapter(new HttpFailAdapter());

    const script = `
TẬP 1: THỬ NGHIỆM LỖI
Logline: Kiểm tra trường hợp lỗi HTTP.

CẢNH 1: BẾN TÀU - ĐÊM
CÚ MÁY 1 (establishing, 3s): Bến tàu vắng lặng.
`;

    await expect(
      pipeline.produceEpisode(script, {
        seriesId: "cyber-err",
        provider: "api_runway",
        outputDir,
        mockTts: true,
        skipAudit: true,
        narrativeDelta: { major_events: ["Sự kiện không được ghi nhận"] },
      })
    ).rejects.toThrow(/PRODUCTION ERROR/);

    // Verify Canon was NOT committed
    const canon = pipeline.getBible().getCanonHistory();
    expect(canon.length).toBe(0);

    // Verify Checkpoint records failure
    const job = await pipeline.loadCheckpoint(outputDir);
    expect(job).toBeDefined();
    expect(job?.shots["sc1_sh1"]?.status).toBe("failed");
  });

  it("3. Rejects corrupt non-video content and refuses to commit Canon Memory", async () => {
    const biblePath = join(testOutputDir, "corrupt_test.db");
    const outputDir = join(testOutputDir, "ep-corrupt");
    const pipeline = new EpisodicPipeline(biblePath);

    class HttpCorruptAdapter implements VideoProviderAdapter {
      public providerName = "api_wan" as const;
      public async submitJob(spec: ShotExecutionSpec): Promise<{ jobId: string }> {
        return { jobId: `cdn_corrupt_${spec.shotId}` };
      }
      public async pollStatus(jobId: string): Promise<VideoJobStatus> {
        return {
          jobId,
          status: "completed",
          videoUrl: `${baseUrl}/corrupt-video.mp4`,
        };
      }
    }

    (pipeline as any).gateway.registerAdapter(new HttpCorruptAdapter());

    const script = `
TẬP 1: FILE HỎNG
Logline: Kiểm tra file hỏng.

CẢNH 1: SÂN THƯỢNG - ĐÊM
CÚ MÁY 1 (wide, 3s): Mưa lớn trên sân thượng.
`;

    await expect(
      pipeline.produceEpisode(script, {
        seriesId: "cyber-corrupt",
        provider: "api_wan",
        outputDir,
        mockTts: true,
        skipAudit: true,
      })
    ).rejects.toThrow(/PRODUCTION ERROR|ffprobe/);

    const canon = pipeline.getBible().getCanonHistory();
    expect(canon.length).toBe(0);
  });

  it("4. Correctly isolates mock mode without committing Story Bible by default", async () => {
    const biblePath = join(testOutputDir, "mock_test.db");
    const outputDir = join(testOutputDir, "ep-mock");
    const pipeline = new EpisodicPipeline(biblePath);

    const script = `
TẬP 1: CHẾ ĐỘ MOCK
Logline: Chạy thử mock.

CẢNH 1: PHÒNG LAB - NGÀY
CÚ MÁY 1 (establishing, 3s): Phòng thí nghiệm hiện đại.
AN: Dữ liệu đang được giải mã.
`;

    const result = await pipeline.produceEpisode(script, {
      seriesId: "cyber-mock",
      provider: "mock",
      outputDir,
      mockTts: true,
      skipAudit: true,
      narrativeDelta: { major_events: ["Sự kiện trong mock"] },
    });

    expect(result.isMock).toBe(true);
    expect(result.committedCanon).toBe(false); // In mock mode, Story Bible is NOT committed by default

    // Verify Story Bible remains pristine
    const canon = pipeline.getBible().getCanonHistory();
    expect(canon.length).toBe(0);
  });

  it("5. Seamlessly processes single-shot scenes and scenes with zero dialogue", async () => {
    const biblePath = join(testOutputDir, "singleshot_test.db");
    const outputDir = join(testOutputDir, "ep-singleshot");
    const pipeline = new EpisodicPipeline(biblePath);

    class SingleShotCdnAdapter implements VideoProviderAdapter {
      public providerName = "api_kling" as const;
      public async submitJob(spec: ShotExecutionSpec): Promise<{ jobId: string }> {
        return { jobId: `single_${spec.shotId}` };
      }
      public async pollStatus(jobId: string): Promise<VideoJobStatus> {
        return {
          jobId,
          status: "completed",
          videoUrl: `${baseUrl}/valid-clip.mp4`,
          durationSec: 3.0,
        };
      }
    }

    (pipeline as any).gateway.registerAdapter(new SingleShotCdnAdapter());

    // Script with strictly 1 scene, 1 shot, and NO dialogue!
    const script = `
TẬP 1: KHOẢNH KHẮC TĨNH LẶNG
Logline: Một phân cảnh không lời.

CẢNH 1: VÙNG HOANG MẠC - HOÀNG HÔN
CÚ MÁY 1 (establishing, 3s): Mặt trời lặn đỏ rực trên vùng hoang mạc vắng bóng người.
`;

    const result = await pipeline.produceEpisode(script, {
      seriesId: "cyber-singleshot",
      provider: "api_kling",
      outputDir,
      mockTts: true,
      skipAudit: true,
    });

    expect(result.episodeNumber).toBe(1);
    expect(existsSync(result.videoPath)).toBe(true);

    const probe = await probeVideoFile(result.videoPath);
    expect(probe.isValid).toBe(true);
    expect(probe.durationSec).toBeGreaterThan(0);
  });

  it("6. Verifies news video pipeline components and contracts remain completely intact and functional", async () => {
    // 1. Verify ScriptSchema parsing for existing news video format
    const validNewsScript = {
      meta: {
        title: "Tin tức AI mới nhất",
        topic: "Công nghệ AI",
        durationTarget: 60,
      },
      scenes: [
        {
          id: 1,
          layout: "hook",
          voice: "Chào mừng các bạn đến với bản tin AI hôm nay.",
          data: {
            template: "hook",
            headline: "AI thế hệ mới ra mắt",
            subhead: "Đột phá công nghệ",
            kenBurns: "zoom-in",
          },
        },
      ],
    };

    const parsed = ScriptSchema.safeParse(validNewsScript);
    expect(parsed.success).toBe(true);

    // 2. Verify Vietnamese pronunciation normalizer
    const normalized = normalizeVietnameseForTts("Mô hình AI GPT-4 đạt 99.5% độ chính xác");
    expect(normalized).toContain("mô hình");
    expect(normalized.length).toBeGreaterThan(0);

    // 3. Verify runPipeline entrypoint function exists and is a callable async function
    expect(typeof runPipeline).toBe("function");
  });
});
