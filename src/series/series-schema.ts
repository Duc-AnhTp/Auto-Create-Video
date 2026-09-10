import { z } from "zod";

// ── Series Configuration Schema ──────────────────────────────────────────────
export const SeriesConfigSchema = z.object({
  id: z.string().min(1).regex(/^[a-z0-9-_]+$/i, "Series ID must be alphanumeric/dashes/underscores"),
  title: z.string().min(1),
  genre: z.string().optional(),
  visualStyle: z.string().min(1, "Visual style prompt is required to maintain artistic consistency across episodes"),
  negativePrompt: z.string().optional(),
  aspectRatio: z.enum(["9:16", "16:9"]).default("9:16"),
  fps: z.number().int().positive().default(30),
  createdAt: z.string().optional(),
});

export type SeriesConfig = z.infer<typeof SeriesConfigSchema>;

// ── Dialogue Line Schema ─────────────────────────────────────────────────────
export const DialogueLineSchema = z
  .object({
    dialogueId: z.string().min(1).optional(),
    characterId: z.string().min(1).optional(),
    speakerId: z.string().min(1).optional(),
    speakerName: z.string().min(1).optional(),
    speaker: z.string().min(1).optional(),
    text: z.string().min(1),
    rawText: z.string().optional(),
    subtitleText: z.string().optional(),
    ttsText: z.string().optional(),
    type: z.enum(["speech", "voiceover"]).default("speech"),
    actingInstruction: z.string().optional(),
    voiceProfileId: z.string().nullish(),
    isUnresolved: z.boolean().default(false),
  })
  .transform((d) => {
    const characterId = d.characterId || d.speakerId || d.speaker || "narrator";
    const speakerName = d.speakerName || d.speaker || d.characterId || "Narrator";
    return {
      dialogueId: d.dialogueId || "d01",
      characterId,
      speakerName,
      text: d.text,
      rawText: d.rawText ?? d.text,
      subtitleText: d.subtitleText ?? d.text,
      ttsText: d.ttsText ?? d.text,
      type: d.type,
      actingInstruction: d.actingInstruction,
      voiceProfileId: d.voiceProfileId ?? undefined,
      isUnresolved: d.isUnresolved ?? false,
    };
  });

export type DialogueLine = z.infer<typeof DialogueLineSchema>;

// ── Shot Schema ──────────────────────────────────────────────────────────────
export const ShotTypeSchema = z.enum([
  "establishing",
  "wide",
  "medium",
  "close_up",
  "extreme_close_up",
  "action",
  "over_the_shoulder",
  "pov",
]);

export type ShotType = z.infer<typeof ShotTypeSchema>;

export const ShotSchema = z
  .object({
    shotId: z.string().min(1),
    shotType: ShotTypeSchema.default("medium"),
    durationSec: z.number().positive().max(30), // typically 2 - 8s per shot
    visualPrompt: z.string().min(1),
    referenceImage: z.string().optional(), // path to character face or location image
    characterId: z.string().optional(), // primary character in frame
    firstFrameCondition: z.string().optional(), // for autoregressive I2V
    dialogues: z.array(DialogueLineSchema).default([]),
    dialogue: DialogueLineSchema.optional(), // Backwards-compatible single dialogue line
    cameraMovement: z.string().optional(),
    sfxCue: z
      .object({
        name: z.string(),
        offsetSec: z.number().default(0),
        volume: z.number().min(0).max(1).default(0.7),
      })
      .optional(),
  })
  .transform((shot) => {
    const dialogues = [...shot.dialogues];
    // If shot has legacy dialogue but empty dialogues array, insert it
    if (shot.dialogue && dialogues.length === 0) {
      dialogues.push(shot.dialogue);
    }
    // Ensure all dialogues have a valid unique dialogueId scoped to the shot
    for (let i = 0; i < dialogues.length; i++) {
      if (!dialogues[i].dialogueId || dialogues[i].dialogueId === "d01") {
        dialogues[i].dialogueId = `${shot.shotId}_d${String(i + 1).padStart(2, "0")}`;
      }
    }
    // Set dialogue to first line for legacy callers
    const firstDialogue = dialogues.length > 0 ? dialogues[0] : undefined;

    return {
      ...shot,
      dialogues,
      dialogue: firstDialogue,
    };
  });

export type Shot = z.infer<typeof ShotSchema>;

