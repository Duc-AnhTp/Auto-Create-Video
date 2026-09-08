import axios from "axios";
import type { VideoProviderAdapter, ShotExecutionSpec, VideoJobStatus } from "../video-gateway.js";

export interface KlingAdapterConfig {
  apiKey?: string;
  baseUrl?: string;
}

/**
 * Kling AI Video Provider Adapter
 * Supports Image-to-Video (I2V) with character/location reference image conditioning
 * and Text-to-Video (T2V) fallback.
 */
export class KlingAdapter implements VideoProviderAdapter {
  public providerName = "api_kling" as const;
  private apiKey: string;
  private baseUrl: string;

  constructor(config: KlingAdapterConfig = {}) {
    this.apiKey = config.apiKey || process.env.KLING_API_KEY || "";
    this.baseUrl = config.baseUrl || process.env.KLING_BASE_URL || "https://api.klingai.com";
  }

  public async submitJob(spec: ShotExecutionSpec): Promise<{ jobId: string }> {
    if (!this.apiKey) {
      throw new Error("KLING_API_KEY is not configured in environment or config");
    }

    const isI2v = Boolean(spec.referenceImage || spec.firstFrameCondition);
    const endpoint = isI2v ? `${this.baseUrl}/v1/videos/image2video` : `${this.baseUrl}/v1/videos/text2video`;

    const payload: Record<string, unknown> = {
      prompt: spec.prompt,
      duration: String(Math.round(spec.durationSec)),
      aspect_ratio: spec.aspectRatio || "9:16",
    };

    if (spec.referenceImage) {
      payload.image = spec.referenceImage;
    }
    if (spec.firstFrameCondition) {
      payload.image = spec.firstFrameCondition;
    }

    const response = await axios.post(endpoint, payload, {
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      timeout: 15000,
    });

    const data = response.data;
    if (data.code !== 0 && data.code !== 200 && !data.data?.task_id) {
      throw new Error(`Kling API error: ${data.message || JSON.stringify(data)}`);
    }

    const taskId = data.data?.task_id || data.task_id;
    return { jobId: taskId };
  }

  public async pollStatus(jobId: string): Promise<VideoJobStatus> {
    if (!this.apiKey) {
      throw new Error("KLING_API_KEY is not configured");
    }

    const response = await axios.get(`${this.baseUrl}/v1/videos/tasks/${jobId}`, {
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
      },
      timeout: 10000,
    });

    const data = response.data?.data || response.data;
    const taskStatus = data.task_status || data.status;

    if (taskStatus === "succeed" || taskStatus === "completed") {
      const videoResult = data.task_result?.videos?.[0] || data.videos?.[0];
      return {
        jobId,
        status: "completed",
        videoUrl: videoResult?.url,
        durationSec: videoResult?.duration ? parseFloat(videoResult.duration) : undefined,
      };
    }

    if (taskStatus === "failed") {
      return {
        jobId,
        status: "failed",
        error: data.task_status_msg || "Kling generation failed",
      };
    }

    return {
      jobId,
      status: taskStatus === "submitted" ? "queued" : "running",
    };
  }
}
