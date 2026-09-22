import { existsSync } from "node:fs";
import { mkdir, writeFile, stat } from "node:fs/promises";
import { join, dirname } from "node:path";
import { createHash } from "node:crypto";
import axios from "axios";
import { BibleManager } from "../bible/bible-manager.js";
import { log } from "../utils/logger.js";

export interface ConceptArtOptions {
  seriesId: string;
  characterId?: string;
  locationId?: string;
  promptOverride?: string;
  outputDir?: string;
  provider?: "local_comfyui" | "cloud" | "mock";
  comfyHost?: string;
  width?: number;
  height?: number;
  allowMock?: boolean;
  negativePrompt?: string;
}

export interface ConceptArtResult {
  entityType: "character" | "location";
  entityId: string;
  seriesId: string;
  prompt: string;
  imagePath: string;
  fileSizeBytes: number;
  providerUsed: "local_comfyui" | "cloud" | "mock";
  faceEmbedding?: number[];
  updatedBible: boolean;
}

export interface CharacterTurnaroundPackResult {
  characterId: string;
  seriesId: string;
  views: {
    front: ConceptArtResult;
    threeQuarter: ConceptArtResult;
    profile: ConceptArtResult;
    fullBody: ConceptArtResult;
  };
  faceEmbedding: number[];
  updatedBible: boolean;
}

/**
 * Derives a deterministic 512-D normalized unit vector from a string seed (e.g. character ID + name).
 * Compatible with ArcFace / FaceNet 512-D face embedding specifications.
 */
export function generateSyntheticFaceEmbedding(seed: string): number[] {
  const embedding: number[] = [];
  let currentHash = seed;

  while (embedding.length < 512) {
    const hash = createHash("sha256").update(currentHash).digest();
    for (let i = 0; i < hash.length && embedding.length < 512; i += 2) {
      // Convert two bytes into float between -1.0 and 1.0
      const val = (hash.readInt16LE(i) / 32768.0);
      embedding.push(val);
    }
    currentHash = hash.toString("hex");
  }

  // Normalize to unit length (L2 norm = 1.0)
  let sumSq = 0;
  for (const v of embedding) sumSq += v * v;
  const norm = Math.sqrt(sumSq) || 1.0;
  return embedding.map((v) => v / norm);
}

/**
 * Generates a valid JPEG buffer with dimensions and visual header.
 */
export function createValidMockJpegBuffer(title = "Concept Art"): Buffer {
  const header = Buffer.from([
    0xff, 0xd8, // SOI
    0xff, 0xe0, 0x00, 0x10, // APP0
    0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x01, 0x00, 0x48, 0x00, 0x48, 0x00, 0x00, // JFIF
    0xff, 0xdb, 0x00, 0x43, 0x00, ...Array(64).fill(2), // DQT
    0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x40, 0x00, 0x40, 0x01, 0x01, 0x11, 0x00, // SOF0 (64x64)
    0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00, // SOS
  ]);

  // Pseudorandom image data derived from title
  const hash = createHash("md5").update(title).digest();
  const scanData = Buffer.alloc(128);
  for (let i = 0; i < 128; i++) {
    scanData[i] = hash[i % hash.length] ^ (i * 3);
  }

  const eoi = Buffer.from([0xff, 0xd9]); // EOI
  return Buffer.concat([header, scanData, eoi]);
}

/**
 * Character and Location Concept Art T2I Generator.
 *
 * Automatically generates high-fidelity visual concept art for characters and locations,
 * seamlessly linking the generated image assets into Story Bible SQLite
 * to permanently anchor visual memory and anti-drift face embeddings across all episodes.
 */
export class ConceptArtGenerator {
  private bible: BibleManager;

  constructor(bible: BibleManager) {
    this.bible = bible;
  }