// ── Scene Schema ─────────────────────────────────────────────────────────────
export const SceneSchema = z
  .object({
    sceneId: z.string().optional(),
    sceneNumber: z.number().int().positive(),
    locationId: z.string().min(1),
    locationName: z.string().min(1),
    timeOfDay: z.enum(["day", "night", "golden_hour", "dusk", "dawn"]).default("night"),
    mood: z.string().optional(),
    charactersPresent: z
      .array(
        z.union([
          z.string().transform((id) => ({ characterId: id, wardrobeId: null })),
          z.object({
            characterId: z.string().min(1),
            wardrobeId: z.string().nullish(),
          }),
        ])
      )
      .default([]),
    propsPresent: z.array(z.string()).default([]),
    shots: z.array(ShotSchema).min(1, "Each scene must contain at least one shot"),
  })
  .transform((scene) => {
    const sceneId = scene.sceneId || `sc${String(scene.sceneNumber).padStart(2, "0")}`;
    return {
      ...scene,
      sceneId,
    };
  });

export type Scene = z.infer<typeof SceneSchema>;

// ── Complete Episodic Script Schema ──────────────────────────────────────────
export const EpisodicScriptSchema = z
  .object({
    schemaVersion: z.string().default("3.0"),
    version: z.string().default("3.0"),
    seriesId: z.string().min(1),
    episodeNumber: z.number().int().positive(),
    title: z.string().min(1),
    logline: z.string().min(1),
    aspectRatio: z.enum(["9:16", "16:9"]).default("9:16"),
    fps: z.number().int().positive().default(30),
    bgm: z.string().optional(),
    unresolvedCharacters: z.array(z.string()).default([]),
    scenes: z.array(SceneSchema).min(1, "Episode must contain at least one scene"),
  })
  .transform((script) => {
    // Collect all unresolved characters across dialogues if not explicitly provided
    const unresolvedSet = new Set<string>(script.unresolvedCharacters);
    for (const scene of script.scenes) {
      for (const shot of scene.shots) {
        for (const d of shot.dialogues) {
          if (d.isUnresolved) {
            unresolvedSet.add(d.speakerName);
          }
        }
      }
    }
    return {
      ...script,
      schemaVersion: script.schemaVersion || "3.0",
      version: script.version || script.schemaVersion || "3.0",
      unresolvedCharacters: Array.from(unresolvedSet),
    };
  });

export type EpisodicScript = z.infer<typeof EpisodicScriptSchema>;

// ── Narrative Delta Schema (Post-Episode Commit) ─────────────────────────────
export const NarrativeDeltaSchema = z.object({
  characterStatusUpdates: z
    .array(
      z.object({
        id: z.string(),
        status: z.enum(["alive", "injured", "deceased", "missing"]),
        notes: z.string().optional(),
        distinguishingMarks: z.string().optional(),
      })
    )
    .optional(),
  character_status_updates: z.array(z.any()).optional(),
  wardrobeUpdates: z
    .array(
      z.object({
        characterId: z.string(),
        wardrobeId: z.string(),
      })
    )
    .optional(),
  character_wardrobe_updates: z.array(z.any()).optional(),
  propUpdates: z
    .array(
      z.object({
        propId: z.string(),
        newHolderId: z.string(),
        status: z.enum(["intact", "damaged", "lost", "destroyed"]).optional(),
      })
    )
    .optional(),
  prop_transfers: z.array(z.any()).optional(),
  prop_holder_updates: z.array(z.any()).optional(),
  newKnowledge: z
    .array(
      z.object({
        characterId: z.string(),
        factKey: z.string(),
        notes: z.string().optional(),
      })
    )
    .optional(),
  new_knowledge: z.array(z.any()).optional(),
  worldStateUpdates: z.record(z.string(), z.unknown()).optional(),
  world_state_updates: z.record(z.string(), z.unknown()).optional(),
  majorEvents: z.array(z.string()).optional(),
  major_events: z.array(z.string()).optional(),
});

export type NarrativeDelta = z.infer<typeof NarrativeDeltaSchema>;

// ── Checkpoint & Production Job Contracts ────────────────────────────────────
export type ShotProductionStatus =
  | "pending"
  | "generating"
  | "completed"
  | "failed"
  | "approved";

export interface ShotProgress {
  shotId: string;
  status: ShotProductionStatus;
  activeTakeId?: string;
  allTakes: string[]; // List of take IDs
  videoPath?: string;
  durationSec?: number;
  error?: string;
  retryCount: number;
}

