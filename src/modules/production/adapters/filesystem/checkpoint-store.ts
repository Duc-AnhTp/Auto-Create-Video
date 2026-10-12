import { WorkflowError } from "../../../../platform/workflow-error.js";
import { existsSync } from "node:fs";
import { mkdir,readFile,writeFile,rm } from "node:fs/promises";
import { join } from "node:path";
import { assertMediaOwnership,publishMediaRename } from "../../../../platform/processes/media-process-runner.js";
import type { CheckpointStoreStore } from "../../ports/checkpoint-store-store.js";
import type { CheckpointStore } from "../../ports/checkpoint-store.js";
import { log } from "../../../../platform/observability/logger.js";
import { type EpisodeProductionJob } from "../../../../contracts/episode.js";
export class FileCheckpointStore implements CheckpointStore {
constructor(private bible:Pick<CheckpointStoreStore,"listShotTakes"|"getEquivalentShotIds">){}
public async load(outputDir: string): Promise<EpisodeProductionJob | null> {
    
    const checkpointPath = join(outputDir, "checkpoint.json");
    if (!existsSync(checkpointPath)) return null;
    try {
      const data = await readFile(checkpointPath, "utf8");
      const job = JSON.parse(data) as EpisodeProductionJob;
      if (!job.shotProgress && job.shots) {
        job.shotProgress = Object.values(job.shots);
      }
      return job;
    } catch (error) {
      log.warn(`Checkpoint unavailable at ${checkpointPath}: ${error instanceof Error ? error.message : String(error)}`);
      throw new WorkflowError("CHECKPOINT_REVIEW_REQUIRED", "Checkpoint không đọc được; giữ tài sản và yêu cầu kiểm tra.", "needs_review", {cause:error});
    }
  }

public async save(outputDir: string, job: EpisodeProductionJob): Promise<void> {
    
    assertMediaOwnership();
    await mkdir(outputDir, { recursive: true });
    job.updatedAt = new Date().toISOString();
    job.revision = (job.revision || 0) + 1;

    // Reconcile allTakes from SQLite Single Source of Truth to prevent lost updates from concurrent workers (F05)
    if (this.bible && job.seriesId && job.episodeNumber && job.shots) {
      try {
        const allDbTakes = this.bible.listShotTakes(job.seriesId, job.episodeNumber);
        for (const [shotId, shotProg] of Object.entries(job.shots)) {
          const equivIds = this.bible.getEquivalentShotIds ? this.bible.getEquivalentShotIds(shotId) : [shotId];
          const matchedDbTakes = allDbTakes.filter((t) => equivIds.includes(t.shot_id));
          if (matchedDbTakes.length > 0) {
            const dbTakeIds = matchedDbTakes.map((t) => t.id);
            const combined = Array.from(new Set([...(shotProg.allTakes || []), ...dbTakeIds]));
            shotProg.allTakes = combined;
          }
        }
      } catch (error) {
        throw new WorkflowError("CHECKPOINT_TAKE_RECONCILIATION_FAILED", "CHECKPOINT_TAKE_RECONCILIATION_FAILED", "failed", { cause: error });
      }
    }

    if (job.shots && (!job.shotProgress || job.shotProgress.length === 0)) {
      job.shotProgress = Object.values(job.shots);
    }
    const finalPath = join(outputDir, "checkpoint.json");
    const tmpPath = `${finalPath}.tmp.${Date.now()}.${Math.random().toString(36).slice(2, 8)}`;
    try { await writeFile(tmpPath, JSON.stringify(job, null, 2), "utf8");
      assertMediaOwnership();publishMediaRename(tmpPath,finalPath);assertMediaOwnership();
    } finally { await rm(tmpPath,{force:true}); }
  }
}
