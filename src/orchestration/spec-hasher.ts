import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";

/**
 * Spec Hasher for Episodic AI Video & Audio Production
 *
 * Computes deterministic canonical SHA-256 hashes representing all input factors
 * that affect the generated outcome.
 *
 * Adheres to Requirement 5:
 * "Cache theo toàn bộ đầu vào ảnh hưởng kết quả: prompt, model/version,
 *  reference hash, duration, voice và thông số liên quan."
 */

export interface VideoSpecInput {
  prompt: string;
  negativePrompt?: string;
  provider: string;
  modelName?: string;
  durationSec: number;
  aspectRatio?: string;
  fps?: number;
  seed?: number;
  referenceImagePath?: string;
  firstFrameConditionPath?: string;
  loras?: Array<{ path: string; weight: number }>;
  extraParameters?: Record<string, unknown>;
}

export interface AudioSpecInput {
  dialogueText: string;
  speakerId: string;
  voiceProfileId?: string;
  voiceEmbeddingPath?: string;
  speed?: number;
  pitch?: number;
  emotion?: string;
  ttsProvider?: string;
}

export interface ShotSpecComposite {
  shotId: string;
  video: VideoSpecInput;
  audio?: AudioSpecInput;
  sfxCue?: { name: string; offsetSec?: number; volume?: number };
  requiresLipSync?: boolean;
}

/**
 * Deterministically sorts object keys recursively for canonical JSON serialization.
 */
export function canonicalizeJson(obj: unknown): unknown {
  if (obj === null || typeof obj !== "object") {
    return obj;
  }
  if (Array.isArray(obj)) {
    return obj.map(canonicalizeJson);
  }
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(obj as Record<string, unknown>).sort()) {
    const val = (obj as Record<string, unknown>)[key];
    if (val !== undefined) {
      sorted[key] = canonicalizeJson(val);
    }
  }
  return sorted;
}

/**
 * Computes a SHA-256 hash of a local file's content or fallback to string hash.
 */
export function hashFileOrString(pathOrValue?: string): string | null {
  if (!pathOrValue) return null;
  try {
    if (existsSync(pathOrValue)) {
      const buffer = readFileSync(pathOrValue);
      return createHash("sha256").update(buffer).digest("hex");
    }
  } catch {
    // If file cannot be read, fallback to hashing string representation
  }
  return createHash("sha256").update(pathOrValue).digest("hex");
}

/**
 * Computes SHA-256 spec hash for video generation.
 */
export function computeVideoSpecHash(input: any): string {
  if (!input) return "";
  const prompt = (input.prompt || "").trim().replace(/\s+/g, " ");
  const canonicalPayload = {
    type: "video_generation",
    prompt,
    negativePrompt: (input.negativePrompt || "").trim().replace(/\s+/g, " "),
    provider: (input.provider || "mock").toLowerCase().trim(),
    modelName: (input.modelName || "default").toLowerCase().trim(),
    durationSec: Number((input.durationSec || 5.0).toFixed(2)),
    aspectRatio: input.aspectRatio || "9:16",
    fps: input.fps || 30,
    seed: input.seed ?? null,
    referenceImageHash: hashFileOrString(input.referenceImagePath || input.referenceImage),
    firstFrameConditionHash: hashFileOrString(input.firstFrameConditionPath),
    loras: (input.loras || [])
      .map((l: any) => ({ path: l.path, weight: Number(l.weight.toFixed(3)) }))
      .sort((a: any, b: any) => a.path.localeCompare(b.path)),
    extraParameters: input.extraParameters || {},
  };

  const canonicalString = JSON.stringify(canonicalizeJson(canonicalPayload));
  return createHash("sha256").update(canonicalString).digest("hex");
}

/**
 * Computes SHA-256 spec hash for audio / TTS generation.
 */
export function computeAudioSpecHash(input: any): string {
  if (!input) return "";
  const dialogueText = (input.dialogueText || input.text || "").trim().replace(/\s+/g, " ");
  const speakerId = (input.speakerId || input.speaker || "").trim();
  const canonicalPayload = {
    type: "audio_tts",
    dialogueText,
    speakerId,
    voiceProfileId: (input.voiceProfileId || "default").trim(),
    voiceEmbeddingHash: hashFileOrString(input.voiceEmbeddingPath),
    speed: input.speed ? Number(input.speed.toFixed(2)) : 1.0,
    pitch: input.pitch ? Number(input.pitch.toFixed(2)) : 1.0,
    emotion: (input.emotion || "neutral").trim(),
    ttsProvider: (input.ttsProvider || "lucylab").toLowerCase().trim(),
  };

  const canonicalString = JSON.stringify(canonicalizeJson(canonicalPayload));
  return createHash("sha256").update(canonicalString).digest("hex");
}

/**
 * Computes composite spec hash for an entire shot.
 */
export function computeCompositeShotHash(input: any): {
  compositeHash: string;
  videoSpecHash: string;
  audioSpecHash: string | null;
} {
  const videoInput = input?.video || input?.videoSpec || input;
  const audioInput = input?.audio || input?.audioSpec;
  const videoSpecHash = input?.videoSpecHash || (videoInput ? computeVideoSpecHash(videoInput) : "");
  const audioSpecHash =
    input?.audioSpecHash !== undefined
      ? input.audioSpecHash
      : audioInput
      ? computeAudioSpecHash(audioInput)
      : null;

  const compositePayload = {
    shotId: input?.shotId || "",
    videoSpecHash,
    audioSpecHash,
    sfxCue: input?.sfxCue
      ? {
          name: input.sfxCue.name,
          offsetSec: Number((input.sfxCue.offsetSec || 0).toFixed(2)),
          volume: Number((input.sfxCue.volume || 1).toFixed(2)),
        }
      : null,
    requiresLipSync: Boolean(input?.requiresLipSync),
  };

  const canonicalString = JSON.stringify(canonicalizeJson(compositePayload));
  const compositeHash = createHash("sha256").update(canonicalString).digest("hex");

  return {
    compositeHash,
    videoSpecHash,
    audioSpecHash,
  };
}
