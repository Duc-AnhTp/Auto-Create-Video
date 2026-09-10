import axios from "axios";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { basename } from "node:path";
import type { VideoProviderAdapter, ShotExecutionSpec, VideoJobStatus } from "../video-gateway.js";
import { PROVIDER_CAPABILITY_REGISTRY, type ProviderCapabilities } from "../provider-capabilities.js";

export interface ComfyUiAdapterConfig {
  baseUrl?: string;
  clientId?: string;
  workflowTemplate?: Record<string, unknown>;
  defaultCheckpoint?: string;
}

/**
 * Local ComfyUI Video Provider Adapter.
 * Connects to local ComfyUI server (default: http://127.0.0.1:8188)
 * for zero-cost GPU video generation (Wan 2.1, Wan 2.2, HunyuanVideo, or CogVideoX).
 */
export class ComfyUiAdapter implements VideoProviderAdapter {
  public providerName = "local_comfyui" as const;
  public capabilities: ProviderCapabilities = PROVIDER_CAPABILITY_REGISTRY.local_comfyui;
  private baseUrl: string;
  private clientId: string;
  private workflowTemplate?: Record<string, unknown>;

  constructor(config: ComfyUiAdapterConfig = {}) {
    const host = process.env.COMFYUI_HOST || "127.0.0.1";
    const port = process.env.COMFYUI_PORT || "8188";
    this.baseUrl = config.baseUrl || process.env.COMFYUI_BASE_URL || `http://${host}:${port}`;
    this.clientId = config.clientId || `auto_video_${Date.now()}`;
    this.workflowTemplate = config.workflowTemplate;
  }

  public getBaseUrl(): string {
    return this.baseUrl;
  }

  /**
   * Uploads an image to local ComfyUI's input directory via /upload/image endpoint.
   */
  public async uploadInputImage(imagePath: string): Promise<string> {
    if (!existsSync(imagePath)) {
      throw new Error(`Reference image not found at path: ${imagePath}`);
    }

    const fileName = basename(imagePath);
    const fileBuffer = await readFile(imagePath);

    // Build standard multipart boundary
    const boundary = `----WebKitFormBoundary${Date.now().toString(16)}`;
    const header = `--${boundary}\r\nContent-Disposition: form-data; name="image"; filename="${fileName}"\r\nContent-Type: image/jpeg\r\n\r\n`;
    const footer = `\r\n--${boundary}--\r\n`;

    const body = Buffer.concat([
      Buffer.from(header, "utf8"),
      fileBuffer,
      Buffer.from(footer, "utf8"),
    ]);

    const res = await axios.post(`${this.baseUrl}/upload/image`, body, {
      headers: {
        "Content-Type": `multipart/form-data; boundary=${boundary}`,
      },
      timeout: 15000,
    });

    return res.data?.name || fileName;
  }

  /**
   * Builds standard Wan 2.1 / Wan 2.2 ComfyUI workflow graph.
   */
  public buildPromptWorkflow(spec: ShotExecutionSpec, inputImageName?: string): Record<string, unknown> {
    if (this.workflowTemplate) {
      // Clone custom template and inject prompt
      const graph = JSON.parse(JSON.stringify(this.workflowTemplate));
      return graph;
    }

    // Default built-in Wan 2.1/2.2 standard nodes structure
    const width = spec.aspectRatio === "16:9" ? 1280 : 720;
    const height = spec.aspectRatio === "16:9" ? 720 : 1280;
    const frames = Math.max(16, Math.round(spec.durationSec * 16)); // ~16 fps

    return {
      "3": {
        inputs: {
          seed: spec.seed !== undefined ? Math.floor(spec.seed) : Math.floor(Math.random() * 1000000000),
          steps: 25,
          cfg: 6.0,
          sampler_name: "uni_pc",
          scheduler: "simple",
          denoise: 1.0,
          model: ["4", 0],
          positive: ["6", 0],
          negative: ["7", 0],
          latent_image: ["5", 0],
        },
        class_type: "KSampler",
      },
      "4": {
        inputs: {
          ckpt_name: "wan2.1_i2v_720p_14B.safetensors",
        },
        class_type: "CheckpointLoaderSimple",
      },
      "5": {
        inputs: {
          width,
          height,
          length: frames,
          batch_size: 1,
        },
        class_type: "WanVideoEmptyLatent",
      },
      "6": {
        inputs: {
          text: spec.prompt,
          clip: ["4", 1],
        },
        class_type: "CLIPTextEncode",
      },
      "7": {
        inputs: {
          text: "cartoon, low quality, blurry, deformed face, text, watermark",
          clip: ["4", 1],
        },
        class_type: "CLIPTextEncode",
      },
      "8": {
        inputs: {
          samples: ["3", 0],
          vae: ["4", 2],
        },
        class_type: "VAEDecode",
      },
      "9": {
        inputs: {
          filename_prefix: `series_${spec.shotId}`,
          fps: 16,
          images: ["8", 0],
        },
        class_type: "VHS_VideoCombine",
      },
      ...(inputImageName
        ? {
            "10": {
              inputs: {
                image: inputImageName,
                upload: "image",
              },
              class_type: "LoadImage",
            },
          }
        : {}),
    };
  }

