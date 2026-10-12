import {normalizeInvoiceAmount} from '../../../../contracts/invoice.js';
import axios from "axios";
import { type VideoProviderAdapter, type ShotExecutionSpec, type VideoJobStatus } from "../../../../contracts/video.js";
import { resolveCharacterConditioningImage } from "../../domain/conditioning.js";
import { resolveImageToDataUriOrUrl } from "../asset-resolver.js";
import { PROVIDER_CAPABILITY_REGISTRY } from "../../domain/provider-capabilities.js";
import { type ProviderCapabilities } from "../../../../contracts/video.js";
import { withHttpRetry } from "../http-retry.js";

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

    const refImg = resolveCharacterConditioningImage(spec);
    const resolvedImage = await resolveImageToDataUriOrUrl(refImg);
    if (resolvedImage) {
      payload.promptImage = resolvedImage;
    }

    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
      "X-Runway-Version": "2024-09-13",
      "Content-Type": "application/json",
    };

    const idempotencyKey = spec.metadata?.idempotencyKey;
    if (typeof idempotencyKey === "string" && idempotencyKey) {
      headers["X-Idempotency-Key"] = idempotencyKey;
    }

    const response = await withHttpRetry(
      () =>
        axios.post(`${this.baseUrl}/v1/image_to_video`, payload, {
          headers,
          timeout: 15000,
        }),
      { maxAttempts: headers["X-Idempotency-Key"] ? 3 : 1, initialDelayMs: 1000 }
    );

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

    const response = await withHttpRetry(
      () =>
        axios.get(`${this.baseUrl}/v1/tasks/${jobId}`, {
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            "X-Runway-Version": "2024-09-13",
          },
          timeout: 10000,
        }),
      { maxAttempts: 3, initialDelayMs: 1000 }
    );

    const data = response.data;
    const status = data.status?.toUpperCase();

    if (status === "SUCCEEDED" || status === "COMPLETED") {
      const outputUrl = Array.isArray(data.output) ? data.output[0] : data.output;
      const invoicedCost =
        data.invoiced_cost_usd ??
        undefined;
      return {
        jobId,
        status: "completed",
        videoUrl: outputUrl,
        durationSec: data.duration,
        invoicedCostUsd: normalizeInvoiceAmount(invoicedCost),
        isConfirmedInvoice: invoicedCost !== undefined,
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
