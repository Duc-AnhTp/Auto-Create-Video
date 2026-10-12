import { createHash } from "node:crypto";


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
  referenceImage?: string;
  firstFrameConditionPath?: string;
  firstFrameCondition?: string;
  characterReferenceImagePath?: string;
  characterReferenceImage?: string;
  secondaryCharacterReferenceImagePath?: string;
  secondaryCharacterReferenceImage?: string;
  characterTurnaround?: {
    front?: string;
    threeQuarter?: string;
    profile?: string;
    fullBody?: string;
    viewAngle?: string;
  };
  secondaryCharacterTurnaround?: {
    front?: string;
    threeQuarter?: string;
    profile?: string;
    fullBody?: string;
    viewAngle?: string;
  };
  regionalConditioning?: {
    enabled?: boolean;
    characterAPrompt?: string;
    characterBPrompt?: string;
    characterASide?: "left" | "right";
    characterBSide?: "left" | "right";
  };
  faceEmbedding?: number[];
  ipAdapterWeight?: number;
  applyFaceConsistency?: boolean;
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
export type ReferenceHasher = (value?:string) => string | null;
export function hashString(value?: string): string | null {
 return value ? createHash('sha256').update(value).digest('hex') : null;
}

/**
 * Computes SHA-256 spec hash for video generation.
 */
export function computeVideoSpecHash(input: VideoSpecInput | null | undefined, hashReference: ReferenceHasher = hashString): string {
  if (!input) return "";
  const prompt = (input.prompt || "").trim().replace(/\s+/g, " ");

  const charTurnaround = input.characterTurnaround
    ? {
        frontHash: hashReference(input.characterTurnaround.front),
        threeQuarterHash: hashReference(input.characterTurnaround.threeQuarter),
        profileHash: hashReference(input.characterTurnaround.profile),
        fullBodyHash: hashReference(input.characterTurnaround.fullBody),
        viewAngle: input.characterTurnaround.viewAngle || null,
      }
    : null;

  const secCharTurnaround = input.secondaryCharacterTurnaround
    ? {
        frontHash: hashReference(input.secondaryCharacterTurnaround.front),
        threeQuarterHash: hashReference(input.secondaryCharacterTurnaround.threeQuarter),
        profileHash: hashReference(input.secondaryCharacterTurnaround.profile),
        fullBodyHash: hashReference(input.secondaryCharacterTurnaround.fullBody),
        viewAngle: input.secondaryCharacterTurnaround.viewAngle || null,
      }
    : null;

  const regionalCond = input.regionalConditioning
    ? {
        enabled: Boolean(input.regionalConditioning.enabled),
        characterAPrompt: (input.regionalConditioning.characterAPrompt || "").trim(),
        characterBPrompt: (input.regionalConditioning.characterBPrompt || "").trim(),
        characterASide: input.regionalConditioning.characterASide || null,
        characterBSide: input.regionalConditioning.characterBSide || null,
      }
    : null;

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
    referenceImageHash: hashReference(input.referenceImagePath || input.referenceImage),
    firstFrameConditionHash: hashReference(input.firstFrameConditionPath || input.firstFrameCondition),
    characterReferenceImageHash: hashReference(input.characterReferenceImagePath || input.characterReferenceImage),
    secondaryCharacterReferenceImageHash: hashReference(input.secondaryCharacterReferenceImagePath || input.secondaryCharacterReferenceImage),
    characterTurnaround: charTurnaround,
    secondaryCharacterTurnaround: secCharTurnaround,
    regionalConditioning: regionalCond,
    faceEmbedding: Array.isArray(input.faceEmbedding) ? input.faceEmbedding.map((n: number) => Number(n.toFixed(4))) : null,
    ipAdapterWeight: input.ipAdapterWeight !== undefined && input.ipAdapterWeight !== null ? Number(input.ipAdapterWeight.toFixed(3)) : null,
    applyFaceConsistency: input.applyFaceConsistency !== undefined && input.applyFaceConsistency !== null ? Boolean(input.applyFaceConsistency) : null,
    loras: (input.loras || [])
      .map((l) => ({ path: l.path, weight: Number(l.weight.toFixed(3)) }))
      .sort((a, b) => a.path.localeCompare(b.path)),
    extraParameters: input.extraParameters || {},
  };

  const canonicalString = JSON.stringify(canonicalizeJson(canonicalPayload));
  return createHash("sha256").update(canonicalString).digest("hex");
}

/**
 * Computes SHA-256 spec hash for audio / TTS generation.
 */
export function computeAudioSpecHash(input: (Partial<AudioSpecInput> & {text?:string;speaker?:string}) | null | undefined, hashReference: ReferenceHasher = hashString): string {
  if (!input) return "";
  const dialogueText = (input.dialogueText || input.text || "").trim().replace(/\s+/g, " ");
  const speakerId = (input.speakerId || input.speaker || "").trim();
  const canonicalPayload = {
    type: "audio_tts",
    dialogueText,
    speakerId,
    voiceProfileId: (input.voiceProfileId || "default").trim(),
    voiceEmbeddingHash: hashReference(input.voiceEmbeddingPath),
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
export function computeCompositeShotHash(input: ShotSpecComposite & {videoSpec?:VideoSpecInput;audioSpec?:AudioSpecInput;videoSpecHash?:string;audioSpecHash?:string|null}, hashReference: ReferenceHasher = hashString): {
  compositeHash: string;
  videoSpecHash: string;
  audioSpecHash: string | null;
} {
  const videoInput = input?.video || input?.videoSpec || input;
  const audioInput = input?.audio || input?.audioSpec;
  const videoSpecHash = input?.videoSpecHash || (videoInput ? computeVideoSpecHash(videoInput,hashReference) : "");
  const audioSpecHash =
    input?.audioSpecHash !== undefined
      ? input.audioSpecHash
      : audioInput
      ? computeAudioSpecHash(audioInput,hashReference)
      : null;

  const compositePayload = {
    shotId: input?.shotId || "",
    videoSpecHash,
    audioSpecHash,
    sfxCue: input?.sfxCue
      ? {
          name: input.sfxCue.name,
          offsetSec: Number((input.sfxCue.offsetSec || 0).toFixed(2)),
          volume: Number((input.sfxCue.volume ?? 1).toFixed(2)),
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
