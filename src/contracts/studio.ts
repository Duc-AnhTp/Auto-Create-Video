import { z } from "zod";
import {AssetId} from "./asset-id.js";

export const SeriesId = AssetId.max(100);
export const JobStatusSchema = z.enum(["queued", "running", "paused", "needs_review", "succeeded", "failed", "cancelled"]);
export type JobStatus = z.infer<typeof JobStatusSchema>;
export const HedgeSchema = z.object({ enabled:z.boolean().default(false),fallbackProvider:z.enum(["local_comfyui","api_kling","api_runway","api_veo","api_seedance"]).optional(),delayMs:z.number().int().min(0).max(300_000).default(45_000) }).strict();
export const PostprocessOptionsSchema = z.object({
  aspectRatio:z.enum(["16:9","9:16","1:1"]).optional(),enableSuperResolution:z.boolean().optional(),resolutionStandard:z.enum(["4k","1080p"]).optional(),
  filmGrainIntensity:z.number().finite().min(0).max(1).optional(),unsharpStrength:z.number().finite().min(0).max(1.5).optional(),enableCdlGrading:z.boolean().optional(),
  cdlPreset:z.enum(["kodak_2383","fuji_eterna","teal_orange","cyberpunk_neon","bleach_bypass","monochrome_noir","natural_balance"]).optional(),
  customCdl:z.object({slope:z.tuple([z.number().finite(),z.number().finite(),z.number().finite()]).optional(),offset:z.tuple([z.number().finite(),z.number().finite(),z.number().finite()]).optional(),power:z.tuple([z.number().finite().positive(),z.number().finite().positive(),z.number().finite().positive()]).optional(),saturation:z.number().finite().nonnegative().optional()}).strict().optional(),
  enableSpatialFoley:z.boolean().optional(),foleyCues:z.array(z.object({id:z.string().min(1),actionPrompt:z.string().max(10_000),sourceX:z.number().min(-1).max(1),distance:z.enum(["close_up","medium","wide","extreme_wide"]),offsetSec:z.number().finite().nonnegative(),durationSec:z.number().finite().positive(),baseVolume:z.number().min(0).max(1).optional()}).strict()).max(1000).optional(),
  enableBroadcastConformance:z.boolean().optional(),deliveryStandard:z.enum(["broadcast_ebu_r128","streaming_youtube_tiktok"]).optional(),clampLegalRange:z.boolean().optional(),
}).strict();
const EpisodeSeasonFieldsSchema = z.object({
  seriesId: SeriesId,
  episodeNumber: z.number().int().positive().default(1),
  kind: z.enum(["episode", "season"]).default("episode"),
  season: z.object({ planId: z.string().min(1).optional(), fromEpisode: z.number().int().positive().default(1), toEpisode: z.number().int().positive(), approvalPolicy: z.enum(["auto_qa", "manual"]).default("auto_qa") }).strict().optional(),
  rawScreenplay: z.string().max(2_000_000).default(""),
  targetShotId: z.string().min(1).max(200).regex(/^[a-zA-Z0-9_-]+$/).optional(),
  promptOverride: z.string().trim().min(1).max(10_000).optional(),
  provider: z.enum(["mock", "local_comfyui", "api_kling", "api_runway", "api_veo", "api_seedance"]).default("mock"),
  mode: z.enum(["mock", "production"]).default("mock"),
  budgetCapUsd: z.number().finite().positive().optional(),
  maxReRolls: z.number().int().min(0).max(2).default(2),
  resume: z.boolean().default(true),
  regenerateAudio: z.boolean().optional(),
  exportResolution: z.enum(["720p", "1080p"]).default("1080p").optional(),
  hedge:HedgeSchema.optional(),
}).strict();
export const EpisodeSeasonRequestSchema = EpisodeSeasonFieldsSchema.superRefine((value, ctx) => {
  if (value.targetShotId && value.kind !== "episode") ctx.addIssue({ code: "custom", message: "Shot reroll requires an episode job" });
  if (value.promptOverride && !value.targetShotId) ctx.addIssue({ code: "custom", message: "Prompt override requires a target shot" });
  if (value.kind === "episode" && !value.rawScreenplay.trim()) ctx.addIssue({ code: "custom", message: "Episode requires a screenplay" });
  if (value.kind === "season" && (!value.season || value.season.toEpisode < value.season.fromEpisode)) ctx.addIssue({ code: "custom", message: "Season requires a valid episode range" });
  if (value.mode === "production" && (value.provider === "mock" || !value.budgetCapUsd)) {
    ctx.addIssue({ code: "custom", message: "Production requires a real provider and an explicit budget cap." });
  }
  if(value.hedge?.enabled && (!value.hedge.fallbackProvider||value.hedge.fallbackProvider===value.provider||value.mode!=="production"))ctx.addIssue({code:"custom",message:"Hedge requires production and a distinct fallback provider"});
});
export const PostprocessRequestSchema=z.object({
  kind:z.literal("postprocess"),seriesId:SeriesId,episodeNumber:z.number().int().positive(),inputArtifactId:z.string().uuid(),inputSha256:z.string().regex(/^[a-f0-9]{64}$/).optional(),options:PostprocessOptionsSchema.default({}),
  rawScreenplay:z.literal("").default(""),mode:z.enum(["mock","production"]).default("mock"),provider:z.literal("mock").default("mock"),resume:z.boolean().default(true),maxReRolls:z.literal(0).default(0),exportResolution:z.enum(["720p","1080p"]).optional(),budgetCapUsd:z.number().finite().positive().optional(),
}).strict();
export const ProductionRequestSchema=z.union([EpisodeSeasonRequestSchema,PostprocessRequestSchema]);
/** Job snapshots redact screenplay content; submission validation remains strict. */
export const JobSummaryRequestSchema=z.union([EpisodeSeasonFieldsSchema,PostprocessRequestSchema]);
export type ProductionRequest = z.infer<typeof ProductionRequestSchema>;