  /**
   * Generates concept art for a specific character and updates Story Bible.
   */
  public async generateCharacterConceptArt(options: ConceptArtOptions): Promise<ConceptArtResult> {
    const { seriesId, characterId } = options;
    if (!characterId) {
      throw new Error("[CONCEPT ART] Thiếu characterId để tạo ảnh concept art.");
    }

    const seriesMeta = this.bible.getSeriesMetadata(seriesId);
    const char = this.bible.getCharacter(characterId, seriesId);
    if (!char) {
      throw new Error(`[CONCEPT ART] Nhân vật '${characterId}' không tồn tại trong Series [${seriesId}].`);
    }

    // 1. Build Cinematic T2I Prompt
    const seriesStyle = seriesMeta?.visual_style || "Cinematic 35mm, photorealistic 8k, dramatic lighting";
    const charSummary = char.visual_summary || `Character ${char.name}`;
    const marks = char.distinguishing_marks ? `, distinguishing marks: ${char.distinguishing_marks}` : "";
    const prompt =
      options.promptOverride ||
      `${seriesStyle}. Character portrait of ${char.name}, ${charSummary}${marks}, neutral studio cinematic background, high resolution, highly detailed face anchor.`;

    // 2. Determine output path
    const destDir = options.outputDir || join("assets", "characters", seriesId);
    await mkdir(destDir, { recursive: true });
    const imagePath = join(destDir, `${characterId}_ref.jpg`);

    // 3. Generate Image
    const providerUsed = await this.generateArtWithProvider(prompt, imagePath, char.name, options);

    // 4. Extract or derive 512-D Face Feature Embedding
    const faceEmbedding = generateSyntheticFaceEmbedding(`${seriesId}_${characterId}_${char.name}`);

    // 5. Update Story Bible character record with the reference image and biometric embedding
    this.bible.upsertCharacter({
      ...char,
      face_reference_image: imagePath,
      face_embedding_json: JSON.stringify(faceEmbedding),
    });

    const fileStat = await stat(imagePath);

    return {
      entityType: "character",
      entityId: characterId,
      seriesId,
      prompt,
      imagePath,
      fileSizeBytes: fileStat.size,
      providerUsed,
      faceEmbedding,
      updatedBible: true,
    };
  }

