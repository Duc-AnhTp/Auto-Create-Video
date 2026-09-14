import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { StudioServer } from "./studio-server.js";
import axios from "axios";
import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { BibleManager } from "../bible/bible-manager.js";

describe("Full-Flow Web Studio Server & REST/SSE API", () => {
  let studio: StudioServer;
  let baseUrl: string;
  const testSeriesId = "test-studio-series";

  beforeAll(async () => {
    // Pick an ephemeral port for testing
    const testPort = 3987;
    studio = new StudioServer({ port: testPort });
    baseUrl = await studio.start();
  });

  afterAll(async () => {
    await studio.close();
    BibleManager.closeAll();
    const testDir = join("data", "series", testSeriesId);
    if (existsSync(testDir)) {
      try {
        await rm(testDir, { recursive: true, force: true });
      } catch {}
    }
  });

  it("1. Responds to healthcheck endpoint", async () => {
    const res = await axios.get(`${baseUrl}/health`);
    expect(res.status).toBe(200);
    expect(res.data.status).toBe("ok");
    expect(res.data.uptime).toBeGreaterThanOrEqual(0);
  });

  it("2. Serves the Dark Mode Cinema Web Studio SPA UI", async () => {
    const res = await axios.get(`${baseUrl}/`);
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("text/html");
    expect(res.data).toContain("AUTO-CREATE-VIDEO");
    expect(res.data).toContain("Story Bible");
    expect(res.data).toContain("Production Desk");
  });

  it("3. Initializes a new Series and lists it via REST API", async () => {
    const initRes = await axios.post(`${baseUrl}/api/series/init`, {
      id: testSeriesId,
      title: "Huyền Thoại Sài Gòn 2088",
      genre: "Cyberpunk Action",
      visual_style: "Cinematic 35mm, neon noir",
    });

    expect(initRes.status).toBe(200);
    expect(initRes.data.success).toBe(true);
    expect(initRes.data.metadata.title).toBe("Huyền Thoại Sài Gòn 2088");

    const listRes = await axios.get(`${baseUrl}/api/series/list`);
    expect(listRes.status).toBe(200);
    expect(Array.isArray(listRes.data.series)).toBe(true);
    const found = listRes.data.series.find((s: any) => s.id === testSeriesId);
    expect(found).toBeDefined();
    expect(found.title).toBe("Huyền Thoại Sài Gòn 2088");
  });

  it("4. Registers character, retrieves Story Bible state, and generates concept art", async () => {
    const charRes = await axios.post(`${baseUrl}/api/series/${testSeriesId}/characters`, {
      id: "char_minh",
      name: "Minh",
      role: "protagonist",
      visual_summary: "Minh 30 tuổi, áo khoác da sờn",
      distinguishing_marks: "vết sẹo dài lông mày trái",
    });

    expect(charRes.status).toBe(200);
    expect(charRes.data.success).toBe(true);
    expect(charRes.data.character.name).toBe("Minh");

    const bibleRes = await axios.get(`${baseUrl}/api/series/${testSeriesId}/bible`);
    expect(bibleRes.status).toBe(200);
    expect(bibleRes.data.characters.length).toBeGreaterThanOrEqual(1);

    // Generate Concept Art
    const artRes = await axios.post(`${baseUrl}/api/series/${testSeriesId}/gen-art`, {
      type: "character",
      id: "char_minh",
      provider: "mock",
    });

    expect(artRes.status).toBe(200);
    expect(artRes.data.success).toBe(true);
    expect(artRes.data.result.faceEmbedding).toBeDefined();
    expect(artRes.data.result.faceEmbedding.length).toBe(512);
  });

  it("5. Generates screenplay from prompt via AI generator API", async () => {
    const scriptRes = await axios.post(`${baseUrl}/api/series/${testSeriesId}/script/generate`, {
      prompt: "Minh giải cứu đồng đội khỏi tòa nhà Skyline bị phong tỏa.",
      episodeNumber: 1,
      targetScenes: 3,
    });

    expect(scriptRes.status).toBe(200);
    expect(scriptRes.data.success).toBe(true);
    expect(scriptRes.data.result.rawScreenplay).toContain("TẬP 1:");
    expect(scriptRes.data.result.rawScreenplay).toContain("CẢNH 1:");
    expect(scriptRes.data.result.rawScreenplay).toContain("CẢNH 2:");
    expect(scriptRes.data.result.rawScreenplay).toContain("CẢNH 3:");
  });

  it("6. Retrieves AI Model Hub providers list with credential masking", async () => {
    const res = await axios.get(`${baseUrl}/api/settings/models`);
    expect(res.status).toBe(200);
    expect(res.data.success).toBe(true);
    expect(Array.isArray(res.data.providers)).toBe(true);

    const anthropic = res.data.providers.find((p: any) => p.id === "anthropic");
    expect(anthropic).toBeDefined();
    expect(anthropic.category).toBe("llm");
    const keyField = anthropic.fields.find((f: any) => f.key === "apiKey");
    expect(keyField).toBeDefined();
    expect(keyField.type).toBe("password");
  });

  it("7. Updates provider settings and persists them to running environment", async () => {
    const res = await axios.post(`${baseUrl}/api/settings/models`, {
      updates: {
        TEST_CUSTOM_MODEL_KEY: "custom-secret-key-1234",
      },
    });
    expect(res.status).toBe(200);
    expect(res.data.success).toBe(true);
    expect(process.env.TEST_CUSTOM_MODEL_KEY).toBe("custom-secret-key-1234");
  });

  it("8. Runs test probe on model provider via /api/settings/test-connection", async () => {
    const probeRes = await axios.post(`${baseUrl}/api/settings/test-connection`, {
      providerId: "lucylab",
      credentials: {
        apiKey: "lucy-test-key-probe-8888",
      },
    });
    expect(probeRes.status).toBe(200);
    expect(probeRes.data.success).toBe(true);
    expect(probeRes.data.latencyMs).toBeGreaterThanOrEqual(0);
    expect(probeRes.data.message).toContain("thành công");
  });
});
