import axios from "axios";
import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import type {
  VideoProviderAdapter,
  ShotExecutionSpec,
  VideoJobStatus,
  BackendProvider,
} from "../video-gateway.js";
import {
  PROVIDER_CAPABILITY_REGISTRY,
  type ProviderCapabilities,
} from "../provider-capabilities.js";
import { createValidMockMp4File } from "../../assets/mock-media-generator.js";

export interface ServerlessComfyUIConfig {
  endpoint: string; // e.g. "https://api.runpod.ai/v2/{id}" or "https://modal.com/api/..."
  apiKey?: string;
  mockFallback?: boolean;
}

/**
 * Serverless ComfyUI Cloud Adapter (Modal / RunPod).
 * Enables auto-scaling GPU rendering from 0 to 20+ GPUs in parallel for fast episode production.
 */
export class ServerlessComfyUIAdapter implements VideoProviderAdapter {
  public providerName: BackendProvider = "serverless_comfyui";
  public capabilities: ProviderCapabilities = PROVIDER_CAPABILITY_REGISTRY.serverless_comfyui;
  private submittedSpecs: Map<string, ShotExecutionSpec> = new Map();

  constructor(private cfg: ServerlessComfyUIConfig) {}

  public async submitJob(spec: ShotExecutionSpec): Promise<{ jobId: string }> {
    try {
      const url = `${this.cfg.endpoint.replace(/\/+$/, "")}/run`;
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (this.cfg.apiKey) {
        headers["Authorization"] = `Bearer ${this.cfg.apiKey}`;
      }

      const payload = {
        input: {
          shot_id: spec.shotId,
          prompt: spec.prompt,
          negative_prompt: spec.negativePrompt,
          duration_sec: spec.durationSec,
          aspect_ratio: spec.aspectRatio || "16:9",
          reference_image: spec.referenceImage,
          character_reference_image: spec.characterReferenceImage,
          seed: spec.seed,
        },
      };

      const resp = await axios.post<{ id: string; status: string }>(url, payload, {
        headers,
        timeout: 30000,
      });

      const jobId = resp.data.id;
      if (this.submittedSpecs.size > 500) {
        const oldestKey = this.submittedSpecs.keys().next().value;
        if (oldestKey) this.submittedSpecs.delete(oldestKey);
      }
      this.submittedSpecs.set(jobId, spec);
      return { jobId };
    } catch (err: any) {
      if (this.cfg.mockFallback || process.env.NODE_ENV === "test") {
        const mockJobId = `mock_serverless_${spec.shotId}_${Date.now()}`;
        if (this.submittedSpecs.size > 500) {
          const oldestKey = this.submittedSpecs.keys().next().value;
          if (oldestKey) this.submittedSpecs.delete(oldestKey);
        }
        this.submittedSpecs.set(mockJobId, spec);
        return { jobId: mockJobId };
      }
      throw new Error(`[SERVERLESS COMFYUI] Submit job failed: ${err?.message || err}`);
    }
  }

  public async pollStatus(jobId: string): Promise<VideoJobStatus> {
    if (jobId.startsWith("mock_serverless_")) {
      const spec = this.submittedSpecs.get(jobId);
      if (spec?.destinationLocalPath && !existsSync(spec.destinationLocalPath)) {
        await createValidMockMp4File(spec.destinationLocalPath, spec.durationSec || 4.0);
        return {
          jobId,
          status: "completed",
          videoUrl: `file://${spec.destinationLocalPath.replace(/\\/g, "/")}`,
          localPath: spec.destinationLocalPath,
          durationSec: spec.durationSec || 4.0,
        };
      }
      return {
        jobId,
        status: "completed",
        videoUrl: `http://mock.serverless/video/${jobId}.mp4`,
        durationSec: spec?.durationSec || 4.0,
      };
    }

    try {
      const url = `${this.cfg.endpoint.replace(/\/+$/, "")}/status/${jobId}`;
      const headers: Record<string, string> = {};
      if (this.cfg.apiKey) {
        headers["Authorization"] = `Bearer ${this.cfg.apiKey}`;
      }

      const resp = await axios.get<{
        id: string;
        status: "IN_QUEUE" | "IN_PROGRESS" | "COMPLETED" | "FAILED";
        output?: { video_url?: string };
        error?: string;
      }>(url, { headers, timeout: 15000 });

      const spec = this.submittedSpecs.get(jobId);
      const body = resp.data;
      if (body.status === "COMPLETED") {
        const localPath = spec?.destinationLocalPath;
        const durationSec = spec?.durationSec;
        this.submittedSpecs.delete(jobId);
        return {
          jobId,
          status: "completed",
          videoUrl: body.output?.video_url,
          localPath,
          durationSec,
        };
      } else if (body.status === "FAILED") {
        this.submittedSpecs.delete(jobId);
        return {
          jobId,
          status: "failed",
          error: body.error || "Serverless job failed",
        };
      } else if (body.status === "IN_PROGRESS") {
        return {
          jobId,
          status: "running",
          progress: 50,
        };
      } else {
        return {
          jobId,
          status: "queued",
          progress: 0,
        };
      }
    } catch (err: any) {
      throw new Error(`[SERVERLESS COMFYUI] Poll status failed: ${err?.message || err}`);
    }
  }
}
