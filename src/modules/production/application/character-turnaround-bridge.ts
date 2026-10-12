import { existsSync } from "node:fs";
import { join } from "node:path";
import { stat } from "node:fs/promises";
import type { CharacterTurnaroundBridgeStore } from "../ports/character-turnaround-bridge-store.js";

import { type ShotExecutionSpec, type CharacterTurnaroundAngle } from "../../../contracts/video.js";
import { mapShotToTurnaroundViewAngle, resolveCharacterConditioningImage } from "../domain/conditioning.js";
import {
  ConceptArtGenerator,
  type CharacterTurnaroundPackResult,
  type ConceptArtResult,
  generateSyntheticFaceEmbedding,
} from "./concept-art-generator.js";
import { log } from "../../../platform/observability/logger.js";
import { readReference, hashEmbedding } from "../../media/index.js";

export interface TurnaroundBridgeOptions {
  autoGenerate?: boolean;
  outputDir?: string;
  provider?: "local_comfyui" | "cloud" | "mock";
  allowMock?: boolean;
}

/**
 * Character Turnaround Conditioning Bridge
 *
 * Automatically links Story Bible character turnaround assets (front, 3/4, profile, full body)
 * and 512-D ArcFace embeddings into ShotExecutionSpec before dispatching to Video Gateway.
 */
export class CharacterTurnaroundBridge {
  /**
   * Automatically discovers or generates a character's turnaround pack.
   */
  public static async getOrGenerateTurnaroundPack(
    characterId: string,
    seriesId: string,
    bible: CharacterTurnaroundBridgeStore,
    options: TurnaroundBridgeOptions = {}
  ): Promise<CharacterTurnaroundPackResult | null> {
    const char = bible.getCharacter(characterId, seriesId);
    if (!char) {
      log.warn(`[TURNAROUND BRIDGE] Nhân vật '${characterId}' không tồn tại trong series [${seriesId}].`);
      return null;
    }

    const destDir = options.outputDir || join("assets", "characters", seriesId);
    const frontPath = join(destDir, `${characterId}_turnaround_front.jpg`);
    const tqPath = join(destDir, `${characterId}_turnaround_three_quarter.jpg`);
    const profilePath = join(destDir, `${characterId}_turnaround_profile.jpg`);
    const fullBodyPath = join(destDir, `${characterId}_turnaround_full_body.jpg`);

    const allExist =
      existsSync(frontPath) &&
      existsSync(tqPath) &&
      existsSync(profilePath) &&
      existsSync(fullBodyPath);

    if (allExist) {
      const provenance = await Promise.all([frontPath,tqPath,profilePath,fullBodyPath].map(path => readReference(bible,path,options.allowMock!==false)));
      if (options.allowMock === false && provenance.some(value => !value)) return null;
      const frontStat = await stat(frontPath);
      const tqStat = await stat(tqPath);
      const profileStat = await stat(profilePath);
      const fullBodyStat = await stat(fullBodyPath);

      let embedding: number[] = [];
      if (char.face_embedding_json) {
        try {
          embedding = JSON.parse(char.face_embedding_json);
        } catch (caughtError) { log.warn("[character-turnaround-bridge] "+String(caughtError)); }
      }
      if (options.allowMock === false && (provenance[0]?.embeddingSource !== "verified" || provenance[0]?.embeddingHash !== hashEmbedding(embedding))) embedding=[];
      if (options.allowMock !== false && (!embedding || embedding.length === 0)) {
        embedding = generateSyntheticFaceEmbedding(`${seriesId}_${characterId}_${char.name}`);
        bible.upsertCharacter({
          ...char,
          face_embedding_json: JSON.stringify(embedding),
        });
      }

      return {
        characterId,
        seriesId,
        views: {
          front: {
            entityType: "character",
            entityId: characterId,
            seriesId,
            prompt: "front view",
            imagePath: frontPath,
            fileSizeBytes: frontStat.size,
            providerUsed: provenance[0]?.mode==="production"?"cloud":"mock",
            updatedBible: false,
          },
          threeQuarter: {
            entityType: "character",
            entityId: characterId,
            seriesId,
            prompt: "three-quarter view",
            imagePath: tqPath,
            fileSizeBytes: tqStat.size,
            providerUsed: provenance[1]?.mode==="production"?"cloud":"mock",
            updatedBible: false,
          },
          profile: {
            entityType: "character",
            entityId: characterId,
            seriesId,
            prompt: "profile view",
            imagePath: profilePath,
            fileSizeBytes: profileStat.size,
            providerUsed: provenance[2]?.mode==="production"?"cloud":"mock",
            updatedBible: false,
          },
          fullBody: {
            entityType: "character",
            entityId: characterId,
            seriesId,
            prompt: "full body view",
            imagePath: fullBodyPath,
            fileSizeBytes: fullBodyStat.size,
            providerUsed: provenance[3]?.mode==="production"?"cloud":"mock",
            updatedBible: false,
          },
        },
        faceEmbedding: embedding,
        updatedBible: false,
      };
    }

    if (options.autoGenerate) {
      log.info(`[TURNAROUND BRIDGE] Đang tự động sinh Character Turnaround Pack cho nhân vật '${char.name}'...`);
      const generator = new ConceptArtGenerator(bible);
      return await generator.generateCharacterTurnaroundPack({
        seriesId,
        characterId,
        outputDir: destDir,
        provider: options.provider || "mock",
        allowMock: options.allowMock !== false,
      });
    }

    // If individual face_reference_image exists in Bible, construct partial fallback pack
    if (char.face_reference_image && existsSync(char.face_reference_image)) {
      const provenance = await readReference(bible,char.face_reference_image,options.allowMock!==false);
      if (options.allowMock === false && !provenance) return null;
      const fileStat = await stat(char.face_reference_image);
      let faceEmbed = char.face_embedding_json
        ? JSON.parse(char.face_embedding_json)
        : options.allowMock!==false ? generateSyntheticFaceEmbedding(`${seriesId}_${characterId}_${char.name}`) : [];
      if(options.allowMock===false&&(provenance?.embeddingSource!=="verified"||provenance?.embeddingHash!==hashEmbedding(faceEmbed)))faceEmbed=[];
      const singleView: ConceptArtResult = {
        entityType: "character",
        entityId: characterId,
        seriesId,
        prompt: "face reference",
        imagePath: char.face_reference_image,
        fileSizeBytes: fileStat.size,
        providerUsed: provenance?.mode==="production"?"cloud":"mock",
        updatedBible: false,
      };
      return {
        characterId,
        seriesId,
        views: {
          front: singleView,
          threeQuarter: singleView,
          profile: singleView,
          fullBody: singleView,
        },
        faceEmbedding: faceEmbed,
        updatedBible: false,
      };
    }

    return null;
  }

