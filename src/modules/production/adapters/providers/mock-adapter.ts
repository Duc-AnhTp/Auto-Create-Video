import { mkdir } from "node:fs/promises";
import { join,dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { createProviderMediaCache,renderFingerprint } from "../../../media/index.js";
import type { VideoProviderAdapter, ShotExecutionSpec, VideoJobStatus } from "../../../../contracts/video.js";
import { createValidMockMp4File } from "../../../media/index.js";
import { PROVIDER_CAPABILITY_REGISTRY } from "../../domain/provider-capabilities.js";
import { type ProviderCapabilities } from "../../../../contracts/video.js";

/**
 * Mock Video Provider Adapter for deterministic offline testing and pipeline dry-runs.
 * Simulates video generation without consuming API credits or requiring GPU access.
 */
export class MockVideoAdapter implements VideoProviderAdapter {
  public providerName = "mock" as const;
  public capabilities: ProviderCapabilities = PROVIDER_CAPABILITY_REGISTRY.mock;
  private jobs: Map<string, { spec: ShotExecutionSpec; createdAt: number }> = new Map();
  private outputDir: string;

  constructor(outputDir = "output/mock-videos") {
    this.outputDir = outputDir;
  }

  public async submitJob(spec: ShotExecutionSpec): Promise<{ jobId: string }> {
    const jobId = `mock_${spec.shotId}_${randomUUID()}`;
    this.jobs.set(jobId, { spec, createdAt: Date.now() });
    return { jobId };
  }
  restoreJob(jobId:string,spec:ShotExecutionSpec):void{if(!this.jobs.has(jobId))this.jobs.set(jobId,{spec,createdAt:Date.now()});}

  public async pollStatus(jobId: string): Promise<VideoJobStatus> {
    const job = this.jobs.get(jobId);
    if (!job) {
      return { jobId, status: "failed", error: `Job ${jobId} not found` };
    }

    // Ensure output directory exists
    const mockFilePath=job.spec.destinationLocalPath??join(this.outputDir,`${jobId}.mp4`);
    await mkdir(dirname(mockFilePath), { recursive: true });

    // Generate a placeholder mock file
    // Create a valid binary MP4 container if not already existing
    const cache=createProviderMediaCache(mockFilePath+".mock.json"),fingerprint=renderFingerprint(job.spec);
    if(!await cache.hit(fingerprint)){await createValidMockMp4File(mockFilePath,job.spec.durationSec);await cache.record(fingerprint,[{path:mockFilePath,kind:"video"}]);}

    return {
      jobId,
      status: "completed",
      durationSec: job.spec.durationSec,
      localPath: mockFilePath,
    };
  }
}
