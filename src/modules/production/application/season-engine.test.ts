import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { SqliteStoryStore } from "../../../bootstrap/sqlite-story-store.js";
import { SeasonArcController } from "../domain/season-arc-controller.js";
import { SeasonBudgetAllocator } from "../domain/season-budget-allocator.js";
import { MultiEpisodeRunner } from "../../../bootstrap/multi-episode-runtime.js";

describe("Option A: Multi-Episode Season Engine & Continuity", () => {
  const testSeriesId = "season_test_series_01";
  const testOutputDir = join("data", "test_season_output");
  let bible: SqliteStoryStore;

  beforeEach(() => {
    bible = new SqliteStoryStore(":memory:");
    bible.upsertSeriesMetadata({
      id: testSeriesId,
      title: "Chiến Binh Mùa Phim",
      aspect_ratio: "16:9",
      visual_style: "Cinematic 35mm Hollywood standard",
    });

    bible.upsertCharacter({
      id: "char_minh",
      name: "Minh",
      series_id: testSeriesId,
      role: "protagonist",
      visual_summary: "Áo khoác da đen, quần rằn ri",
    });

    bible.upsertCharacter({
      id: "char_lan",
      name: "Lan",
      series_id: testSeriesId,
      role: "supporting",
      visual_summary: "Trang phục chiến thuật màu xám",
    });

    bible.upsertKeyProp({
      id: "prop_mat_ma",
      name: "Chìa Khóa Mật Mã",
      series_id: testSeriesId,
      current_holder_id: "char_minh",
      description: "Thiết bị giải mã lượng tử cổ xưa",
    });
  });

  afterEach(async () => {
    bible.close();
    if (existsSync(testOutputDir)) {
      await rm(testOutputDir, { recursive: true, force: true }).catch(() => {});
    }
  });

  describe("1. SeasonArcController: Hollywood 3-Act Narrative Pacing Curves", () => {
    it("should compute correct tension scores and narrative acts across 10 episodes", () => {
      const ep1 = SeasonArcController.getEpisodePacingProfile(1, 10);
      expect(ep1.act).toBe("act_1_setup");
      expect(ep1.tensionScore).toBeGreaterThanOrEqual(0.35);
      expect(ep1.tensionScore).toBeLessThanOrEqual(0.48);
      expect(ep1.actionDensity).toBe("low");
      expect(ep1.heroShotRatio).toBe(0.20);
      expect(ep1.targetShotDurationSec).toBe(4.8);

      const ep3 = SeasonArcController.getEpisodePacingProfile(3, 10);
      expect(ep3.act).toBe("act_2a_rising");
      expect(ep3.tensionScore).toBeGreaterThanOrEqual(0.50);
      expect(ep3.actionDensity).toBe("medium");

      const ep5 = SeasonArcController.getEpisodePacingProfile(5, 10);
      expect(ep5.act).toBe("midpoint_reversal");
      expect(ep5.tensionScore).toBe(0.85); // Sharp midpoint spike
      expect(ep5.heroShotRatio).toBe(0.45);
      expect(ep5.recommendedCameraGrammar.lensStyle).toBe("handheld_shaky");

      const ep7 = SeasonArcController.getEpisodePacingProfile(7, 10);
      expect(ep7.act).toBe("act_2b_escalation");
      expect(ep7.tensionScore).toBeGreaterThanOrEqual(0.70);

      const ep9 = SeasonArcController.getEpisodePacingProfile(9, 10);
      expect(ep9.act).toBe("act_3_climax");
      expect(ep9.tensionScore).toBe(1.0); // Peak climax
      expect(ep9.heroShotRatio).toBe(0.55);
      expect(ep9.targetShotDurationSec).toBe(2.6); // Rapid dynamic editing

      const ep10 = SeasonArcController.getEpisodePacingProfile(10, 10);
      expect(ep10.act).toBe("resolution_cliffhanger");
      expect(ep10.tensionScore).toBe(0.60);
    });

    it("should capture and format cross-episode character continuity and wounds", () => {
      // Record a battle wound in Episode 1
      bible.recordStateEvent({
        series_id: testSeriesId, entity_type: "character", entity_id: "char_minh",
        episode_number: 1,
        event_type: "status_change",
        to_state_json: JSON.stringify({ distinguishing_marks: "Vết chém sâu ở bả vai phải" }),
        confirmation_source: "script_delta",
      });

      // Plant a Chekhov's gun in Episode 1 due for payoff in Episode 2
      bible.plantChekhovGun({
        id: "gun_dao_gam", name: "Dao găm", type: "prop", payoff_status: "planted",
        series_id: testSeriesId,
        description: "Con dao găm giấu trong ủng",
        planted_at_episode: 1,
        payoff_episode: 2,
      });

      const snapshot = SeasonArcController.extractCrossEpisodeState(bible, testSeriesId, 1);
      expect(snapshot.fromEpisode).toBe(1);
      expect(snapshot.toEpisode).toBe(2);

      const minhState = snapshot.characters.find((c) => c.characterId === "char_minh");
      expect(minhState).toBeDefined();
      expect(minhState?.wounds).toContain("Vết chém sâu ở bả vai phải");
      expect(minhState?.wardrobeDamage).toBe("torn");
      expect(minhState?.heldProps).toContain("Chìa Khóa Mật Mã");

      const gun = snapshot.activeChekhovGuns.find((g) => g.id === "gun_dao_gam");
      expect(gun).toBeDefined();
      expect(gun?.isDueForPayoff).toBe(true);

      const promptContext = SeasonArcController.formatContinuityContextPrompt(snapshot);
      expect(promptContext).toContain("Vết chém sâu ở bả vai phải");
      expect(promptContext).toContain("Chìa Khóa Mật Mã");
      expect(promptContext).toContain("SÚNG CHEKHOV CẦN ĐƯỢC GIẢI QUYẾT");
    });
  });

  describe("2. SeasonBudgetAllocator: Tension-Weighted Allocation & Dynamic Rebalancing", () => {
    it("should proportionally allocate $100 budget with higher weights on climax episodes", () => {
      const budgetPlan = SeasonBudgetAllocator.planSeasonBudget(testSeriesId, 100.0, 10);
      expect(budgetPlan.totalSeasonBudgetUsd).toBe(100.0);
      expect(budgetPlan.episodes.length).toBe(10);

      // Verify sum equals exactly total budget without floating point drift
      const sum = budgetPlan.episodes.reduce((acc, q) => acc + q.allocatedUsd, 0);
      expect(Math.abs(sum - 100.0)).toBeLessThanOrEqual(0.01);

      // Ep 1 (setup) should receive less budget than Ep 9 (climax)
      const ep1Quota = budgetPlan.episodes[0];
      const ep9Quota = budgetPlan.episodes[8];
      expect(ep9Quota.allocatedUsd).toBeGreaterThan(ep1Quota.allocatedUsd);
      expect(ep9Quota.weight).toBeGreaterThan(ep1Quota.weight);
    });

    it("should dynamically rebalance surplus funds forward when an episode spends under budget", () => {
      let budgetPlan = SeasonBudgetAllocator.planSeasonBudget(testSeriesId, 100.0, 5);
      const ep1InitialAllocated = budgetPlan.episodes[0].allocatedUsd;
      const ep5InitialAllocated = budgetPlan.episodes[4].allocatedUsd;

      // Suppose Episode 1 spends only $5.00 when allocated ~$15.00 (surplus ~$10.00)
      const actualSpendEp1 = 5.0;
      budgetPlan = SeasonBudgetAllocator.recordEpisodeSpend(budgetPlan, 1, actualSpendEp1);

      expect(budgetPlan.episodes[0].status).toBe("completed");
      expect(budgetPlan.episodes[0].spentUsd).toBe(5.0);

      // Ep 5 should have its allocation increased by the rebalanced surplus
      const ep5NewAllocated = budgetPlan.episodes[4].allocatedUsd;
      expect(ep5NewAllocated).toBeGreaterThan(ep5InitialAllocated);
    });
  });

  describe("3. MultiEpisodeRunner: Automated Continuous Multi-Episode Batch Production", () => {
    it("should execute a 3-episode season production batch end-to-end", async () => {
      const runner = new MultiEpisodeRunner(bible);
      const manifest = await runner.runSeason({
        seriesId: testSeriesId,
        totalEpisodes: 3,
        seasonBudgetUsd: 60.0,
        outputBaseDir: testOutputDir,
        enable4kPost: true,
        enableAutoBridge: true,
      });

      expect(manifest.seriesId).toBe(testSeriesId);
      expect(manifest.completedEpisodes).toBe(3);
      expect(manifest.episodes.length).toBe(3);
      expect(existsSync(manifest.manifestPath)).toBe(true);

      // Verify each episode produced screenplay and video artifacts
      for (const ep of manifest.episodes) {
        expect(ep.status).toBe("SUCCESS");
        expect(ep.durationSec).toBeGreaterThan(0);
        expect(ep.masterVideoPath).toBeDefined();
        if (ep.masterVideoPath) {
          expect(existsSync(ep.masterVideoPath)).toBe(true);
        }
        if (ep.final4kDeliveryPath) {
          expect(existsSync(ep.final4kDeliveryPath)).toBe(true);
        }
      }

      // Verify continuity state snapshot from Ep 1 to Ep 2
      const ep2 = manifest.episodes[1];
      expect(ep2.crossEpisodeState.fromEpisode).toBe(2);
      expect(ep2.crossEpisodeState.toEpisode).toBe(3);
    }, 45000);
  });
});
