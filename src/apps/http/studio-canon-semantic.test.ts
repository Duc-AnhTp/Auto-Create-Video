import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { StudioServer } from "../../bootstrap/studio-server.js";
import axios from "axios";
import { mkdirSync, existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { SqliteStoryStore } from "../../bootstrap/sqlite-story-store.js";

describe("Studio API: Canon Invariant HUD & Semantic Memory Endpoints", () => {
  let studio: StudioServer;
  let baseUrl: string;
  const testSeriesId = "canon-semantic-studio-series";
  const episodeNumber = 2;
  const dbDir = join("data", "series", testSeriesId);

  beforeAll(async () => {
    mkdirSync(dbDir, { recursive: true });
    const bible = new SqliteStoryStore(join(dbDir, "story_bible.db"));

    bible.upsertSeriesMetadata({
      id: testSeriesId,
      title: "Vụ Án Không Gian",
      aspect_ratio: "16:9",
    });

    bible.upsertCharacter({
      id: "char_nam",
      series_id: testSeriesId,
      name: "Nam",
      role: "protagonist",
      status: "alive",
    });

    bible.upsertCharacter({
      id: "char_hung",
      series_id: testSeriesId,
      name: "Hùng",
      role: "antagonist",
      status: "deceased",
    });

    bible.upsertCharacter({
      id: "char_lan",
      series_id: testSeriesId,
      name: "Lan",
      role: "supporting",
      status: "alive",
    });

    bible.upsertKeyProp({
      id: "prop_the_tu",
      series_id: testSeriesId,
      name: "Thẻ Từ Mật Mã",
      current_holder_id: "char_nam",
    });

    bible.setWorldState("station_lockdown", "active", 1, testSeriesId);

    bible.close();
    SqliteStoryStore.closeAll();

    studio = new StudioServer({ port: 0, queuePath: ":memory:", workersEnabled: false });
    baseUrl = await studio.start();
  });

  afterAll(async () => {
    await studio.close();
    SqliteStoryStore.closeAll();
    if (existsSync(dbDir)) {
      try {
        await rm(dbDir, { recursive: true, force: true });
      } catch {}
    }
  });

  describe("Canon Invariant Validation Endpoint", () => {
    it("1. POST /api/v1/series/:id/episodes/:ep/canon/validate flags fatal violation for deceased character", async () => {
      const script = `
        CẢNH 1: HÀNH LANG - NGÀY
        Hùng bước tới và chặn đường Nam.
        HÙNG: Ngươi không thể trốn thoát!
      `;

      const res = await axios.post(`${baseUrl}/api/v1/series/${testSeriesId}/episodes/${episodeNumber}/canon/validate`, {
        scriptText: script,
      });

      expect(res.status).toBe(200);
      expect(res.data.success).toBe(true);
      expect(res.data.report).toBeDefined();
      expect(res.data.report.status).toBe("FAIL");
      expect(res.data.report.fatalCount).toBeGreaterThanOrEqual(1);
    });

    it("2. POST /api/v1/series/:id/episodes/:ep/canon/validate flags repairable warning for prop custody breach", async () => {
      const script = `
        CẢNH 1: PHÒNG ĐIỀU KHIỂN - ĐÊM
        Lan rút Thẻ Từ Mật Mã và cắm vào khe đọc.
        LAN: Hệ thống đang mở!
      `;

      const res = await axios.post(`${baseUrl}/api/v1/series/${testSeriesId}/episodes/${episodeNumber}/canon/validate`, {
        scriptText: script,
      });

      expect(res.status).toBe(200);
      expect(res.data.success).toBe(true);
      expect(res.data.report.status).toBe("WARN");
      expect(res.data.report.repairableCount).toBe(1);
    });
  });

  describe("Canon Auto-Repair Endpoint", () => {
    it("3. POST /api/v1/series/:id/episodes/:ep/canon/repair synthesizes bridge scenes and updates to PASS", async () => {
      const script = `
        CẢNH 1: PHÒNG ĐIỀU KHIỂN - ĐÊM
        Lan rút Thẻ Từ Mật Mã và cắm vào khe đọc.
        LAN: Hệ thống đang mở!
      `;

      const res = await axios.post(`${baseUrl}/api/v1/series/${testSeriesId}/episodes/${episodeNumber}/canon/repair`, {
        scriptText: script,
        persistToBible: true,
      });

      expect(res.status).toBe(200);
      expect(res.data.success).toBe(true);
      expect(res.data.result.isFullyReconciled).toBe(true);
      expect(res.data.result.repairedScript).toContain("[CẦU NỐI CHUYỂN GIAO ĐẠO CỤ]");
      expect(res.data.result.validationReport.status).toBe("PASS");
    });
  });

  describe("Semantic Memory Query Endpoint", () => {
    it("4. POST /api/v1/series/:id/episodes/:ep/semantic-memory/query returns pruned context and cosine similarity scores", async () => {
      const res = await axios.post(`${baseUrl}/api/v1/series/${testSeriesId}/episodes/${episodeNumber}/semantic-memory/query`, {
        queryText: "Nam kích hoạt Thẻ Từ Mật Mã khi trạm không gian bị phong tỏa",
        tokenBudget: 2500,
      });

      expect(res.status).toBe(200);
      expect(res.data.success).toBe(true);
      expect(res.data.prunedContext).toBeDefined();
      expect(res.data.prunedContext.relevantCharacters.some((c: any) => c.name === "Nam")).toBe(true);
      expect(res.data.prunedContext.relevantProps.some((p: any) => p.name === "Thẻ Từ Mật Mã")).toBe(true);
      expect(res.data.queryResults.length).toBeGreaterThan(0);
      expect(res.data.queryResults[0].similarity).toBeGreaterThan(0);
    });
  });
});
