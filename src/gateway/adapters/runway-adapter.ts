import axios from "axios";
import type { VideoProviderAdapter, ShotExecutionSpec, VideoJobStatus } from "../video-gateway.js";

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

    const payload: Record<string, unknown> = {
      promptText: spec.prompt,
      model: "gen3a_turbo",
      duration: Math.min(10, Math.max(5, Math.round(spec.durationSec))),
      ratio: spec.aspectRatio === "16:9" ? "16:9" : "768:1280", // 9:16 format in Runway
    };

    if (spec.referenceImage) {
      payload.promptImage = spec.referenceImage;
    }
    if (spec.firstFrameCondition) {
      payload.promptImage = spec.firstFrameCondition;
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
