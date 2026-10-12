import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { LocalSemanticVectorizer, SemanticMemoryEngine } from "./semantic-memory.js";
import { SqliteStoryStore } from "../../../bootstrap/sqlite-story-store.js";
import { ContextBuilder } from "./analysis/context-builder.js";
import { mkdirSync, existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import { join } from "node:path";

describe("Pillar 1: Semantic Vector Memory & Dynamic Context Pruning", () => {
  describe("LocalSemanticVectorizer", () => {
    it("1. Tokenizes Vietnamese and English text preserving Unicode accents", () => {
      const tokens = LocalSemanticVectorizer.tokenize("Nam tìm thấy Chìa Khóa Thời Gian trong căn hầm bí mật.");
      expect(tokens).toContain("nam");
      expect(tokens).toContain("thấy");
      expect(tokens).toContain("chìa");
      expect(tokens).toContain("khóa");
      expect(tokens).toContain("thời");
      expect(tokens).toContain("gian");
      // Contains 3-grams
      expect(tokens.some((t) => t.length === 3)).toBe(true);
    });

    it("2. Produces unit L2-normalized 128-dimensional vectors", () => {
      const vec = LocalSemanticVectorizer.embed("Chiến binh không gian khám phá hành tinh lạ");
      expect(vec.length).toBe(128);

      let norm = 0;
      for (let i = 0; i < vec.length; i++) {
        norm += vec[i] * vec[i];
      }
      expect(Math.abs(Math.sqrt(norm) - 1.0)).toBeLessThan(1e-5);
    });

    it("3. Calculates high cosine similarity for semantically close text and low for disjoint text", () => {
      const textA = "Nam cầm chiếc chìa khóa thời gian phát sáng";
      const textB = "Nam mở hộp chứa chìa khóa thời gian";
      const textDisjoint = "Nấu món phở bò thơm ngon truyền thống";

      const vecA = LocalSemanticVectorizer.embed(textA);
      const vecB = LocalSemanticVectorizer.embed(textB);
      const vecDisjoint = LocalSemanticVectorizer.embed(textDisjoint);

      const simClose = LocalSemanticVectorizer.cosineSimilarity(vecA, vecB);
      const simDisjoint = LocalSemanticVectorizer.cosineSimilarity(vecA, vecDisjoint);

      expect(simClose).toBeGreaterThan(0.5);
      expect(simDisjoint).toBeLessThan(0.3);
      expect(simClose).toBeGreaterThan(simDisjoint);
    });

    it("4. Self-similarity is exactly 1.0", () => {
      const vec = LocalSemanticVectorizer.embed("Bí mật căn hầm số 7");
      const selfSim = LocalSemanticVectorizer.cosineSimilarity(vec, vec);
      expect(Math.abs(selfSim - 1.0)).toBeLessThan(1e-5);
    });
  });

  describe("SemanticMemoryEngine & Story Bible Indexing", () => {
    const testSeriesId = "semantic-memory-test-series";
    let bible: SqliteStoryStore;
    const dbDir = join("data", "series", testSeriesId);

    beforeAll(() => {
      mkdirSync(dbDir, { recursive: true });
      bible = new SqliteStoryStore(join(dbDir, "story_bible.db"));

      bible.upsertSeriesMetadata({
        id: testSeriesId,
        title: "Kỷ Nguyên Không Gian",
        genre: "Sci-Fi",
      });

      bible.upsertCharacter({
        id: "char_nam",
        series_id: testSeriesId,
        name: "Nam",
        role: "protagonist",
        status: "alive",
        visual_summary: "Nam 28 tuổi, cựu đặc nhiệm công nghệ cao",
        personality_traits: ["quyết đoán", "cẩn trọng"],
      });

      bible.upsertCharacter({
        id: "char_quynh",
        series_id: testSeriesId,
        name: "Quỳnh",
        role: "supporting",
        status: "alive",
        visual_summary: "Quỳnh, nữ hacker thiên tài với mái tóc nhuộm bạc",
        personality_traits: ["thông minh", "tinh nghịch"],
      });

      bible.upsertCharacter({
        id: "char_ba_lao",
        series_id: testSeriesId,
        name: "Bà Lão Bán Nước",
        role: "minor",
        status: "alive",
        visual_summary: "Bà lão 70 tuổi ngồi bán trà đá đầu ngõ",
      });

      bible.upsertKeyProp({
        id: "prop_chia_khoa",
        series_id: testSeriesId,
        name: "Chìa Khóa Lượng Tử",
        description: "Khối pha lê phát sáng chứa mã điều khiển trạm không gian",
        current_holder_id: "char_nam",
      });

      bible.upsertKeyProp({
        id: "prop_am_tra",
        series_id: testSeriesId,
        name: "Ấm Trà Đất Nung",
        description: "Ấm sứt vòi của bà lão",
        current_holder_id: "char_ba_lao",
      });

      bible.upsertLocation({
        id: "loc_tram_khong_gian",
        series_id: testSeriesId,
        name: "Trạm Không Gian Alpha",
        visual_summary: "Trạm không gian khổng lồ lơ lửng trên quỹ đạo",
        lighting_mood: "Ánh sáng neon lạnh và tia vũ trụ",
      });

      bible.setWorldState("nuclear_core_status", "overheating", 1, testSeriesId);
      bible.setWorldState("oxygen_level", "critical", 1, testSeriesId);

      bible.recordEpisodeSummary({
        episode_number: 1,
        series_id: testSeriesId,
        title: "Tia Lửa Đầu Tiên",
        logline: "Nam xâm nhập trạm không gian và đoạt lấy Chìa Khóa Lượng Tử",
        major_events: ["Nam đột nhập", "Đoạt Chìa Khóa Lượng Tử"],
        delta_changes: {},
      });
    });

    afterAll(async () => {
      bible.close();
      SqliteStoryStore.closeAll();
      if (existsSync(dbDir)) {
        try {
          await rm(dbDir, { recursive: true, force: true });
        } catch {}
      }
    });

    it("5. Indexes characters, props, locations, world rules, and past summaries into semantic vectors", () => {
      const engine = new SemanticMemoryEngine();
      const count = engine.indexStoryBible(bible, testSeriesId, 2);
      expect(count).toBeGreaterThanOrEqual(6);
      expect(engine.size()).toBe(count);
    });

    it("6. Semantic KNN query prioritizes relevant entities over irrelevant background entities", () => {
      const engine = new SemanticMemoryEngine();
      engine.indexStoryBible(bible, testSeriesId, 2);

      const results = engine.queryRelevant("Nam và Quỳnh khởi động Chìa Khóa Lượng Tử tại Trạm Không Gian", {
        topK: 5,
        minSimilarity: 0.1,
      });

      expect(results.length).toBeGreaterThanOrEqual(3);

      const topIds = results.map((r) => r.id);
      // High relevance entities should be ranked near top
      expect(topIds.some((id) => id.includes("char_char_nam") || id.includes("prop_prop_chia_khoa"))).toBe(true);

      // Irrelevant entity (bà lão bán nước, ấm trà đất nung) should NOT be at the very top
      const topFirst = results[0];
      expect(topFirst.id).not.toContain("prop_am_tra");
    });

    it("7. Dynamic context pruning fits relevant knowledge within token budget", () => {
      const engine = new SemanticMemoryEngine();
      engine.indexStoryBible(bible, testSeriesId, 2);

      const allChars = bible.listCharacters(testSeriesId);
      const allProps = bible.listKeyProps(testSeriesId);
      const allLocs = bible.listLocations(testSeriesId);

      const pruned = engine.pruneContextForEpisode(
        "Nam đối mặt nguy cơ lõi phản ứng trạm không gian phát nổ, cần Chìa Khóa Lượng Tử",
        allChars,
        allProps,
        allLocs,
        1500, // Token budget
        { currentEpisode: 2 }
      );

      expect(pruned.relevantCharacters.some((c) => c.id === "char_nam")).toBe(true);
      expect(pruned.relevantProps.some((p) => p.id === "prop_chia_khoa")).toBe(true);
      expect(pruned.relevantRules.some((r) => r.includes("nuclear_core_status"))).toBe(true);
      expect(pruned.estimatedTokens).toBeLessThanOrEqual(1500);
    });

    it("8. Integrates with ContextBuilder.buildEpisodeContext with enableDynamicPruning: true", () => {
      const context = ContextBuilder.buildEpisodeContext(bible, {
        seriesId: testSeriesId,
        episodeNumber: 2,
        maxTokensBudget: 3500,
        enableDynamicPruning: true,
      });

      expect(context).toBeDefined();
      expect(context.semanticPrunedContext).toBeDefined();
      expect(context.semanticPrunedContext!.relevantCharacters.length).toBeGreaterThanOrEqual(1);
      expect(context.activeCharacters.some((c) => c.id === "char_nam")).toBe(true);
      expect(context.tokenEstimate).toBeGreaterThan(0);
    });
  });
});
