import { z } from "zod";

export const SeriesId = z.string().min(1).max(100).regex(/^[a-zA-Z0-9_-]+$/);
export const JobStatusSchema = z.enum(["queued", "running", "paused", "needs_review", "succeeded", "failed", "cancelled"]);
export type JobStatus = z.infer<typeof JobStatusSchema>;
export const ProductionRequestSchema = z.object({
  seriesId: SeriesId,
  episodeNumber: z.number().int().positive(),
  rawScreenplay: z.string().min(1).max(2_000_000),
  provider: z.enum(["mock", "local_comfyui", "api_kling", "api_runway", "api_veo", "api_seedance"]).default("mock"),
  mode: z.enum(["mock", "production"]).default("mock"),
  budgetCapUsd: z.number().finite().positive().optional(),
  maxReRolls: z.number().int().min(0).max(2).default(2),
  resume: z.boolean().default(true),
  exportResolution: z.enum(["720p", "1080p"]).default("1080p").optional(),
}).strict().superRefine((value, ctx) => {
  if (value.mode === "production" && (value.provider === "mock" || !value.budgetCapUsd)) {
    ctx.addIssue({ code: "custom", message: "Production requires a real provider and an explicit budget cap." });
  }
});
export type ProductionRequest = z.infer<typeof ProductionRequestSchema>;
export interface StudioJob {
  id: string;
  request: ProductionRequest;
  status: JobStatus;
  control: "run" | "pause" | "cancel";
  progress: { step: number; total: number; message: string } | null;
  result: { videoPath: string; audioPath: string; outputDir: string; isMock: boolean } | null;
  error: { code: string; message: string } | null;
  createdAt: string;
  updatedAt: string;
}
export const DraftSchema = z.object({
  baseVersion: z.number().int().min(0),
  text: z.string().max(2_000_000),
}).strict();