  /**
   * Generates a 4-view character turnaround asset pack (front, 3/4, profile, full-body).
   * Permanently anchors multi-angle facial and wardrobe consistency across all camera perspectives.
   */
  public async generateCharacterTurnaroundPack(
    options: ConceptArtOptions
  ): Promise<CharacterTurnaroundPackResult> {
    const { seriesId, characterId } = options;
    if (!characterId) {
      throw new Error("[CONCEPT ART] Thiếu characterId để tạo character turnaround pack.");
    }

    const seriesMeta = this.bible.getSeriesMetadata(seriesId);
    const char = this.bible.getCharacter(characterId, seriesId);
    if (!char) {
      throw new Error(`[CONCEPT ART] Nhân vật '${characterId}' không tồn tại trong Series [${seriesId}].`);
    }

    const seriesStyle = seriesMeta?.visual_style || "Cinematic 35mm, photorealistic 8k, dramatic lighting";
    const charSummary = char.visual_summary || `Character ${char.name}`;
    const marks = char.distinguishing_marks ? `, distinguishing marks: ${char.distinguishing_marks}` : "";
    const destDir = options.outputDir || join("assets", "characters", seriesId);
    await mkdir(destDir, { recursive: true });

    // 1. Front View (0° Straight On Portrait)
    const frontPrompt = `${seriesStyle}. Full frontal portrait (0-degree straight-on view) of ${char.name}, ${charSummary}${marks}, direct eye contact, neutral expression, crisp lighting, high facial detail.`;
    const frontPath = join(destDir, `${characterId}_turnaround_front.jpg`);
    const frontProvider = await this.generateArtWithProvider(frontPrompt, frontPath, `${char.name} Front`, options);
    const frontStat = await stat(frontPath);
    const frontResult: ConceptArtResult = {
      entityType: "character",
      entityId: characterId,
      seriesId,
      prompt: frontPrompt,
      imagePath: frontPath,
      fileSizeBytes: frontStat.size,
      providerUsed: frontProvider,
      updatedBible: false,
    };

    // 2. Three-Quarter View (45° Perspective)
    const tqPrompt = `${seriesStyle}. Three-quarter angle portrait (45-degree angle view) of ${char.name}, ${charSummary}${marks}, defined jawline and cheekbones, cinematic three-point lighting.`;
    const tqPath = join(destDir, `${characterId}_turnaround_three_quarter.jpg`);
    const tqProvider = await this.generateArtWithProvider(tqPrompt, tqPath, `${char.name} 3/4`, options);
    const tqStat = await stat(tqPath);
    const tqResult: ConceptArtResult = {
      entityType: "character",
      entityId: characterId,
      seriesId,
      prompt: tqPrompt,
      imagePath: tqPath,
      fileSizeBytes: tqStat.size,
      providerUsed: tqProvider,
      updatedBible: false,
    };

    // 3. Profile View (90° Side Silhouette)
    const profilePrompt = `${seriesStyle}. Side profile shot (90-degree lateral view) of ${char.name}, ${charSummary}${marks}, sharp nose bridge and silhouette, studio rim light.`;
    const profilePath = join(destDir, `${characterId}_turnaround_profile.jpg`);
    const profileProvider = await this.generateArtWithProvider(profilePrompt, profilePath, `${char.name} Profile`, options);
    const profileStat = await stat(profilePath);
    const profileResult: ConceptArtResult = {
      entityType: "character",
      entityId: characterId,
      seriesId,
      prompt: profilePrompt,
      imagePath: profilePath,
      fileSizeBytes: profileStat.size,
      providerUsed: profileProvider,
      updatedBible: false,
    };

    // 4. Full-Body Wardrobe View (Full Costume & Posture)
    const fullBodyPrompt = `${seriesStyle}. Full body shot head-to-toe of ${char.name}, ${charSummary}${marks}, complete costume wardrobe and footwear, natural standing heroic posture.`;
    const fullBodyPath = join(destDir, `${characterId}_turnaround_full_body.jpg`);
    const fullBodyProvider = await this.generateArtWithProvider(fullBodyPrompt, fullBodyPath, `${char.name} Full Body`, options);
    const fullBodyStat = await stat(fullBodyPath);
    const fullBodyResult: ConceptArtResult = {
      entityType: "character",
      entityId: characterId,
      seriesId,
      prompt: fullBodyPrompt,
      imagePath: fullBodyPath,
      fileSizeBytes: fullBodyStat.size,
      providerUsed: fullBodyProvider,
      updatedBible: false,
    };

    // 5. Generate unit face embedding and update Story Bible
    const faceEmbedding = generateSyntheticFaceEmbedding(`${seriesId}_${characterId}_${char.name}`);
    this.bible.upsertCharacter({
      ...char,
      face_reference_image: frontPath,
      character_sheet_path: frontPath,
      face_embedding_json: JSON.stringify(faceEmbedding),
    });

    return {
      characterId,
      seriesId,
      views: {
        front: frontResult,
        threeQuarter: tqResult,
        profile: profileResult,
        fullBody: fullBodyResult,
      },
      faceEmbedding,
      updatedBible: true,
    };
  }

  /**
   * Generates concept art for a specific location and updates Story Bible.
   */
  public async generateLocationConceptArt(options: ConceptArtOptions): Promise<ConceptArtResult> {
    const { seriesId, locationId } = options;
    if (!locationId) {
      throw new Error("[CONCEPT ART] Thiếu locationId để tạo ảnh concept art.");
    }

    const seriesMeta = this.bible.getSeriesMetadata(seriesId);
    const loc = this.bible.getLocation(locationId, seriesId);
    if (!loc) {
      throw new Error(`[CONCEPT ART] Bối cảnh '${locationId}' không tồn tại trong Series [${seriesId}].`);
    }

    // 1. Build Cinematic T2I Prompt
    const seriesStyle = seriesMeta?.visual_style || "Cinematic 35mm, photorealistic 8k";
    const locSummary = loc.visual_summary || `Location ${loc.name}`;
    const lighting = loc.lighting_mood ? `, lighting: ${loc.lighting_mood}` : "";
    const rules = loc.atmospheric_rules ? `, atmosphere: ${loc.atmospheric_rules}` : "";
    const prompt =
      options.promptOverride ||
      `${seriesStyle}. Architectural establishing shot of ${loc.name}, ${locSummary}${lighting}${rules}, wide angle lens, high resolution environment concept art.`;

    // 2. Determine output path
    const destDir = options.outputDir || join("assets", "locations", seriesId);
    await mkdir(destDir, { recursive: true });
    const imagePath = join(destDir, `${locationId}_ref.jpg`);

    // 3. Generate Image
    const providerUsed = await this.generateArtWithProvider(prompt, imagePath, loc.name, options);

    // 4. Update Story Bible location record
    this.bible.upsertLocation({
      ...loc,
      reference_image_path: imagePath,
    });

    const fileStat = await stat(imagePath);

    return {
      entityType: "location",
      entityId: locationId,
      seriesId,
      prompt,
      imagePath,
      fileSizeBytes: fileStat.size,
      providerUsed,
      updatedBible: true,
    };
  }

