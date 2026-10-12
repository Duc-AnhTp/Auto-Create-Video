import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdirSync, existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import axios from "axios";
import { SqliteStoryStore } from "../../../bootstrap/sqlite-story-store.js";
import { mapShotToTurnaroundViewAngle, resolveCharacterConditioningImage } from "../domain/conditioning.js";
import { type ShotExecutionSpec } from "../../../contracts/video.js";

import { KlingAdapter } from "../adapters/providers/kling-adapter.js";
import { RunwayAdapter } from "../adapters/providers/runway-adapter.js";
import { VeoAdapter } from "../adapters/providers/veo-adapter.js";
import { SeedanceAdapter } from "../adapters/providers/seedance-adapter.js";
import { CharacterTurnaroundBridge } from "./character-turnaround-bridge.js";
import { VerticalSliceRunner } from "../../../bootstrap/vertical-slice-runtime.js";
import { StudioServer } from "../../../bootstrap/studio-server.js";

describe("Character Turnaround Pack & Real AI Video Gateway Vertical Slice", () => {
  const testSeriesId = "turnaround-vertical-slice-series";
  const dbDir = join("data", "series", testSeriesId);
  const dbPath = join(dbDir, "story_bible.db");

  beforeAll(async () => {
    mkdirSync(dbDir, { recursive: true });
    const bible = new SqliteStoryStore(dbPath);

    bible.upsertSeriesMetadata({
      id: testSeriesId,
      title: "Hồi Quy Vũ Trụ",
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

    bible.close();
    SqliteStoryStore.closeAll();
  });

  afterAll(async () => {
    SqliteStoryStore.closeAll();
    if (existsSync(dbDir)) {
      try {
        await rm(dbDir, { recursive: true, force: true });
      } catch {}
    }
  });

  describe("1. View Angle Mapping & Turnaround Conditioning Resolver", () => {
    it("should accurately map shot metadata to canonical view angles", () => {
      expect(mapShotToTurnaroundViewAngle("close_up", "front", "Nhìn thẳng")).toBe("front");
      expect(mapShotToTurnaroundViewAngle("profile", "side", "Góc nghiêng 90 độ")).toBe("profile");
      expect(mapShotToTurnaroundViewAngle("establishing_shot", "wide", "Toàn thân nhân vật")).toBe("full_body");
      expect(mapShotToTurnaroundViewAngle("medium_close_up", "three_quarter", "Góc 3/4 điện ảnh")).toBe("three_quarter");
      expect(mapShotToTurnaroundViewAngle("two_shot", undefined, "Đối thoại")).toBe("three_quarter");
    });

    it("should resolve the angle-matched turnaround image correctly", () => {
      const spec: ShotExecutionSpec = {
        shotId: "sh_01",
        backend: "mock",
        priority: "hero",
        durationSec: 5,
        prompt: "Profile shot",
        characterTurnaround: {
          front: "assets/front.jpg",
          threeQuarter: "assets/34.jpg",
          profile: "assets/profile.jpg",
          fullBody: "assets/full.jpg",
          viewAngle: "profile",
        },
      };

      const resolved = resolveCharacterConditioningImage(spec);
      expect(resolved).toBe("assets/profile.jpg");

      // Switch angle to front
      spec.characterTurnaround!.viewAngle = "front";
      expect(resolveCharacterConditioningImage(spec)).toBe("assets/front.jpg");

      // Switch angle to full_body
      spec.characterTurnaround!.viewAngle = "full_body";
      expect(resolveCharacterConditioningImage(spec)).toBe("assets/full.jpg");
    });
  });

  describe("2. Character Turnaround Conditioning Bridge", () => {
    it("should generate 4 turnaround views and 512-D ArcFace embedding for Story Bible character", async () => {
      const bible = new SqliteStoryStore(dbPath);
      const spec: ShotExecutionSpec = {
        shotId: "sh_turnaround_test",
        backend: "mock",
        priority: "hero",
        durationSec: 5,
        prompt: "Side profile shot of Nam looking at the stars",
        characterId: "char_nam",
        metadata: { shotType: "profile", cameraAngle: "profile" },
      };

      const enriched = await CharacterTurnaroundBridge.bindTurnaroundToSpec(
        spec,
        bible,
        testSeriesId,
        { autoGenerate: true, allowMock: true }
      );

      expect(enriched.characterTurnaround).toBeDefined();
      expect(enriched.characterTurnaround?.viewAngle).toBe("profile");
      expect(enriched.characterTurnaround?.front).toBeDefined();
      expect(enriched.characterTurnaround?.threeQuarter).toBeDefined();
      expect(enriched.characterTurnaround?.profile).toBeDefined();
      expect(enriched.characterTurnaround?.fullBody).toBeDefined();
      expect(enriched.characterReferenceImage).toContain("turnaround_profile.jpg");
      expect(enriched.faceEmbedding).toBeDefined();
      expect(enriched.faceEmbedding?.length).toBe(512);
      expect(enriched.applyFaceConsistency).toBe(true);

      bible.close();
    });
  });

  describe("3. Video Gateway Adapters Conditioning", () => {
    it("should construct valid payloads using turnaround images across adapters", () => {
      const kling = new KlingAdapter({ apiKey: "test_kling_key" });
      const runway = new RunwayAdapter({ apiKey: "test_runway_key" });
      const veo = new VeoAdapter({ apiKey: "test_veo_key" });
      const seedance = new SeedanceAdapter({ apiKey: "test_seedance_key" });

      expect(kling.capabilities.supportsImageInput).toBe(true);
      expect(runway.capabilities.supportsImageInput).toBe(true);
      expect(veo.capabilities.supportsImageInput).toBe(true);
      expect(seedance.capabilities.supportsImageInput).toBe(true);
    });
  });

  describe("4. End-to-End VerticalSliceRunner Execution", () => {
    it("should execute a full production vertical slice from novel text to finalized master video", async () => {
      const runner = new VerticalSliceRunner(dbPath, { maxBudgetUsd: 50.0 });

      const novelText = `
        Nam bước vào trạm không gian. Trên bàn làm việc, Thẻ Từ Mật Mã đang sáng lên nhấp nháy.
        Lan đứng từ xa nhìn Nam. Cả hai đều hiểu rằng thời gian không còn nhiều.
        Nam trao Thẻ Từ Mật Mã cho Lan để cô mở hệ thống điều khiển.
      `;

      const result = await runner.runVerticalSlice({
        seriesId: testSeriesId,
        episodeNumber: 1,
        chapterTitle: "Khởi Đầu Không Gian",
        novelText,
        mockVideo: true,
        budgetCapUsd: 50.0,
        enableAutoBridge: true,
      });

      expect(result.status).toBe("SUCCESS");
      expect(result.seriesId).toBe(testSeriesId);
      expect(result.episodeNumber).toBe(1);
      expect(result.chapter.title).toBe("Khởi Đầu Không Gian");

      // Semantic Memory check
      expect(result.semanticMemory.relevantCharacters.length).toBeGreaterThan(0);
      expect(result.semanticMemory.relevantProps.length).toBeGreaterThan(0);

      // Canon Validation & Auto Bridge
      expect(result.canonValidation.status).toBe("PASS");

      // Turnaround Anchoring
      expect(result.characterTurnarounds.length).toBeGreaterThan(0);
      expect(result.characterTurnarounds[0].viewsCount).toBe(4);
      expect(result.characterTurnarounds[0].faceEmbeddingDim).toBe(512);

      // Video Execution
      expect(result.videoExecution.totalShots).toBe(5);
      expect(result.videoExecution.completedShots).toBe(5);
      expect(result.videoExecution.shotsManifest.some((s) => s.viewAngle === "front")).toBe(true);
      expect(result.videoExecution.shotsManifest.some((s) => s.viewAngle === "profile")).toBe(true);

      // Visual QA
      expect(result.visualQa.evaluatedCount).toBe(5);
      expect(result.visualQa.passedCount).toBe(5);
      expect(result.visualQa.averageSimilarity).toBeGreaterThanOrEqual(0.72);

      // Budget Ledger Reconciliation
      expect(result.budgetReconciliation.confirmedCostUsd).toBeDefined();

      runner.close();
    });
  });

  describe("5. Studio API: Gateway Metrics, Reconciliation & Vertical Slice Endpoints", () => {
    let studio: StudioServer;
    let baseUrl: string;

    beforeAll(async () => {
      studio = new StudioServer({ port: 0, queuePath: ":memory:", workersEnabled: false });
      baseUrl = await studio.start();
    });

    afterAll(async () => {
      await studio.close();
      SqliteStoryStore.closeAll();
    });

    it("should return gateway metrics with rates, rate limits, and providers", async () => {
      const res = await axios.get(`${baseUrl}/api/v1/gateway/metrics`);
      expect(res.status).toBe(200);
      expect(res.data.success).toBe(true);
      expect(res.data.rates.api_kling).toBe(0.12);
      expect(res.data.rateLimits.api_kling.maxConcurrent).toBe(2);
      expect(res.data.providers).toContain("api_kling");
      expect(res.data.providers).toContain("api_runway");
      expect(res.data.providers).toContain("api_veo");
      expect(res.data.providers).toContain("api_seedance");
    });

    it("should return reconciliation data including 4-state budget and character turnaround packs", async () => {
      const res = await axios.get(`${baseUrl}/api/v1/series/${testSeriesId}/reconciliation`);
      expect(res.status).toBe(200);
      expect(res.data.success).toBe(true);
      expect(res.data.summary).toBeDefined();
      expect(res.data.jobs).toBeDefined();
      expect(res.data.turnarounds).toBeDefined();
      expect(res.data.turnarounds.some((t: any) => t.characterName === "Nam")).toBe(true);
    });

    it("should run vertical slice via POST /api/v1/series/:id/vertical-slice/run", async () => {
      const res = await axios.post(`${baseUrl}/api/v1/series/${testSeriesId}/vertical-slice/run`, {
        episodeNumber: 1,
        chapterTitle: "Thử Nghiệm API",
        novelText: "Nam và Lan cùng bước vào phòng chỉ huy...",
        mockVideo: true,
        budgetCapUsd: 20,
      });

      expect(res.status).toBe(200);
      expect(res.data.success).toBe(true);
      expect(res.data.result.status).toBe("SUCCESS");
      expect(res.data.result.videoExecution.completedShots).toBe(5);
    });
  });
});
