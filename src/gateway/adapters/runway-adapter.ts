import axios from "axios";
import type { VideoProviderAdapter, ShotExecutionSpec, VideoJobStatus } from "../video-gateway.js";
import { resolveImageToDataUriOrUrl } from "../asset-resolver.js";
import { PROVIDER_CAPABILITY_REGISTRY, type ProviderCapabilities } from "../provider-capabilities.js";

export interface RunwayAdapterConfig {
  apiKey?: string;
  baseUrl?: string;
}

/**
 * Runway Gen-3 Alpha Turbo Adapter
 * Supports character and world consistency using promptImage conditioning.
 */
export class RunwayAdapter implements VideoProviderAdapter {
  public providerName = "api_runway" as const;
  public capabilities: ProviderCapabilities = PROVIDER_CAPABILITY_REGISTRY.api_runway;
  private apiKey: string;
  private baseUrl: string;

  constructor(config: RunwayAdapterConfig = {}) {
    this.apiKey = config.apiKey || process.env.RUNWAY_API_KEY || "";
    this.baseUrl = config.baseUrl || process.env.RUNWAY_BASE_URL || "https://api.dev.runwayml.com";
  }

  public async submitJob(spec: ShotExecutionSpec): Promise<{ jobId: string }> {
    if (!this.apiKey) {
      throw new Error("RUNWAY_API_KEY is not configured in environment or config");
    }

    // Runway Gen-3 Alpha Turbo strictly supports 5s or 10s
    const durationNum = spec.durationSec >= 8 ? 10 : 5;

    const payload: Record<string, unknown> = {
      promptText: spec.prompt,
      model: "gen3a_turbo",
      duration: durationNum,
      ratio: spec.aspectRatio === "16:9" ? "1280:768" : "768:1280", // Runway Gen-3 format
    };

    if (spec.seed !== undefined && spec.seed > 0) {
      payload.seed = Math.floor(spec.seed);
    }

    const resolvedImage = await resolveImageToDataUriOrUrl(spec.referenceImage || spec.firstFrameCondition);
    if (resolvedImage) {
      payload.promptImage = resolvedImage;
    }

    const response = await axios.post(`${this.baseUrl}/v1/image_to_video`, payload, {
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "X-Runway-Version": "2024-09-13",
        "Content-Type": "application/json",
      },
      timeout: 15000,
    });

    const data = response.data;
    const id = data.id || data.task_id;
    if (!id) {
      throw new Error(`Runway API did not return a task id: ${JSON.stringify(data)}`);
    }

    return { jobId: id };
  }

  public async pollStatus(jobId: string): Promise<VideoJobStatus> {
    if (!this.apiKey) {
      throw new Error("RUNWAY_API_KEY is not configured");
    }

    const response = await axios.get(`${this.baseUrl}/v1/tasks/${jobId}`, {
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "X-Runway-Version": "2024-09-13",
      },
      timeout: 10000,
    });

    const data = response.data;
    const status = data.status?.toUpperCase();

    if (status === "SUCCEEDED" || status === "COMPLETED") {
      const outputUrl = Array.isArray(data.output) ? data.output[0] : data.output;
      return {
        jobId,
        status: "completed",
        videoUrl: outputUrl,
        durationSec: data.duration,
      };
    }

    if (status === "FAILED") {
      return {
        jobId,
        status: "failed",
        error: data.failure || data.failureCode || "Runway task failed",
      };
    }

    return {
      jobId,
      status: status === "PENDING" ? "queued" : "running",
    };
  }
}
