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
export const DialogueLineSchema = z.object({
  characterId: z.string().min(1),
  speakerName: z.string().min(1),
  text: z.string().min(1),
  type: z.enum(["speech", "voiceover"]).default("speech"),
  voiceProfileId: z.string().optional(),
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

export const ShotSchema = z.object({
  shotId: z.string().min(1),
  shotType: ShotTypeSchema.default("medium"),
  durationSec: z.number().positive().max(30), // typically 2 - 8s per shot
  visualPrompt: z.string().min(1),
  referenceImage: z.string().optional(), // path to character face or location image
  characterId: z.string().optional(), // primary character in frame
  firstFrameCondition: z.string().optional(), // for autoregressive I2V
  dialogue: DialogueLineSchema.optional(),
  cameraMovement: z.string().optional(),
  sfxCue: z
    .object({
      name: z.string(),
      offsetSec: z.number().default(0),
      volume: z.number().min(0).max(1).default(0.7),
    })
    .optional(),
});

export type Shot = z.infer<typeof ShotSchema>;

// ── Scene Schema ─────────────────────────────────────────────────────────────
export const SceneSchema = z.object({
  sceneNumber: z.number().int().positive(),
  locationId: z.string().min(1),
  locationName: z.string().min(1),
  timeOfDay: z.enum(["day", "night", "golden_hour", "dusk", "dawn"]).default("night"),
  mood: z.string().optional(),
  charactersPresent: z.array(
    z.object({
      characterId: z.string().min(1),
      wardrobeId: z.string().optional(),
    })
  ).default([]),
  propsPresent: z.array(z.string()).default([]),
  shots: z.array(ShotSchema).min(1, "Each scene must contain at least one shot"),
});

export type Scene = z.infer<typeof SceneSchema>;

// ── Complete Episodic Script Schema ──────────────────────────────────────────
export const EpisodicScriptSchema = z.object({
  version: z.literal("2.0").default("2.0"),
  seriesId: z.string().min(1),
  episodeNumber: z.number().int().positive(),
  title: z.string().min(1),
  logline: z.string().min(1),
  aspectRatio: z.enum(["9:16", "16:9"]).default("9:16"),
  bgm: z.string().optional(),
  scenes: z.array(SceneSchema).min(1, "Episode must contain at least one scene"),
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
  wardrobeUpdates: z
    .array(
      z.object({
        characterId: z.string(),
        wardrobeId: z.string(),
      })
    )
    .optional(),
  propUpdates: z
    .array(
      z.object({
        propId: z.string(),
        newHolderId: z.string(),
        status: z.enum(["intact", "damaged", "lost", "destroyed"]).optional(),
      })
    )
    .optional(),
  newKnowledge: z
    .array(
      z.object({
        characterId: z.string(),
        factKey: z.string(),
        notes: z.string().optional(),
      })
    )
    .optional(),
  worldStateUpdates: z.record(z.string(), z.unknown()).optional(),
  majorEvents: z.array(z.string()).optional(),
});

export type NarrativeDelta = z.infer<typeof NarrativeDeltaSchema>;