export type JobPhase =
  | "init"
  | "audit"
  | "audio"
  | "video_generation"
  | "qa_review"
  | "timeline_assembly"
  | "committed"
  | "mock_completed"
  | "assembled_pending_review"
  | "failed";

export interface EpisodeProductionJob {
  jobId: string;
  seriesId: string;
  episodeNumber: number;
  title: string;
  status: "pending" | "in_progress" | "paused" | "completed" | "failed";
  currentPhase: JobPhase;
  shots: Record<string, ShotProgress>;
  audioPath?: string;
  videoPath?: string;
  totalCostUsd: number;
  createdAt: string;
  updatedAt: string;
}

// ── Script Integrity Verification ────────────────────────────────────────────
export interface ScriptIntegrityIssue {
  type: "DUPLICATE_ID" | "MISSING_REFERENCE" | "UNRESOLVED_CHARACTER" | "EMPTY_SCENE" | "INVALID_TIMING";
  severity: "error" | "warning";
  location: string;
  message: string;
}

export interface ScriptIntegrityReport {
  isValid: boolean;
  issues: ScriptIntegrityIssue[];
  stats: {
    totalScenes: number;
    totalShots: number;
    totalDialogues: number;
    unresolvedCharacterCount: number;
  };
}

export class ScriptIntegrityError extends Error {
  public issues: ScriptIntegrityIssue[];
  constructor(message: string, issues: ScriptIntegrityIssue[]) {
    super(message);
    this.name = "ScriptIntegrityError";
    this.issues = issues;
  }
}

/**
 * Validates deep integrity of an EpisodicScript:
 * - Ensures all sceneId, shotId, and dialogueId are globally unique.
 * - Detects missing references (characters or props in shots not declared in scene or Bible).
 * - Identifies unresolved named characters requiring user voice mapping.
 */
export function validateScriptIntegrity(
  script: EpisodicScript,
  options: {
    knownCharacterIds?: string[];
    knownLocationIds?: string[];
    knownPropIds?: string[];
    strict?: boolean;
  } = {}
): ScriptIntegrityReport {
  const issues: ScriptIntegrityIssue[] = [];
  const sceneIds = new Set<string>();
  const sceneNumbers = new Set<number>();
  const shotIds = new Set<string>();
  const dialogueIds = new Set<string>();

  let totalDialogues = 0;
  let totalShots = 0;

  const knownChars = options.knownCharacterIds ? new Set(options.knownCharacterIds) : null;
  const knownProps = options.knownPropIds ? new Set(options.knownPropIds) : null;
  const knownLocs = options.knownLocationIds ? new Set(options.knownLocationIds) : null;

  for (const scene of script.scenes) {
    // 1. Check Scene IDs
    if (scene.sceneId) {
      if (sceneIds.has(scene.sceneId)) {
        issues.push({
          type: "DUPLICATE_ID",
          severity: "error",
          location: `Scene ${scene.sceneNumber} (${scene.sceneId})`,
          message: `Trùng lặp sceneId: '${scene.sceneId}'.`,
        });
      }
      sceneIds.add(scene.sceneId);
    }
    if (sceneNumbers.has(scene.sceneNumber)) {
      issues.push({
        type: "DUPLICATE_ID",
        severity: "error",
        location: `Scene ${scene.sceneNumber}`,
        message: `Trùng lặp sceneNumber: ${scene.sceneNumber}.`,
      });
    }
    sceneNumbers.add(scene.sceneNumber);

    // Check location reference if known locations are provided
    if (knownLocs && !knownLocs.has(scene.locationId) && !scene.locationId.startsWith("loc_scene_")) {
      issues.push({
        type: "MISSING_REFERENCE",
        severity: "warning",
        location: `Scene ${scene.sceneNumber}`,
        message: `Bối cảnh '${scene.locationId}' chưa được khai báo trong Story Bible locations.`,
      });
    }

    // Check prop references
    if (knownProps) {
      for (const p of scene.propsPresent) {
        if (!knownProps.has(p)) {
          issues.push({
            type: "MISSING_REFERENCE",
            severity: "warning",
            location: `Scene ${scene.sceneNumber}`,
            message: `Đạo cụ '${p}' không tồn tại trong Story Bible key_props.`,
          });
        }
      }
    }

    // 2. Check Shots in Scene
    if (scene.shots.length === 0) {
      issues.push({
        type: "EMPTY_SCENE",
        severity: "error",
        location: `Scene ${scene.sceneNumber}`,
        message: `Cảnh ${scene.sceneNumber} không chứa shot nào.`,
      });
    }

    for (const shot of scene.shots) {
      totalShots++;
      if (shotIds.has(shot.shotId)) {
        issues.push({
          type: "DUPLICATE_ID",
          severity: "error",
          location: `Scene ${scene.sceneNumber}, Shot ${shot.shotId}`,
          message: `Trùng lặp shotId: '${shot.shotId}'.`,
        });
      }
      shotIds.add(shot.shotId);

      // Verify character in shot
      if (shot.characterId && knownChars && !knownChars.has(shot.characterId) && shot.characterId !== "narrator") {
        issues.push({
          type: "MISSING_REFERENCE",
          severity: "warning",
          location: `Scene ${scene.sceneNumber}, Shot ${shot.shotId}`,
          message: `Nhân vật '${shot.characterId}' trong shot không có trong Story Bible.`,
        });
      }

      // Check dialogues
      for (const d of shot.dialogues) {
        totalDialogues++;
        if (dialogueIds.has(d.dialogueId)) {
          issues.push({
            type: "DUPLICATE_ID",
            severity: "error",
            location: `Shot ${shot.shotId}, Dialogue ${d.dialogueId}`,
            message: `Trùng lặp dialogueId: '${d.dialogueId}'.`,
          });
        }
        dialogueIds.add(d.dialogueId);

        if (d.isUnresolved) {
          issues.push({
            type: "UNRESOLVED_CHARACTER",
            severity: options.strict ? "error" : "warning",
            location: `Shot ${shot.shotId}, Dialogue ${d.dialogueId}`,
            message: `Nhân vật '${d.speakerName}' chưa được ánh xạ vào Story Bible. Cần cấu hình voiceProfileId hoặc liên kết nhân vật.`,
          });
        }
      }
    }
  }

  const hasErrors = issues.some((i) => i.severity === "error");
  return {
    isValid: !hasErrors,
    issues,
    stats: {
      totalScenes: script.scenes.length,
      totalShots,
      totalDialogues,
      unresolvedCharacterCount: script.unresolvedCharacters.length,
    },
  };
}

