import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { ConceptArtGenerator } from "./concept-art-generator.js";
import { BibleManager } from "../bible/bible-manager.js";
import { ComfyUiAdapter } from "../gateway/adapters/comfyui-adapter.js";
import { PROVIDER_CAPABILITY_REGISTRY } from "../gateway/provider-capabilities.js";
import type { ShotExecutionSpec } from "../gateway/video-gateway.js";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("Phase 3: Visual Consistency & Multi-Subject Regional Conditioning", () => {
  let tempDir: string;
  let bible: BibleManager;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "phase3-consistency-test-"));
    bible = new BibleManager(":memory:", { allowMemoryFallback: true });
    bible.upsertSeriesMetadata({
      id: "series_cyber",
      title: "Cyber Sài Gòn",
      visual_style: "Cinematic Neo-noir, anamorphic lens, rain-soaked reflections",
    });
    bible.upsertCharacter({
      id: "char_minh",
      name: "Minh",
      series_id: "series_cyber",
      role: "protagonist",
      visual_summary: "Nam thám tử 32 tuổi, áo măng tô đen, ánh mắt sắc lạnh",
      distinguishing_marks: "Vết sẹo nhỏ ngang đuôi lông mày phải",
    });
  });

  afterEach(() => {
    try {
      if (existsSync(tempDir)) {
        rmSync(tempDir, { recursive: true, force: true });
      }
    } catch {}
  });

  it("generateCharacterTurnaroundPack creates a 4-view character sheet anchoring facial consistency", async () => {
    const generator = new ConceptArtGenerator(bible);
    const turnaround = await generator.generateCharacterTurnaroundPack({
      seriesId: "series_cyber",
      characterId: "char_minh",
      outputDir: tempDir,
      allowMock: true,
      provider: "mock",
    });

    expect(turnaround.characterId).toBe("char_minh");
    expect(turnaround.seriesId).toBe("series_cyber");

    // Verify all 4 canonical views were generated
    expect(turnaround.views.front).toBeDefined();
    expect(turnaround.views.threeQuarter).toBeDefined();
    expect(turnaround.views.profile).toBeDefined();
    expect(turnaround.views.fullBody).toBeDefined();

    expect(turnaround.views.front.prompt).toContain("Full frontal portrait");
    expect(turnaround.views.threeQuarter.prompt).toContain("Three-quarter angle portrait");
    expect(turnaround.views.profile.prompt).toContain("Side profile shot");
    expect(turnaround.views.fullBody.prompt).toContain("Full body shot");

    expect(existsSync(turnaround.views.front.imagePath)).toBe(true);
    expect(existsSync(turnaround.views.threeQuarter.imagePath)).toBe(true);
    expect(existsSync(turnaround.views.profile.imagePath)).toBe(true);
    expect(existsSync(turnaround.views.fullBody.imagePath)).toBe(true);

    // Verify face embedding is 512-D and normalized
    expect(turnaround.faceEmbedding.length).toBe(512);
    const sumSq = turnaround.faceEmbedding.reduce((acc, v) => acc + v * v, 0);
    expect(Math.abs(sumSq - 1.0)).toBeLessThan(0.01);

    // Verify Story Bible was updated
    const updatedChar = bible.getCharacter("char_minh", "series_cyber");
    expect(updatedChar?.face_reference_image).toBe(turnaround.views.front.imagePath);
    expect(updatedChar?.character_sheet_path).toBe(turnaround.views.front.imagePath);
    expect(updatedChar?.face_embedding_json).toBeDefined();
  });

  it("ComfyUiAdapter constructs dual IP-Adapter graph for secondary character face conditioning", () => {
    const adapter = new ComfyUiAdapter();
    const spec: ShotExecutionSpec = {
      shotId: "sc01_sh02",
      backend: "local_comfyui",
      priority: "standard",
      durationSec: 4.0,
      prompt: "Two characters conversing at a cafe table",
      characterReferenceImage: "char_a.jpg",
      secondaryCharacterReferenceImage: "char_b.jpg",
      regionalConditioning: {
        enabled: true,
        characterAPrompt: "Minh in black coat looking intensely",
        characterBPrompt: "Lan in red jacket listening calmly",
        characterASide: "left",
        characterBSide: "right",
      },
    };

    const workflow = adapter.buildPromptWorkflow(
      spec,
      undefined,
      "uploaded_minh_face.jpg",
      "uploaded_lan_face.jpg"
    ) as any;

    // Check node 17 (secondary character image load)
    expect(workflow["17"]).toBeDefined();
    expect(workflow["17"].inputs.image).toBe("uploaded_lan_face.jpg");

    // Check node 18 (secondary IPAdapterApply chained from node 14)
    expect(workflow["18"]).toBeDefined();
    expect(workflow["18"].inputs.image).toEqual(["17", 0]);
    expect(workflow["18"].inputs.model).toEqual(["14", 0]);

    // KSampler model input should be node 18
    expect(workflow["3"].inputs.model).toEqual(["18", 0]);

    // Positive prompt text should contain regional spatial layout
    const positiveText = workflow["6"].inputs.text;
    expect(positiveText).toContain("[REGIONAL: left side: Minh in black coat");
    expect(positiveText).toContain("right side: Lan in red jacket");
  });

  it("PROVIDER_CAPABILITY_REGISTRY correctly advertises regional conditioning support", () => {
    expect(PROVIDER_CAPABILITY_REGISTRY.local_comfyui.supportsRegionalConditioning).toBe(true);
    expect(PROVIDER_CAPABILITY_REGISTRY.serverless_comfyui.supportsRegionalConditioning).toBe(true);
  });
});