export const StoryImportInputSchema = z.object({
  title: z.string().min(1).max(250),
  text: z.string().min(1).max(4_000_000),
  episodes: z.number().int().min(1).max(30).default(2),
}).strict();
export const StoryImportRequestSchema = StoryImportInputSchema.extend({ seriesId: SeriesId }).strict();
export type StoryImportRequest = z.infer<typeof StoryImportRequestSchema>;
export type StoryImportStatus = "queued" | "running" | "succeeded" | "failed";
export interface StoryImportJob {
  id: string;
  request: StoryImportRequest;
  status: StoryImportStatus;
  result: Record<string, unknown> | null;
  error: { code: string; message: string } | null;
  createdAt: string;
  updatedAt: string;
}

export interface StudioJob {
  metrics?: {elapsedMs:number;peakRssBytes:number;eventLoopLagP95Ms:number;counters:Record<string,number>;phases?:Array<{step:number;message:string;elapsedMs:number}>};
  leaseVersion?:number;
  id: string;
  request: ProductionRequest;
  status: JobStatus;
  control: "run" | "pause" | "cancel";
  progress: { step: number; total: number; message: string } | null;
  result: { videoPath: string; audioPath: string; outputDir: string; isMock: boolean; reroll?: { shotId: string; takeId: string; isApproved: boolean }; metrics?:StudioJob["metrics"];artifactIds?:string[]; postprocess?:Record<string,unknown>; qaStatus?: "PASS" | "NEEDS_REVIEW" | "MOCK"; evidencePaths?: string[]; financialStatus?:"settled"|"estimated"|"uncertain"; costLedger?: { estimated: number; reserved: number; confirmed: number; confirmedInvoiced?: number; confirmedEstimated?: number; uncertain: number }; season?: import("./season.js").SeasonProductionResult } | null;
  error: { code: string; message: string } | null;
  createdAt: string;
  updatedAt: string;
}
export const DraftSchema = z.object({
  baseVersion: z.number().int().min(0),
  text: z.string().max(2_000_000),
}).strict();