/**
 * Migrates older script formats (v1 / v2) to current EpisodicScript (v3.0).
 */
export function migrateScriptToLatest(data: any): EpisodicScript {
  if (!data || typeof data !== "object") {
    throw new Error("Dữ liệu kịch bản không hợp lệ (cần đối tượng JSON).");
  }

  const cloned = JSON.parse(JSON.stringify(data));
  cloned.schemaVersion = "3.0";
  cloned.version = "3.0";

  if (Array.isArray(cloned.scenes)) {
    for (let sIdx = 0; sIdx < cloned.scenes.length; sIdx++) {
      const scene = cloned.scenes[sIdx];
      if (!scene.sceneId) {
        scene.sceneId = `sc${String(scene.sceneNumber || sIdx + 1).padStart(2, "0")}`;
      }
      if (Array.isArray(scene.shots)) {
        for (let shIdx = 0; shIdx < scene.shots.length; shIdx++) {
          const shot = scene.shots[shIdx];
          if (!shot.shotId) {
            shot.shotId = `${scene.sceneId}_sh${String(shIdx + 1).padStart(2, "0")}`;
          }
          if (!shot.dialogues) {
            shot.dialogues = [];
          }
          // If legacy single dialogue exists
          if (shot.dialogue && shot.dialogues.length === 0) {
            const d = shot.dialogue;
            shot.dialogues.push({
              dialogueId: `${shot.shotId}_d01`,
              characterId: d.characterId || "narrator",
              speakerName: d.speakerName || "Người dẫn chuyện",
              text: d.text || "",
              rawText: d.rawText || d.text || "",
              subtitleText: d.subtitleText || d.text || "",
              ttsText: d.ttsText || d.text || "",
              type: d.type || "speech",
              actingInstruction: d.actingInstruction,
              voiceProfileId: d.voiceProfileId,
              isUnresolved: d.isUnresolved ?? false,
            });
          }
        }
      }
    }
  }

  return EpisodicScriptSchema.parse(cloned);
}
