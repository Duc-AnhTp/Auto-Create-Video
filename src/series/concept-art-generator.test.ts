import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { ConceptArtGenerator, generateSyntheticFaceEmbedding } from "./concept-art-generator.js";
import { BibleManager } from "../bible/bible-manager.js";
import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("Character & Location Concept Art T2I Generator", () => {
  let bible: BibleManager;
  const seriesId = "test-art-series";
  const testOutputDir = join(tmpdir(), `test_art_${Date.now()}`);

  beforeEach(() => {
    BibleManager.closeAll();
    bible = new BibleManager(":memory:");

    bible.upsertSeriesMetadata({
      id: seriesId,
      title: "Sài Gòn 2088",
      genre: "Cyberpunk Action",
      visual_style: "Cinematic 35mm, neon noir, anamorphic lens",
      aspect_ratio: "9:16",
      fps: 30,
      created_at: new Date().toISOString(),
    });

    bible.upsertCharacter({
      id: "char_minh",
      series_id: seriesId,
      name: "Minh",
      role: "protagonist",
      visual_summary: "Minh, 30 tuổi, áo khoác da sờn vai",
      distinguishing_marks: "vết sẹo dài trên lông mày trái",
      status: "alive",
    });

    bible.upsertLocation({
      id: "loc_quan_bar",
      series_id: seriesId,
      name: "Quán Bar Hẻm 9",
      visual_summary: "Quán bar ngầm u tối với bảng hiệu neon chập chờn",
      lighting_mood: "neon tím và xanh lục",
      atmospheric_rules: "khói thuốc lảng bảng và sàn gỗ ẩm ướt",
    });
  });

  afterEach(async () => {
    BibleManager.closeAll();
    if (existsSync(testOutputDir)) {
      try {
        await rm(testOutputDir, { recursive: true, force: true });
      } catch {}
    }
  });

  it("1. Generates character concept art, stores image to disk, and anchors face embedding in Story Bible", async () => {
    const generator = new ConceptArtGenerator(bible);

    const result = await generator.generateCharacterConceptArt({
      seriesId,
      characterId: "char_minh",
      outputDir: join(testOutputDir, "characters"),
      provider: "mock",
    });

    expect(result.entityType).toBe("character");
    expect(result.entityId).toBe("char_minh");
    expect(existsSync(result.imagePath)).toBe(true);
    expect(result.fileSizeBytes).toBeGreaterThan(100);
    expect(result.prompt).toContain("Cinematic 35mm, neon noir");
    expect(result.prompt).toContain("vết sẹo dài trên lông mày trái");

    // Verify 512-D face embedding
    expect(result.faceEmbedding).toBeDefined();
    expect(result.faceEmbedding?.length).toBe(512);

    // Verify L2 norm is ~ 1.0
    let sumSq = 0;
    for (const v of result.faceEmbedding!) sumSq += v * v;
    expect(Math.sqrt(sumSq)).toBeCloseTo(1.0, 3);

    // Verify Story Bible has updated face_reference_image
    const updatedChar = bible.getCharacter("char_minh");
    expect(updatedChar?.face_reference_image).toBe(result.imagePath);
  });

  it("2. Generates location concept art, stores image to disk, and anchors reference in Story Bible", async () => {
    const generator = new ConceptArtGenerator(bible);

    const result = await generator.generateLocationConceptArt({
      seriesId,
      locationId: "loc_quan_bar",
      outputDir: join(testOutputDir, "locations"),
      provider: "mock",
    });

    expect(result.entityType).toBe("location");
    expect(result.entityId).toBe("loc_quan_bar");
    expect(existsSync(result.imagePath)).toBe(true);
    expect(result.fileSizeBytes).toBeGreaterThan(100);
    expect(result.prompt).toContain("Quán Bar Hẻm 9");
    expect(result.prompt).toContain("neon tím và xanh lục");

    // Verify Story Bible has updated reference_image_path
    const updatedLoc = bible.getLocation("loc_quan_bar");
    expect(updatedLoc?.reference_image_path).toBe(result.imagePath);
  });

  it("3. Produces deterministic 512-D face embeddings for the same character", () => {
    const vec1 = generateSyntheticFaceEmbedding("cyber_char_minh");
    const vec2 = generateSyntheticFaceEmbedding("cyber_char_minh");
    const vecOther = generateSyntheticFaceEmbedding("cyber_char_an");

    expect(vec1).toEqual(vec2);
    expect(vec1).not.toEqual(vecOther);
  });

  it("4. Gracefully fails when requested character does not exist in Story Bible", async () => {
    const generator = new ConceptArtGenerator(bible);

    await expect(
      generator.generateCharacterConceptArt({
        seriesId,
        characterId: "non_existent_char",
      })
    ).rejects.toThrow(/không tồn tại/);
  });
});
