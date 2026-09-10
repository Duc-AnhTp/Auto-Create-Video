import { z } from "zod";

/**
 * Assembly Manifest Schema
 *
 * Provides a 1:1 reproducible blueprint of the film assembly:
 * - Specific approved take IDs and source clip paths
 * - Exact frame and timecode trim intervals (trimStartSec, trimEndSec)
 * - Explicit transition specifications (cut, crossfade, fade_to_black)
 * - Hierarchical scene cache hashes and rendered scene paths
 * - Audio stems and subtitle deliverables
 * - Standard NLE interchange timeline paths (FCP7 XML & OTIO)
 * - Automated QA verification report
 */

export const AssemblyShotRecordSchema = z.object({
  shotId: z.string().min(1),
  sceneId: z.string().min(1),
  takeId: z.string().min(1),
  isApproved: z.boolean().default(true),
  sourceClipPath: z.string().min(1),
  rawDurationSec: z.number().min(0),
  trimStartSec: z.number().min(0).default(0),
  trimEndSec: z.number().min(0).optional(),
  effectiveDurationSec: z.number().min(0),
  transitionIn: z
    .object({
      type: z.enum(["cut", "crossfade", "fade_to_black"]).default("cut"),
      durationSec: z.number().min(0).default(0),
    })
    .optional(),
  transitionOut: z
    .object({
      type: z.enum(["cut", "crossfade", "fade_to_black"]).default("cut"),
      durationSec: z.number().min(0).default(0),
    })
    .optional(),
  visualPrompt: z.string().default(""),
  characterId: z.string().optional(),
});

export type AssemblyShotRecord = z.infer<typeof AssemblyShotRecordSchema>;

export const AssemblySceneRecordSchema = z.object({
  sceneNumber: z.number().int().positive(),
  sceneId: z.string().min(1),
  sceneHash: z.string().min(1),
  isCacheHit: z.boolean().default(false),
  renderedScenePath: z.string().min(1),
  durationSec: z.number().min(0),
  shots: z.array(AssemblyShotRecordSchema),
});

export type AssemblySceneRecord = z.infer<typeof AssemblySceneRecordSchema>;

export const AssemblyQaReportSchema = z.object({
  isValid: z.boolean().default(true),
  videoDurationSec: z.number().min(0).default(0),
  audioDurationSec: z.number().min(0).default(0),
  driftSec: z.number().min(0).default(0),
  isWithinDriftTolerance: z.boolean().default(true),
  blackFrameDetected: z.boolean().default(false),
  blackSegments: z.array(
    z.object({
      startSec: z.number(),
      endSec: z.number(),
      durationSec: z.number(),
    })
  ).default([]),
  missingFiles: z.array(z.string()).default([]),
  corruptMedia: z.array(z.string()).default([]),
  warnings: z.array(z.string()).default([]),
  errors: z.array(z.string()).default([]),
});

export type AssemblyQaReport = z.infer<typeof AssemblyQaReportSchema>;

export const AssemblyManifestSchema = z.object({
  manifestVersion: z.string().default("1.0.0"),
  seriesId: z.string().min(1),
  episodeNumber: z.number().int().positive(),
  title: z.string().default("Episodic Master"),
  fps: z.number().positive().default(30),
  resolution: z.object({
    width: z.number().int().positive().default(720),
    height: z.number().int().positive().default(1280),
    aspectRatio: z.enum(["9:16", "16:9", "1:1"]).default("9:16"),
  }),
  totalDurationSec: z.number().min(0),
  scenes: z.array(AssemblySceneRecordSchema),
  masterOutputs: z.object({
    masterVideoPath: z.string().min(1),
    masterAudioPath: z.string().min(1),
    subtitlesSrtPath: z.string().optional(),
    subtitlesVttPath: z.string().optional(),
    stems: z.object({
      dialogue: z.string().optional(),
      sfx: z.string().optional(),
      ambience: z.string().optional(),
      bgm: z.string().optional(),
    }),
    nleInterchange: z.object({
      fcp7XmlPath: z.string().optional(),
      otioJsonPath: z.string().optional(),
      verificationNote: z.string().default(
        "Cú pháp XML và schema OTIO đã được kiểm tra tính hợp lệ; chưa kiểm tra trực tiếp trên GUI phần mềm NLE."
      ),
    }),
  }),
  qaReport: AssemblyQaReportSchema,
  createdAt: z.string(),
});

export type AssemblyManifest = z.infer<typeof AssemblyManifestSchema>;