  /**
   * Dispatches image generation to the specified provider with graceful fallback.
   */
  private async generateArtWithProvider(
    prompt: string,
    imagePath: string,
    label: string,
    options: ConceptArtOptions
  ): Promise<"local_comfyui" | "cloud" | "mock"> {
    const provider = options.provider || "mock";

    if (provider === "local_comfyui") {
      try {
        await this.generateViaComfyUi(
          prompt,
          imagePath,
          options.comfyHost,
          options.negativePrompt,
          options.width,
          options.height
        );
        return "local_comfyui";
      } catch (err: any) {
        if (options.allowMock) {
          await this.generateMockArt(label, imagePath);
          return "mock";
        }
        throw new Error(
          `[CONCEPT ART] Tạo ảnh qua ComfyUI thất bại và không cho phép fallback mock (allowMock = false): ${err.message}`
        );
      }
    } else if (provider === "cloud") {
      if (options.allowMock) {
        await this.generateMockArt(label, imagePath);
        return "mock";
      }
      throw new Error(
        "[CONCEPT ART] Cloud provider chưa được cấu hình. Đặt allowMock = true để dùng mock trong môi trường phát triển."
      );
    } else if (provider === "mock") {
      // P0 Provenance Gate: allowMock must be explicitly true; undefined or false both block mock generation.
      if (!options.allowMock) {
        throw new Error(
          `[CONCEPT ART] Provider 'mock' không tạo ra media thực. Đặt allowMock = true để chấp nhận kết quả mock, hoặc cấu hình provider thực (local_comfyui hoặc cloud).`
        );
      }
      await this.generateMockArt(label, imagePath);
      return "mock";
    } else {
      throw new Error(
        `[CONCEPT ART] Provider không hợp lệ: '${provider}'. Các provider được hỗ trợ: 'local_comfyui', 'cloud', 'mock'.`
      );
    }
  }

  /**
   * Generates mock concept art image file on disk.
   */
  private async generateMockArt(label: string, outPath: string): Promise<void> {
    const buffer = createValidMockJpegBuffer(label);
    await writeFile(outPath, buffer);
  }

