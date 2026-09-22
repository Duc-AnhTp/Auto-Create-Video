import { JobStore } from "./job-store.js";
import "../utils/media-runtime.js";
import { EpisodicPipeline } from "../series/episodic-pipeline.js";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { redact } from "../utils/redact.js";
import { SettingsManager } from "./settings-manager.js";

const store = new JobStore(process.argv[2]);
const owner = randomUUID();
const parentPid = Number(process.argv[3]);
let stopping = false;
process.on("SIGTERM", () => { stopping = true; });
process.on("SIGINT", () => { stopping = true; });

while (!stopping) {
  try { process.kill(parentPid, 0); } catch { break; }
  const job = store.claim(owner);
  if (!job) { await delay(500); continue; }
  Object.assign(process.env, new SettingsManager().readEnvConfig());
  const heartbeat = setInterval(() => {
    if (!store.heartbeat(job.id, owner)) stopping = true;
  }, 5000);
  let pipeline: EpisodicPipeline | undefined;
  try {
    const checkpoint = async () => {
      while (true) {
        if (stopping) throw new Error("WORKER_STOPPING");
        const current = store.get(job.id);
        if (current.control === "cancel") throw new Error("JOB_CANCELLED");
        if (current.control !== "pause") return;
        await delay(250);
      }
    };
    await checkpoint();
    pipeline = new EpisodicPipeline(join("data", "series", job.request.seriesId, "story_bible.db"));
    const result = await pipeline.produceEpisode(job.request.rawScreenplay, {
      seriesId: job.request.seriesId,
      provider: job.request.provider,
      dryRun: job.request.mode === "mock",
      resume: job.request.resume,
      budgetCapUsd: job.request.budgetCapUsd,
      maxReRolls: job.request.maxReRolls,
      allowMockMedia: job.request.mode === "mock",
      useHierarchicalAssembly: true,
      autoCommitCanon: true,
      checkpoint,
      expectedEpisodeNumber: job.request.episodeNumber,
      onProgress: (step, total, message) => store.update(job.id, owner, { progress: { step, total, message: redact(message) } }),
    });
    await checkpoint();
    const needsReview = !result.auditPassed || !result.videoPath || (!result.isMock && !result.committedCanon);
    store.update(job.id, owner, { result: { videoPath: result.videoPath, audioPath: result.audioPath, outputDir: result.outputDir, isMock: result.isMock }, error: needsReview ? { code: "REVIEW_REQUIRED", message: "Cần kiểm tra chất lượng hoặc duyệt canon trước khi hoàn tất." } : null }, needsReview ? "needs_review" : "succeeded");
  } catch (error) {
    const message = redact(error instanceof Error ? error.message : String(error));
    const cancelled = message === "JOB_CANCELLED";
    const review = /uncertain|budget|approval|approved|QA|UNAVAILABLE|continuity/i.test(message);
    if (message !== "WORKER_STOPPING") store.update(job.id, owner, { error: { code: cancelled ? "JOB_CANCELLED" : review ? "REVIEW_REQUIRED" : "PRODUCTION_FAILED", message } }, cancelled ? "cancelled" : review ? "needs_review" : "failed");
  } finally { clearInterval(heartbeat); pipeline?.close(); }
}
store.close();
