import { describe, it, expect, beforeAll, afterAll } from "vitest";

import { SqliteStoryStore } from "../../../../bootstrap/sqlite-story-store.js";
import { StudioServer } from "../../../../bootstrap/studio-server.js";
import axios from "axios";
import { mkdirSync, existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import { join } from "node:path";

describe("Pillar 3: Branching Timeline & Multiverse Engine", () => {
  const testSeriesId = "timeline-multiverse-series";
  let bible: SqliteStoryStore;
  let studio: StudioServer;
  let baseUrl: string;
  const dbDir = join("data", "series", testSeriesId);

  beforeAll(async () => {
    mkdirSync(dbDir, { recursive: true });
    bible = new SqliteStoryStore(join(dbDir, "story_bible.db"));

    bible.upsertSeriesMetadata({
      id: testSeriesId,
      title: "Vũ Trụ Song Song",
      aspect_ratio: "16:9",
    });

    // 1. Establish Ep 1 initial characters and prop
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
      status: "alive",
    });

    bible.upsertKeyProp({
      id: "prop_vong_thoi_gian",
      series_id: testSeriesId,
      name: "Vòng Xoay Thời Gian",
      current_holder_id: "char_nam",
    });

    // Create Canon Snapshot for Ep 1
    const snap1 = bible.createCanonSnapshot(testSeriesId, 1, 1);
    expect(snap1.id).toBeDefined();

    // Start Studio server for REST endpoint verification
    studio = new StudioServer({ port: 0, queuePath: ":memory:", workersEnabled: false });
    baseUrl = await studio.start();
  });

  afterAll(async () => {
    await studio.close();
    bible.close();
    SqliteStoryStore.closeAll();
    if (existsSync(dbDir)) {
      try {
        await rm(dbDir, { recursive: true, force: true });
      } catch {}
    }
  });

  describe("Branch Lifecycle: Root Branch & Forking", () => {
    it("1. Automatically initializes and ensures root canonical branch ('main')", () => {
      const root = bible.ensureRootCanonicalBranch(testSeriesId);
      expect(root).toBeDefined();
      expect(root.is_canonical).toBe(1);
      expect(root.name).toBe("Canon Main");
      expect(root.series_id).toBe(testSeriesId);

      const active = bible.getActiveCanonicalBranch(testSeriesId);
      expect(active?.id).toBe(root.id);
    });

    it("2. Forks an alternate 'What-If' branch from an existing snapshot", () => {
      const whatIfBranch = bible.forkBranch(testSeriesId, {
        name: "What-If Hùng Không Phản Bội",
        description: "Dòng thời gian giả định Hùng và Nam cùng hợp tác",
        fromEpisodeNumber: 1,
      });

      expect(whatIfBranch).toBeDefined();
      expect(whatIfBranch.is_canonical).toBe(0);
      expect(whatIfBranch.forked_at_episode).toBe(1);
      expect(whatIfBranch.name).toBe("What-If Hùng Không Phản Bội");

      const allBranches = bible.listBranches(testSeriesId);
      expect(allBranches.length).toBeGreaterThanOrEqual(2);
      expect(allBranches.some((b) => b.id === whatIfBranch.id)).toBe(true);
    });
  });

  describe("Multiverse Branch State Isolation & State Diff", () => {
    it("3. Compares multiverse branch divergence and detects character and prop holder differences", () => {
      const root = bible.getActiveCanonicalBranch(testSeriesId)!;
      const branches = bible.listBranches(testSeriesId);
      const whatIfBranch = branches.find((b) => b.is_canonical === 0)!;

      // On Main Branch (Canon): Hùng is killed in Ep 2 and Nam loses prop
      bible.upsertCharacter({
        id: "char_hung",
        series_id: testSeriesId,
        name: "Hùng",
        role: "antagonist",
        status: "deceased",
      });
      bible.upsertKeyProp({
        id: "prop_vong_thoi_gian",
        series_id: testSeriesId,
        name: "Vòng Xoay Thời Gian",
        current_holder_id: "char_hung",
      });
      const snapMainEp2 = bible.createCanonSnapshot(testSeriesId, 2, 1);
      bible.branchManager.bindSnapshotToBranch(root.id, 2, snapMainEp2.id);

      // On What-If Branch: Hùng survives (status 'alive') and Nam keeps prop
      bible.upsertCharacter({
        id: "char_hung",
        series_id: testSeriesId,
        name: "Hùng",
        role: "antagonist",
        status: "alive",
      });
      bible.upsertKeyProp({
        id: "prop_vong_thoi_gian",
        series_id: testSeriesId,
        name: "Vòng Xoay Thời Gian",
        current_holder_id: "char_nam",
      });
      bible.createCanonSnapshot(testSeriesId, 2, 2, whatIfBranch.id);

      // Compare the two multiverse branches
      const diff = bible.compareBranches(testSeriesId, root.id, whatIfBranch.id);

      expect(diff).toBeDefined();
      expect(diff.divergentEpisodes).toContain(2);

      // Verify character status difference
      const hungDiff = diff.characterStatusDiffs.find((c) => c.characterId === "char_hung");
      expect(hungDiff).toBeDefined();
      expect(hungDiff?.statusInBranchA).toBe("deceased");
      expect(hungDiff?.statusInBranchB).toBe("alive");

      // Verify prop holder difference
      const propDiff = diff.propHolderDiffs.find((p) => p.propId === "prop_vong_thoi_gian");
      expect(propDiff).toBeDefined();
      expect(propDiff?.holderInBranchA).toBe("char_hung");
      expect(propDiff?.holderInBranchB).toBe("char_nam");
    });

    it("4. Promotes a What-If branch to canonical atomically", () => {
      const branches = bible.listBranches(testSeriesId);
      const whatIfBranch = branches.find((b) => b.is_canonical === 0)!;

      bible.promoteBranchToCanonical(testSeriesId, whatIfBranch.id);

      const activeNow = bible.getActiveCanonicalBranch(testSeriesId);
      expect(activeNow?.id).toBe(whatIfBranch.id);
      expect(activeNow?.is_canonical).toBe(1);

      // Root branch is now non-canonical
      const allBranches = bible.listBranches(testSeriesId);
      const oldRoot = allBranches.find((b) => b.name === "Canon Main");
      expect(oldRoot?.is_canonical).toBe(0);
    });
  });

  describe("REST API Endpoints: Timeline Branches", () => {
    it("5. GET /api/v1/series/:id/branches returns list of branches", async () => {
      const res = await axios.get(`${baseUrl}/api/v1/series/${testSeriesId}/branches`);
      expect(res.status).toBe(200);
      expect(res.data.success).toBe(true);
      expect(Array.isArray(res.data.branches)).toBe(true);
      expect(res.data.branches.length).toBeGreaterThanOrEqual(2);
    });

    it("6. POST /api/v1/series/:id/branches/fork creates new branch via REST", async () => {
      const res = await axios.post(`${baseUrl}/api/v1/series/${testSeriesId}/branches/fork`, {
        name: "Branch REST Alternate",
        description: "Tạo nhánh qua API REST",
        fromEpisodeNumber: 1,
      });

      expect(res.status).toBe(201);
      expect(res.data.success).toBe(true);
      expect(res.data.branch).toBeDefined();
      expect(res.data.branch.name).toBe("Branch REST Alternate");
    });

    it("7. GET /api/v1/series/:id/branches/compare compares two branches via REST", async () => {
      const branchesRes = await axios.get(`${baseUrl}/api/v1/series/${testSeriesId}/branches`);
      const branches = branchesRes.data.branches;
      const b1 = branches[0];
      const b2 = branches[1];

      const res = await axios.get(
        `${baseUrl}/api/v1/series/${testSeriesId}/branches/compare?branchA=${b1.id}&branchB=${b2.id}`
      );

      expect(res.status).toBe(200);
      expect(res.data.success).toBe(true);
      expect(res.data.diff).toBeDefined();
      expect(res.data.diff.seriesId).toBe(testSeriesId);
    });

    it("8. POST /api/v1/series/:id/branches/:id/activate activates branch via REST", async () => {
      const branchesRes = await axios.get(`${baseUrl}/api/v1/series/${testSeriesId}/branches`);
      const targetBranch = branchesRes.data.branches[0];

      const res = await axios.post(
        `${baseUrl}/api/v1/series/${testSeriesId}/branches/${targetBranch.id}/activate`
      );

      expect(res.status).toBe(200);
      expect(res.data.success).toBe(true);
      expect(res.data.activeBranchId).toBe(targetBranch.id);
    });
  });
});
