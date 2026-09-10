import axios from "axios";
import type { VideoProviderAdapter, ShotExecutionSpec, VideoJobStatus } from "../video-gateway.js";
import { resolveImageToDataUriOrUrl } from "../asset-resolver.js";
import { PROVIDER_CAPABILITY_REGISTRY, type ProviderCapabilities } from "../provider-capabilities.js";

export interface SeedanceAdapterConfig {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
}

/**
 * ByteDance Seedance 2.0 (Doubao Video / Seaweed) Video Provider Adapter.
 * Connects to Volcano Engine Ark API / Seedance API for high-consistency character & shot video generation.
 * Official doc: https://www.volcengine.com/docs/82379/1344400
 */
export class SeedanceAdapter implements VideoProviderAdapter {
  public providerName = "api_seedance" as const;
  public capabilities: ProviderCapabilities = PROVIDER_CAPABILITY_REGISTRY.api_seedance;
  private apiKey: string;
  private baseUrl: string;
  private model: string;

  constructor(config: SeedanceAdapterConfig = {}) {
    this.apiKey =
      config.apiKey ||
      process.env.SEEDANCE_API_KEY ||
      process.env.VOLC_API_KEY ||
      process.env.ARK_API_KEY ||
      "";
    this.baseUrl =
      config.baseUrl ||
      process.env.SEEDANCE_BASE_URL ||
      "https://ark.cn-beijing.volces.com/api/v3";
    this.model = config.model || "seedance-2.0";
  }

  public async submitJob(spec: ShotExecutionSpec): Promise<{ jobId: string }> {
    if (!this.apiKey) {
      throw new Error("SEEDANCE_API_KEY (or VOLC_API_KEY / ARK_API_KEY) is not configured in environment or config");
    }

    const resolvedImage = await resolveImageToDataUriOrUrl(spec.referenceImage || spec.firstFrameCondition);
    const durationNum = spec.durationSec >= 8 ? 10 : 5;
    const ratio = spec.aspectRatio || "9:16";

    // Build content array (text + optional image)
    const contentItems: Array<Record<string, unknown>> = [
      {
        type: "text",
        text: spec.prompt,
      },
    ];

    if (resolvedImage) {
      contentItems.push({
        type: "image_url",
        image_url: {
          url: resolvedImage,
        },
      });
    }

    const payload: Record<string, unknown> = {
      model: this.model,
      content: contentItems,
      duration: durationNum,
      ratio,
    };

    if (spec.seed !== undefined && spec.seed > 0) {
      payload.seed = Math.floor(spec.seed);
    }

    const endpoint = `${this.baseUrl}/contents/generations/tasks`;
    const response = await axios.post(endpoint, payload, {
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      timeout: 15000,
    });

    const data = response.data;
    const taskId = data.id || data.task_id || data.data?.id || data.data?.task_id;
    if (!taskId) {
      throw new Error(`ByteDance Seedance API error: No task id returned. ${JSON.stringify(data)}`);
    }

    return { jobId: taskId };
  }

  public async pollStatus(jobId: string): Promise<VideoJobStatus> {
    if (!this.apiKey) {
      throw new Error("SEEDANCE_API_KEY is not configured");
    }

    const endpoint = `${this.baseUrl}/contents/generations/tasks/${jobId}`;
    const response = await axios.get(endpoint, {
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
      },
      timeout: 10000,
    });

    const data = response.data;
    const rawStatus = (data.status || data.data?.status || "").toUpperCase();

    if (rawStatus === "SUCCEEDED" || rawStatus === "COMPLETED" || rawStatus === "SUCCESS") {
      const content = data.content || data.result || data.data?.content || data.data?.result || {};
      const videoUrl = content.video_url || content.url || data.video_url;

      if (!videoUrl) {
        return {
          jobId,
          status: "failed",
          error: `Seedance task succeeded but no video URL returned: ${JSON.stringify(data)}`,
        };
      }

      return {
        jobId,
        status: "completed",
        videoUrl,
        durationSec: content.duration ? parseFloat(content.duration) : undefined,
      };
    }

    if (rawStatus === "FAILED" || rawStatus === "ERROR") {
      const errorMsg =
        data.error?.message ||
        data.failure_reason ||
        data.data?.error?.message ||
        "Seedance generation failed";
      return {
        jobId,
        status: "failed",
        error: errorMsg,
      };
    }

    return {
      jobId,
      status: rawStatus === "QUEUED" ? "queued" : "running",
    };
  }
}
