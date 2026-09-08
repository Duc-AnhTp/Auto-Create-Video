import { describe, it, expect, vi } from "vitest";
import { writeFile, readFile, unlink, mkdir } from "node:fs/promises";
import { join } from "node:path";
import axios from "axios";
import { startReviewServer } from "./server.js";

const testDir = join(process.cwd(), "test-output-review");
const testScriptPath = join(testDir, "script.json");

const mockScript = {
  version: "1.0",
  metadata: {
    title: "Test Bài Viết Review",
    channel: "Test Channel",
    source: {
      domain: "vnexpress.net",
      url: "https://vnexpress.net/test",
      image: "https://vnexpress.net/test.jpg",
    },
  },
  voice: {
    provider: "lucylab" as const,
    voiceId: "${VIETNAMESE_VOICEID}",
    speed: 1.0,
  },
  scenes: [
    {
      id: "scene-1",
      type: "hook",
      voiceText: "Mô hình GPT 5.5 vừa ra mắt với giá $500.",
      templateData: {
        template: "hook",
        headline: "GPT 5.5 Ra Mắt",
        kenBurns: "zoom-in",
      },
    },
    {
      id: "scene-2",
      type: "body",
      voiceText: "Hiệu năng tăng 82.7% so với mức 50% trước đây.",
      templateData: {
        template: "callout",
        statement: "Hiệu năng tăng 82.7%",
      },
    },
    {
      id: "scene-3",
      type: "body",
      voiceText: "Bộ nhớ trong 128GB cùng pin 5000mAh.",
      templateData: {
        template: "stat-hero",
        value: "128GB",
        label: "Bộ nhớ",
      },
    },
    {
      id: "scene-4",
      type: "body",
      voiceText: "Tốc độ xử lý nhanh gấp hai lần phiên bản cũ.",
      templateData: {
        template: "feature-list",
        title: "Tính năng mới",
        bullets: ["Nhanh gấp 2 lần", "Tiết kiệm pin"],
      },
    },
    {
      id: "scene-5",
      type: "outro",
      voiceText: "Đăng ký kênh để cập nhật tin công nghệ mới nhất.",
      templateData: {
        template: "outro",
        ctaTop: "Đăng ký kênh",
        channelName: "Test Channel",
        source: "vnexpress.net",
      },
    },
  ],
};

describe("Review Micro-Dashboard Server", () => {
  it("starts server, exposes /api/normalize and handles /api/approve", async () => {
    await mkdir(testDir, { recursive: true });
    await writeFile(testScriptPath, JSON.stringify(mockScript, null, 2));

    const testPort = 3123;
    const serverPromise = startReviewServer({
      scriptPath: testScriptPath,
      port: testPort,
      autoOpen: false,
    });

    // Wait until server is listening before making HTTP requests
    await serverPromise.ready;

    // 1. Check HTML dashboard
    const htmlRes = await axios.get(`http://localhost:${testPort}/`);
    expect(htmlRes.status).toBe(200);
    expect(htmlRes.data).toContain("Duyệt & Tinh Chỉnh Kịch Bản Video");

    // 2. Test /api/normalize
    const normRes = await axios.post(`http://localhost:${testPort}/api/normalize`, {
      text: "GPT 5.5 giá $500",
    });
    expect(normRes.status).toBe(200);
    expect(normRes.data.normalized).toContain("năm chấm năm");
    expect(normRes.data.normalized).toContain("năm trăm đô la");

    // 3. Test /api/approve
    const updatedScenes = [
      {
        id: "scene-1",
        type: "hook" as const,
        voiceText: "Mô hình GPT năm chấm năm vừa ra mắt với giá năm trăm đô la.",
        templateData: {
          template: "hook" as const,
          headline: "GPT 5.5 Ra Mắt",
          kenBurns: "zoom-in" as const,
        },
      },
      mockScript.scenes[1],
      mockScript.scenes[2],
      mockScript.scenes[3],
      mockScript.scenes[4],
    ];

    const approveRes = await axios.post(`http://localhost:${testPort}/api/approve`, {
      metadata: mockScript.metadata,
      scenes: updatedScenes,
    });
    expect(approveRes.status).toBe(200);
    expect(approveRes.data.success).toBe(true);

    // Wait for server to resolve
    const finalScript = await serverPromise;
    expect(finalScript.scenes[0].voiceText).toBe(updatedScenes[0].voiceText);

    // Verify on disk: text updated, but template placeholder preserved
    const saved = JSON.parse(await readFile(testScriptPath, "utf8"));
    expect(saved.scenes[0].voiceText).toBe(updatedScenes[0].voiceText);
    expect(saved.voice.voiceId).toBe("${VIETNAMESE_VOICEID}");

    // Clean up
    await unlink(testScriptPath);
  });

  it("handles /api/cancel and rejects server promise gracefully", async () => {
    await mkdir(testDir, { recursive: true });
    await writeFile(testScriptPath, JSON.stringify(mockScript, null, 2));

    const cancelPort = 3124;
    const serverPromise = startReviewServer({
      scriptPath: testScriptPath,
      port: cancelPort,
      autoOpen: false,
    });

    await serverPromise.ready;

    const cancelRes = await axios.post(`http://localhost:${cancelPort}/api/cancel`);
    expect(cancelRes.status).toBe(200);
    expect(cancelRes.data.cancelled).toBe(true);

    await expect(serverPromise).rejects.toThrow("Review was cancelled by the user.");
    await unlink(testScriptPath);
  });
});