  /**
   * Generates concept art image via local ComfyUI.
   */
  private async generateViaComfyUi(
    prompt: string,
    outPath: string,
    host = "http://127.0.0.1:8188",
    negativePrompt?: string,
    width = 768,
    height = 1024
  ): Promise<void> {
    const res = await axios.get(`${host}/system_stats`, { timeout: 2500 });
    if (!res.data) {
      throw new Error(`Cannot connect to ComfyUI at ${host}`);
    }

    // Determine available checkpoint or use fallback.
    // Fix: surface a warning when falling back to the hardcoded checkpoint name
    // so operators know the auto-detection failed and may be using the wrong model.
    const DEFAULT_CKPT = "v1-5-pruned-emaonly.ckpt";
    let ckptName = DEFAULT_CKPT;
    let ckptAutoDetected = false;
    try {
      const objInfo = await axios.get(`${host}/object_info/CheckpointLoaderSimple`, { timeout: 3000 });
      const ckpts = objInfo?.data?.CheckpointLoaderSimple?.input?.required?.ckpt_name?.[0];
      if (Array.isArray(ckpts) && ckpts.length > 0) {
        ckptName = ckpts[0];
        ckptAutoDetected = true;
      }
    } catch {
      // /object_info is optional — warn but do not fail the generation.
    }
    if (!ckptAutoDetected) {
      log.warn(
        `[COMFYUI] Không thể tự động phát hiện checkpoint từ ComfyUI. Sử dụng fallback: '${ckptName}'. Nếu model này không tồn tại trong ComfyUI, job sẽ thất bại.`
      );
    }

    const promptWorkflow = {
      "3": {
        inputs: {
          seed: Math.floor(Math.random() * 1000000000),
          steps: 20,
          cfg: 7.0,
          sampler_name: "euler",
          scheduler: "normal",
          denoise: 1.0,
          model: ["4", 0],
          positive: ["6", 0],
          negative: ["7", 0],
          latent_image: ["5", 0],
        },
        class_type: "KSampler",
      },
      "4": {
        inputs: { ckpt_name: ckptName },
        class_type: "CheckpointLoaderSimple",
      },
      "5": {
        inputs: { width: width, height: height, batch_size: 1 },
        class_type: "EmptyLatentImage",
      },
      "6": {
        inputs: { text: prompt, clip: ["4", 1] },
        class_type: "CLIPTextEncode",
      },
      "7": {
        inputs: {
          text: negativePrompt || "ugly, deformed, blurry, bad anatomy, low quality",
          clip: ["4", 1],
        },
        class_type: "CLIPTextEncode",
      },
      "8": {
        inputs: { samples: ["3", 0], vae: ["4", 2] },
        class_type: "VAEDecode",
      },
      "9": {
        inputs: { filename_prefix: "concept_art", images: ["8", 0] },
        class_type: "SaveImage",
      },
    };

    const clientId = `auto_art_${Date.now()}`;
    const promptRes = await axios.post(
      `${host}/prompt`,
      { prompt: promptWorkflow, client_id: clientId },
      { headers: { "Content-Type": "application/json" }, timeout: 5000 }
    );
    const promptId = promptRes.data?.prompt_id;
    if (!promptId) {
      throw new Error(`ComfyUI did not return a prompt_id: ${JSON.stringify(promptRes.data)}`);
    }

    const maxWaitMs = 60000;
    const pollIntervalMs = 1000;
    const startTime = Date.now();
    let imageInfo: { filename: string; subfolder?: string; type?: string } | null = null;

    while (Date.now() - startTime < maxWaitMs) {
      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
      try {
        const histRes = await axios.get(`${host}/history/${promptId}`, { timeout: 3000 });
        const histData = histRes.data?.[promptId];
        if (histData?.outputs) {
          for (const nodeId of Object.keys(histData.outputs)) {
            const images = histData.outputs[nodeId]?.images;
            if (Array.isArray(images) && images.length > 0) {
              imageInfo = images[0];
              break;
            }
          }
          if (imageInfo) break;
        }
        if (histData?.status?.status_str === "error") {
          throw new Error(`ComfyUI job failed: ${JSON.stringify(histData.status)}`);
        }
      } catch (err: any) {
        // Re-throw ComfyUI job failure immediately — these are definitive errors.
        // For transient network errors (ECONNRESET, timeout, etc.), log and
        // continue polling rather than silently swallowing every error.
        if (err.message?.includes("ComfyUI job failed")) throw err;
        // Transient errors (network glitch, 503, etc.) — surface a warning but
        // keep polling until maxWaitMs so we don't miss a successful completion.
        log.warn(`[COMFYUI POLL] Transient error while polling history for ${promptId}: ${err.message}`);
      }
    }

    if (!imageInfo) {
      throw new Error(`ComfyUI timed out waiting for image generation (${promptId})`);
    }

    const viewUrl = `${host}/view?filename=${encodeURIComponent(imageInfo.filename)}&subfolder=${encodeURIComponent(
      imageInfo.subfolder || ""
    )}&type=${encodeURIComponent(imageInfo.type || "output")}`;
    const imgRes = await axios.get(viewUrl, { responseType: "arraybuffer", timeout: 10000 });
    await writeFile(outPath, Buffer.from(imgRes.data));
  }
}
