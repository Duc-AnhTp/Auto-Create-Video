import axios from "axios";
import type { VideoProviderAdapter, ShotExecutionSpec, VideoJobStatus } from "../video-gateway.js";
import { resolveImageToDataUriOrUrl } from "../asset-resolver.js";
import { PROVIDER_CAPABILITY_REGISTRY, type ProviderCapabilities } from "../provider-capabilities.js";

export interface VeoAdapterConfig {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
}

/**
 * Google DeepMind Veo 3.1 Video Provider Adapter.
 * Connects to Google Cloud Vertex AI / Gemini API for high-fidelity video generation.
 * Official doc: https://cloud.google.com/vertex-ai/generative-ai/docs/image/generate-videos
 */
export class VeoAdapter implements VideoProviderAdapter {
  public providerName = "api_veo" as const;
  public capabilities: ProviderCapabilities = PROVIDER_CAPABILITY_REGISTRY.api_veo;
  private apiKey: string;
  private baseUrl: string;
  private model: string;

  constructor(config: VeoAdapterConfig = {}) {
    this.apiKey =
      config.apiKey ||
      process.env.VEO_API_KEY ||
      process.env.GEMINI_API_KEY ||
      process.env.VERTEX_API_KEY ||
      process.env.GCP_ACCESS_TOKEN ||
      "";
    this.baseUrl =
      config.baseUrl ||
      process.env.VEO_BASE_URL ||
      "https://generativelanguage.googleapis.com/v1beta";
    this.model = config.model || "veo-3.1";
  }

  public async submitJob(spec: ShotExecutionSpec): Promise<{ jobId: string }> {
    if (!this.apiKey) {
      throw new Error("VEO_API_KEY (or GEMINI_API_KEY / VERTEX_API_KEY) is not configured in environment or config");
    }

    const resolvedImage = await resolveImageToDataUriOrUrl(spec.referenceImage || spec.firstFrameCondition);
    const durationSec = spec.durationSec >= 8 ? 10 : 5;
    const aspectRatio = spec.aspectRatio || "9:16";

    // Build standard instances and parameters
    const instance: Record<string, unknown> = {
      prompt: spec.prompt,
    };

    if (resolvedImage) {
      if (resolvedImage.startsWith("data:")) {
        const matches = resolvedImage.match(/^data:([^;]+);base64,(.+)$/);
        if (matches) {
          instance.image = {
            mimeType: matches[1],
            bytesBase64Encoded: matches[2],
          };
        } else {
          instance.image = { uri: resolvedImage };
        }
      } else {
        instance.image = { uri: resolvedImage };
      }
    }

    const parameters: Record<string, unknown> = {
      sampleCount: 1,
      durationSeconds: durationSec,
      aspectRatio,
    };

    if (spec.seed !== undefined && spec.seed > 0) {
      parameters.seed = Math.floor(spec.seed);
    }

    const payload = {
      instances: [instance],
      parameters,
    };

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };

    if (this.apiKey.startsWith("Bearer ") || this.apiKey.length > 100) {
      headers["Authorization"] = this.apiKey.startsWith("Bearer ") ? this.apiKey : `Bearer ${this.apiKey}`;
    } else {
      headers["x-goog-api-key"] = this.apiKey;
    }

    const endpoint = `${this.baseUrl}/models/${this.model}:predictLongRunning`;
    const response = await axios.post(endpoint, payload, {
      headers,
      timeout: 15000,
    });

    const data = response.data;
    const operationName = data.name || data.operation?.name || data.id;
    if (!operationName) {
      throw new Error(`Google Veo API error: No operation name returned. ${JSON.stringify(data)}`);
    }

    return { jobId: operationName };
  }

  public async pollStatus(jobId: string): Promise<VideoJobStatus> {
    if (!this.apiKey) {
      throw new Error("VEO_API_KEY is not configured");
    }

    const headers: Record<string, string> = {};
    if (this.apiKey.startsWith("Bearer ") || this.apiKey.length > 100) {
      headers["Authorization"] = this.apiKey.startsWith("Bearer ") ? this.apiKey : `Bearer ${this.apiKey}`;
    } else {
      headers["x-goog-api-key"] = this.apiKey;
    }

    const cleanJobPath = jobId.startsWith("http") ? jobId : `${this.baseUrl}/${jobId}`;
    const response = await axios.get(cleanJobPath, {
      headers,
      timeout: 10000,
    });

    const data = response.data;

    // Check failure
    if (data.error) {
      return {
        jobId,
        status: "failed",
        error: data.error.message || JSON.stringify(data.error),
      };
    }

    // Check completion
    if (data.done === true) {
      const resp = data.response || {};
      const samples = resp.generatedSamples || resp.videos || resp.predictions;
      const firstSample = Array.isArray(samples) ? samples[0] : samples;
      const videoUri = firstSample?.video?.uri || firstSample?.uri || firstSample?.videoUrl;

      if (!videoUri) {
        return {
          jobId,
          status: "failed",
          error: `Veo operation marked as done but no video URI found: ${JSON.stringify(data)}`,
        };
      }

      return {
        jobId,
        status: "completed",
        videoUrl: videoUri,
        durationSec: firstSample?.video?.duration ? parseFloat(firstSample.video.duration) : undefined,
      };
    }

    // Otherwise running or queued
    return {
      jobId,
      status: data.metadata?.state === "QUEUED" ? "queued" : "running",
    };
  }
}