  /**
   * Injects turnaround multi-angle views and 512-D ArcFace face embedding into ShotExecutionSpec.
   */
  public static async bindTurnaroundToSpec(
    spec: ShotExecutionSpec,
    bible: CharacterTurnaroundBridgeStore,
    seriesId: string,
    options: TurnaroundBridgeOptions = {}
  ): Promise<ShotExecutionSpec> {
    const updatedSpec = { ...spec };

    // 1. Primary character binding
    if (spec.characterId) {
      const pack = await this.getOrGenerateTurnaroundPack(spec.characterId, seriesId, bible, options);
      if (pack) {
        // Detect shot angle (checks first-class spec.shotType as well as metadata)
        const shotType =
          (spec.shotType as string) ||
          (spec.metadata?.shotType as string) ||
          (spec.metadata?.type as string);
        const cameraAngle = (spec.metadata?.cameraAngle as string) || (spec.metadata?.angle as string);
        const viewAngle: CharacterTurnaroundAngle = mapShotToTurnaroundViewAngle(
          shotType,
          cameraAngle,
          spec.prompt
        );

        updatedSpec.characterTurnaround = {
          front: pack.views.front.imagePath,
          threeQuarter: pack.views.threeQuarter.imagePath,
          profile: pack.views.profile.imagePath,
          fullBody: pack.views.fullBody.imagePath,
          viewAngle,
        };

        // Select angle-matched reference image
        updatedSpec.characterReferenceImage = resolveCharacterConditioningImage(updatedSpec);
        updatedSpec.faceEmbedding = pack.faceEmbedding.length ? pack.faceEmbedding : undefined;
        updatedSpec.applyFaceConsistency = pack.faceEmbedding.length === 512;
      }
    }

    // 2. Secondary character binding (for 2-shot scenes)
    if (spec.secondaryCharacterId) {
      const secPack = await this.getOrGenerateTurnaroundPack(
        spec.secondaryCharacterId,
        seriesId,
        bible,
        options
      );
      if (secPack) {
        updatedSpec.secondaryCharacterTurnaround = {
          front: secPack.views.front.imagePath,
          threeQuarter: secPack.views.threeQuarter.imagePath,
          profile: secPack.views.profile.imagePath,
          fullBody: secPack.views.fullBody.imagePath,
          viewAngle: "three_quarter",
        };
        updatedSpec.secondaryCharacterReferenceImage =
          secPack.views.threeQuarter.imagePath || secPack.views.front.imagePath;
      }
    }

    return updatedSpec;
  }
}
