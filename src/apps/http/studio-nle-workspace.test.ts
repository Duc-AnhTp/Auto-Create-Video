import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { StudioServer } from "../../bootstrap/studio-server.js";
import axios from "axios";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { SqliteStoryStore } from "../../bootstrap/sqlite-story-store.js";

describe("Studio NLE Workspace API: Takes, Approval & Narrative Graph", () => {
  let studio: StudioServer;
  let baseUrl: string;
  const testSeriesId = "nle-workspace-series";
  const episodeNumber = 1;

  beforeAll(async () => {
    studio = new StudioServer({ port: 0, queuePath: ":memory:", workersEnabled: false });
    baseUrl = await studio.start();

    // 1. Initialize Series in SQLite
    const dbDir = join("data", "series", testSeriesId);
    mkdirSync(dbDir, { recursive: true });
    const dbPath = join(dbDir, "story_bible.db");
    const bible = new SqliteStoryStore(dbPath);
    bible.upsertSeriesMetadata({
      id: testSeriesId,
      title: "Chiến Binh Thời Gian",
      aspect_ratio: "16:9",
      fps: 30,
    });

    // 2. Add sample characters, locations, and props to Story Bible
    bible.upsertCharacter({
      id: "char_nam",
      series_id: testSeriesId,
      name: "Nam",
      role: "protagonist",
      visual_summary: "Nam 28 tuổi, tóc đen ngắn, áo jacket da đen",
    });

    bible.upsertLocation({
      id: "loc_can_cu",
      series_id: testSeriesId,
      name: "Căn Cứ Bí Mật",
      visual_summary: "Căn hầm trú ẩn ngầm dưới lòng đất",
    });

    bible.upsertKeyProp({
      id: "prop_chia_khoa",
      series_id: testSeriesId,
      name: "Chìa Khóa Thời Gian",
      visual_summary: "Khối đa diện phát ánh sáng xanh lam huyền ảo",
      current_holder_id: "char_nam",
    });

    // Record prop transfer event in SQLite state_events
    bible.recordStateEvent({
      series_id: testSeriesId,
      episode_number: episodeNumber,
      entity_type: "prop",
      entity_id: "prop_chia_khoa",
      event_type: "prop_transfer",
      confirmation_source: "director_approval",
      from_state_json: JSON.stringify({ current_holder_id: "char_tien_boi" }),
      to_state_json: JSON.stringify({ current_holder_id: "char_nam" }),
      created_at: new Date().toISOString(),
    });

    // Register a Chekhov Gun (planted in ep 1)
    bible.plantChekhovGun({
      id: "gun_bom_hen_gio",
      series_id: testSeriesId,
      name: "Quả bom hẹn giờ",
      type: "threat",
      description: "Quả bom hẹn giờ dưới gầm bàn",
      planted_at_episode: episodeNumber,
      payoff_status: "planted",
    });

    // 3. Register Shot Takes for episode 1
    bible.recordShotTake({
      id: "take_shot1_1",
      series_id: testSeriesId,
      episode_number: episodeNumber,
      shot_id: "shot_1",
      take_number: 1,
      provider: "mock",
      prompt: "Cận cảnh Nam mở chiếc vali",
      duration_sec: 5,
      local_path: "output/series/nle-workspace-series/ep-01/shot_1_take_1.mp4",
      is_approved: false,
      qa_score: 0.72,
      qa_status: "WARN",
      qa_notes: "Góc quay hơi tối",
    });

    bible.recordShotTake({
      id: "take_shot1_2",
      series_id: testSeriesId,
      episode_number: episodeNumber,
      shot_id: "shot_1",
      take_number: 2,
      provider: "local_comfyui",
      prompt: "Cận cảnh Nam mở chiếc vali ánh sáng neon",
      duration_sec: 5,
      local_path: "output/series/nle-workspace-series/ep-01/shot_1_take_2.mp4",
      is_approved: false,
      qa_score: 0.94,
      qa_status: "PASS",
      qa_notes: "Ánh sáng hoàn hảo, khớp ArcFace 512-D 94%",
    });

    bible.recordShotTake({
      id: "take_shot2_1",
      series_id: testSeriesId,
      episode_number: episodeNumber,
      shot_id: "shot_2",
      take_number: 1,
      provider: "mock",
      prompt: "Toàn cảnh căn phòng sáng đèn",
      duration_sec: 5,
      local_path: "output/series/nle-workspace-series/ep-01/shot_2_take_1.mp4",
      is_approved: true,
      qa_score: 0.88,
      qa_status: "PASS",
    });

    bible.close();

    // 4. Create sample timeline.json on disk to verify non-destructive approval assembly update
    const epDir = resolve("output", "series", testSeriesId, "ep-01");
    mkdirSync(epDir, { recursive: true });
    const timelineData = {
      seriesId: testSeriesId,
      episodeNumber,
      fps: 30,
      targetTotalDurationSec: 10,
      videoTrack: [
        {
          shotId: "shot_1",
          durationSec: 5,
          visualPrompt: "Cận cảnh Nam mở chiếc vali",
          approvedClipPath: "output/series/nle-workspace-series/ep-01/shot_1_take_1.mp4",
        },
        {
          shotId: "shot_2",
          durationSec: 5,
          visualPrompt: "Toàn cảnh căn phòng sáng đèn",
          approvedClipPath: "output/series/nle-workspace-series/ep-01/shot_2_take_1.mp4",
        },
      ],
      stems: {
        dialogue: "output/series/nle-workspace-series/ep-01/stems/dialogue.wav",
        bgm: "output/series/nle-workspace-series/ep-01/stems/bgm.wav",
      },
    };
    writeFileSync(join(epDir, "timeline.json"), JSON.stringify(timelineData, null, 2), "utf8");
  });

  afterAll(async () => {
    await studio.close();
    SqliteStoryStore.closeAll();
    const dataDir = join("data", "series", testSeriesId);
    if (existsSync(dataDir)) {
      try {
        await rm(dataDir, { recursive: true, force: true });
      } catch {}
    }
    const outputDir = resolve("output", "series", testSeriesId);
    if (existsSync(outputDir)) {
      try {
        await rm(outputDir, { recursive: true, force: true });
      } catch {}
    }
  });

  it("1. GET /api/v1/series/:id/episodes/:ep/takes returns all shot takes with QA metrics", async () => {
    const res = await axios.get(`${baseUrl}/api/v1/series/${testSeriesId}/episodes/${episodeNumber}/takes`);
    expect(res.status).toBe(200);
    expect(res.data.takes).toBeDefined();
    expect(Array.isArray(res.data.takes)).toBe(true);
    expect(res.data.takes.length).toBe(3);

    // Verify take fields
    const take2 = res.data.takes.find((t: any) => t.shot_id === "shot_1" && t.take_number === 2);
    expect(take2).toBeDefined();
    expect(take2.provider).toBe("local_comfyui");
    expect(take2.qa_score).toBe(0.94);
    expect(take2.qa_status).toBe("PASS");
    expect(take2.qa_notes).toContain("ArcFace");
    expect(take2.is_approved).toBe(false);
  });

  it("2. GET /api/v1/series/:id/episodes/:ep/takes?shotId=shot_1 filters correctly", async () => {
    const res = await axios.get(`${baseUrl}/api/v1/series/${testSeriesId}/episodes/${episodeNumber}/takes?shotId=shot_1`);
    expect(res.status).toBe(200);
    expect(res.data.takes.length).toBe(2);
    expect(res.data.takes.every((t: any) => t.shot_id === "shot_1")).toBe(true);
  });

  it("3. POST /api/v1/series/:id/episodes/:ep/shots/:shotId/approve approves take and updates timeline.json", async () => {
    // Find take 2's id
    const takesRes = await axios.get(`${baseUrl}/api/v1/series/${testSeriesId}/episodes/${episodeNumber}/takes?shotId=shot_1`);
    const take2 = takesRes.data.takes.find((t: any) => t.take_number === 2);
    expect(take2).toBeDefined();

    // Call approve endpoint
    const approveRes = await axios.post(
      `${baseUrl}/api/v1/series/${testSeriesId}/episodes/${episodeNumber}/shots/shot_1/approve`,
      { takeId: take2.id }
    );
    expect(approveRes.status).toBe(200);
    expect(approveRes.data.success).toBe(true);
    expect(approveRes.data.approvedTake).toBeDefined();
    expect(approveRes.data.approvedTake.is_approved).toBe(true);

    // Check that timeline.json was non-destructively updated with new take's clip path
    const epDir = resolve("output", "series", testSeriesId, "ep-01");
    const timelinePath = join(epDir, "timeline.json");
    const raw = JSON.parse(await import("node:fs").then((m) => m.readFileSync(timelinePath, "utf8")));
    const shot1 = raw.videoTrack.find((s: any) => s.shotId === "shot_1");
    expect(shot1.approvedClipPath).toBe("output/series/nle-workspace-series/ep-01/shot_1_take_2.mp4");
  });

  it("4. GET /api/v1/series/:id/narrative-graph returns nodes, edges, prop ledger and Chekhov guns", async () => {
    const res = await axios.get(`${baseUrl}/api/v1/series/${testSeriesId}/narrative-graph`);
    expect(res.status).toBe(200);
    expect(res.data.nodes).toBeDefined();
    expect(res.data.edges).toBeDefined();
    expect(res.data.propLedger).toBeDefined();
    expect(res.data.chekhovGuns).toBeDefined();

    // Check nodes (character, location, prop)
    const charNode = res.data.nodes.find((n: any) => n.id === "char_nam");
    expect(charNode).toBeDefined();
    expect(charNode.type).toBe("character");
    expect(charNode.label).toBe("Nam");

    const locNode = res.data.nodes.find((n: any) => n.id === "loc_can_cu");
    expect(locNode).toBeDefined();
    expect(locNode.type).toBe("location");

    const propNode = res.data.nodes.find((n: any) => n.id === "prop_chia_khoa");
    expect(propNode).toBeDefined();
    expect(propNode.type).toBe("prop");

    // Check edge for prop custody
    const heldEdge = res.data.edges.find((e: any) => e.source === "prop_chia_khoa" && e.target === "char_nam");
    expect(heldEdge).toBeDefined();
    expect(heldEdge.relation).toBe("held_by");

    // Check prop transfer provenance ledger
    expect(res.data.propLedger.length).toBeGreaterThanOrEqual(1);
    const transfer = res.data.propLedger[0];
    expect(transfer.propId).toBe("prop_chia_khoa");
    expect(transfer.fromHolder).toBe("char_tien_boi");
    expect(transfer.toHolder).toBe("char_nam");

    // Check Chekhov gun
    expect(res.data.chekhovGuns.length).toBeGreaterThanOrEqual(1);
    const gun = res.data.chekhovGuns.find((g: any) => g.id === "gun_bom_hen_gio");
    expect(gun).toBeDefined();
    expect(gun.plantedEpisode).toBe(episodeNumber);
  });

  it("5. Standalone Cinema API routes (/api/series/...) mirror /api/v1 routes correctly", async () => {
    // Test standalone takes route
    const takesRes = await axios.get(`${baseUrl}/api/series/${testSeriesId}/episodes/${episodeNumber}/takes`);
    expect(takesRes.status).toBe(200);
    expect(takesRes.data.takes.length).toBe(3);

    // Test standalone narrative graph route
    const graphRes = await axios.get(`${baseUrl}/api/series/${testSeriesId}/narrative-graph`);
    expect(graphRes.status).toBe(200);
    expect(graphRes.data.nodes.length).toBeGreaterThanOrEqual(3);
  });
});