  public async submitJob(spec: ShotExecutionSpec): Promise<{ jobId: string }> {
    try {
      let uploadedImage: string | undefined = undefined;
      const refImg = spec.referenceImage || spec.firstFrameCondition;
      if (refImg && existsSync(refImg)) {
        try {
          uploadedImage = await this.uploadInputImage(refImg);
        } catch {
          // If upload fails, continue with text prompt
        }
      }

      const promptWorkflow = this.buildPromptWorkflow(spec, uploadedImage);
      const payload = {
        prompt: promptWorkflow,
        client_id: this.clientId,
      };

      const response = await axios.post(`${this.baseUrl}/prompt`, payload, {
        headers: { "Content-Type": "application/json" },
        timeout: 10000,
      });

      const promptId = response.data?.prompt_id;
      if (!promptId) {
        throw new Error(`ComfyUI did not return a prompt_id: ${JSON.stringify(response.data)}`);
      }

      return { jobId: promptId };
    } catch (err: any) {
      if (err.code === "ECONNREFUSED" || err.message?.includes("ECONNREFUSED")) {
        throw new Error(
          `Cannot connect to ComfyUI server at ${this.baseUrl}. Ensure ComfyUI is running locally on your GPU.`
        );
      }
      throw err;
    }
  }

  public async pollStatus(jobId: string): Promise<VideoJobStatus> {
    try {
      const response = await axios.get(`${this.baseUrl}/history/${jobId}`, {
        timeout: 8000,
      });

      const historyData = response.data?.[jobId];
      if (!historyData) {
        // Still queued or executing
        return {
          jobId,
          status: "running",
        };
      }

      // Check if status has error
      if (historyData.status?.status_str === "error") {
        const errorDetails = historyData.status?.messages || "ComfyUI execution error";
        return {
          jobId,
          status: "failed",
          error: typeof errorDetails === "string" ? errorDetails : JSON.stringify(errorDetails),
        };
      }

      // Check outputs
      const outputs = historyData.outputs || {};
      let videoFilename: string | undefined;
      let subfolder = "";
      let folderType = "output";

      for (const nodeKey of Object.keys(outputs)) {
        const nodeOutput = outputs[nodeKey];
        // 1. VHS_VideoCombine or SaveVideo output
        const vids = nodeOutput.gifs || nodeOutput.videos;
        if (vids && Array.isArray(vids) && vids.length > 0) {
          videoFilename = vids[0].filename;
          subfolder = vids[0].subfolder || "";
          folderType = vids[0].type || "output";
          break;
        }
        // 2. Images output as fallback
        const imgs = nodeOutput.images;
        if (imgs && Array.isArray(imgs) && imgs.length > 0) {
          videoFilename = imgs[0].filename;
          subfolder = imgs[0].subfolder || "";
          folderType = imgs[0].type || "output";
        }
      }

      if (videoFilename) {
        const subfolderParam = subfolder ? `&subfolder=${encodeURIComponent(subfolder)}` : "";
        const videoUrl = `${this.baseUrl}/view?filename=${encodeURIComponent(videoFilename)}${subfolderParam}&type=${folderType}`;
        return {
          jobId,
          status: "completed",
          videoUrl,
        };
      }

      // Execution finished but output not found yet
      return {
        jobId,
        status: "running",
      };
    } catch (err: any) {
      if (err.code === "ECONNREFUSED" || err.message?.includes("ECONNREFUSED")) {
        throw new Error(`Lost connection to ComfyUI at ${this.baseUrl} while polling job [${jobId}]`);
      }
      throw err;
    }
  }
}
