import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { VideoProviderAdapter, ShotExecutionSpec, VideoJobStatus } from "../video-gateway.js";
import { createValidMockMp4File } from "../../assets/mock-media-generator.js";
import { PROVIDER_CAPABILITY_REGISTRY, type ProviderCapabilities } from "../provider-capabilities.js";

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
    const jobId = `mock_${spec.shotId}_${Date.now()}`;
    this.jobs.set(jobId, { spec, createdAt: Date.now() });
    return { jobId };
  }

  public async pollStatus(jobId: string): Promise<VideoJobStatus> {
    const job = this.jobs.get(jobId);
    if (!job) {
      return { jobId, status: "failed", error: `Job ${jobId} not found` };
    }

    // Ensure output directory exists
    await mkdir(this.outputDir, { recursive: true });

    // Generate a placeholder mock file
    const mockFilePath = join(this.outputDir, `${job.spec.shotId}.mp4`);
    // Create a valid binary MP4 container if not already existing
    try {
      await createValidMockMp4File(mockFilePath, job.spec.durationSec);
    } catch {
      // Ignore
    }

    return {
      jobId,
      status: "completed",
      durationSec: job.spec.durationSec,
      localPath: mockFilePath,
    };
  }
}
