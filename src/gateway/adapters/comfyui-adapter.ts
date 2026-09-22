import axios from "axios";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { basename } from "node:path";
import { log } from "../../utils/logger.js";
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
   * Builds standard Wan 2.1 / Wan 2.2 ComfyUI workflow graph with optional IP-Adapter FaceID and regional conditioning.
   */
  public buildPromptWorkflow(
    spec: ShotExecutionSpec,
    inputImageName?: string,
    charFaceImageName?: string,
    secondaryCharFaceImageName?: string
  ): Record<string, unknown> {
    if (this.workflowTemplate) {
      // Clone custom template and dynamically inject prompt, input image, and face reference
      const graph = JSON.parse(JSON.stringify(this.workflowTemplate));

      // Pre-pass: trace node graph connections to distinguish face conditioning vs scene input image nodes
      const faceLoadImageIds = new Set<string>();
      const sceneLoadImageIds = new Set<string>();
      for (const nodeKey of Object.keys(graph)) {
        const n = graph[nodeKey];
        if (n && typeof n === "object" && n.inputs) {
          const classType = String(n.class_type || "").toLowerCase();
          if (classType.includes("ipadapter") || classType.includes("insightface") || classType.includes("faceid")) {
            for (const inputVal of Object.values(n.inputs)) {
              if (Array.isArray(inputVal) && typeof inputVal[0] === "string") {
                faceLoadImageIds.add(inputVal[0]);
              }
            }
          }
          if (classType.includes("vaeencode") || classType.includes("imagetovideo") || classType.includes("sampler")) {
            for (const inputVal of Object.values(n.inputs)) {
              if (Array.isArray(inputVal) && typeof inputVal[0] === "string") {
                sceneLoadImageIds.add(inputVal[0]);
              }
            }
          }
        }
      }

      let faceAssigned = false;
      let sceneAssigned = false;

      for (const nodeKey of Object.keys(graph)) {
        const node = graph[nodeKey];
        if (node && typeof node === "object" && node.inputs) {
          if (node.class_type === "CLIPTextEncode" || (node.inputs.text !== undefined && typeof node.inputs.text === "string")) {
            const title = String(node._meta?.title || node.title || "").toLowerCase();
            const isNegative = title.includes("negative") || node.inputs.text.includes("{{negative_prompt}}");
            if (isNegative) {
              node.inputs.text = spec.negativePrompt || "";
            } else if (
              node.inputs.text.includes("{{prompt}}") ||
              node.inputs.text === "prompt" ||
              title.includes("positive") ||
              (node.inputs.text === "" && !title.includes("negative"))
            ) {
              node.inputs.text = spec.prompt;
            }
          }
          if (node.class_type === "LoadImage" && node.inputs.image !== undefined) {
            const title = String(node._meta?.title || node.title || "").toLowerCase();
            const isExplicitFace =
              title.includes("face") ||
              title.includes("character") ||
              title.includes("ipadapter") ||
              title.includes("portrait") ||
              faceLoadImageIds.has(nodeKey);
            const isExplicitScene =
              title.includes("input") ||
              title.includes("init") ||
              title.includes("scene") ||
              title.includes("background") ||
              title.includes("source") ||
              sceneLoadImageIds.has(nodeKey);

            if (charFaceImageName && isExplicitFace) {
              node.inputs.image = charFaceImageName;
              faceAssigned = true;
            } else if (inputImageName && isExplicitScene) {
              node.inputs.image = inputImageName;
              sceneAssigned = true;
            } else if (charFaceImageName && inputImageName) {
              // Ambiguous LoadImage nodes: don't overwrite both with inputImageName!
              if (!faceAssigned) {
                node.inputs.image = charFaceImageName;
                faceAssigned = true;
              } else if (!sceneAssigned) {
                node.inputs.image = inputImageName;
                sceneAssigned = true;
              }
            } else if (inputImageName && !sceneAssigned) {
              node.inputs.image = inputImageName;
              sceneAssigned = true;
            } else if (charFaceImageName && !faceAssigned) {
              node.inputs.image = charFaceImageName;
              faceAssigned = true;
            }
          }
          if (node.class_type === "IPAdapterApply" || node.class_type === "ApplyIPAdapter") {
            if (spec.ipAdapterWeight !== undefined && node.inputs.weight !== undefined) {
              node.inputs.weight = spec.ipAdapterWeight;
            }
          }
        }
      }
      return graph;
    }

    // Default built-in Wan 2.1/2.2 standard nodes structure with optional Dual IP-Adapter and Regional conditioning
    const width = spec.aspectRatio === "16:9" ? 1280 : 720;
    const height = spec.aspectRatio === "16:9" ? 720 : 1280;
    const frames = Math.max(16, Math.round(spec.durationSec * 16)); // ~16 fps
    const hasFaceConsistency = Boolean(charFaceImageName);
    const hasSecondaryFace = Boolean(secondaryCharFaceImageName);
    const hasDualConditioning = hasFaceConsistency && Boolean(inputImageName);
    const ipWeight = spec.ipAdapterWeight ?? 0.8;
    const isFp8 = process.env.COMFYUI_WAN_PRECISION === "fp8";
    const t2vCkpt = isFp8 ? "wan2.1_t2v_720p_14B_fp8.safetensors" : "wan2.1_t2v_720p_14B.safetensors";
    const i2vCkpt = isFp8 ? "wan2.1_i2v_720p_14B_fp8.safetensors" : "wan2.1_i2v_720p_14B.safetensors";
    const isWan = t2vCkpt.toLowerCase().includes("wan");

    // Determine final model conditioning chain
    let finalModelInput: [string, number] = ["4", 0];
    if (hasSecondaryFace) {
      finalModelInput = ["18", 0]; // Primary face -> Secondary face conditioning
    } else if (hasDualConditioning) {
      finalModelInput = ["16", 0]; // Face ("14") -> Style/Costume ("16")
    } else if (hasFaceConsistency) {
      finalModelInput = ["14", 0]; // Face only
    }

    // Partition prompt with regional spatial attention if enabled
    let promptText = spec.prompt;
    if (spec.regionalConditioning?.enabled) {
      const charAPrompt = spec.regionalConditioning.characterAPrompt || "";
      const charBPrompt = spec.regionalConditioning.characterBPrompt || "";
      const sideA = spec.regionalConditioning.characterASide || "left";
      const sideB = spec.regionalConditioning.characterBSide || "right";
      if (charAPrompt || charBPrompt) {
        promptText = `${promptText}, [REGIONAL: ${sideA} side: ${charAPrompt}, ${sideB} side: ${charBPrompt}]`;
      }
    }

    return {
      "3": {
        inputs: {
          seed: spec.seed !== undefined ? Math.floor(spec.seed) : Math.floor(Math.random() * 1000000000),
          steps: 25,
          cfg: 6.0,
          sampler_name: "uni_pc",
          scheduler: "simple",
          denoise: 1.0,
          model: finalModelInput,
          positive: ["6", 0],
          negative: ["7", 0],
          latent_image: inputImageName ? ["11", 0] : ["5", 0],
        },
        class_type: "KSampler",
      },
      "4": {
        inputs: {
          ckpt_name: inputImageName ? i2vCkpt : t2vCkpt,
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
          text: promptText,
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
            "11": {
              inputs: {
                pixels: ["10", 0],
                vae: ["4", 2],
              },
              class_type: "VAEEncode",
            },
          }
        : {}),
      ...(hasFaceConsistency
        ? {
            "12": {
              inputs: {
                image: charFaceImageName!,
                upload: "image",
              },
              class_type: "LoadImage",
            },
            "13": {
              inputs: {
                ipadapter_file: isWan ? "ip-adapter_wan2.1_face.safetensors" : "ip-adapter-plus-face_sdxl_vit-h.safetensors",
              },
              class_type: isWan ? "WanIPAdapterModelLoader" : "IPAdapterModelLoader",
            },
            "14": {
              inputs: {
                model: ["4", 0],
                ipadapter: ["13", 0],
                clip_vision: ["15", 0],
                image: ["12", 0],
                weight: ipWeight,
              },
              class_type: isWan ? "WanIPAdapterApply" : "IPAdapterApply",
            },
            "15": {
              inputs: {
                clip_name: isWan ? "clip_vision_wan2.1.safetensors" : "CLIP-ViT-H-14-laion2B-s32B-b79K.safetensors",
              },
              class_type: isWan ? "WanCLIPVisionLoader" : "CLIPVisionLoader",
            },
          }
        : {}),
      ...(hasDualConditioning
        ? {
            "16": {
              inputs: {
                model: ["14", 0],
                ipadapter: ["13", 0],
                clip_vision: ["15", 0],
                image: ["10", 0],
                weight: Math.min(0.6, ipWeight * 0.75),
              },
              class_type: isWan ? "WanIPAdapterApply" : "IPAdapterApply",
            },
          }
        : {}),
      ...(hasSecondaryFace
        ? {
            "17": {
              inputs: {
                image: secondaryCharFaceImageName!,
                upload: "image",
              },
              class_type: "LoadImage",
            },
            "18": {
              inputs: {
                model: hasDualConditioning ? ["16", 0] : hasFaceConsistency ? ["14", 0] : ["4", 0],
                ipadapter: ["13", 0],
                clip_vision: ["15", 0],
                image: ["17", 0],
                weight: Math.min(0.7, ipWeight * 0.9),
              },
              class_type: isWan ? "WanIPAdapterApply" : "IPAdapterApply",
            },
          }
        : {}),
    };
  }

  public async submitJob(spec: ShotExecutionSpec): Promise<{ jobId: string }> {
    try {
      let uploadedImage: string | undefined = undefined;
      const refImg = spec.referenceImage || spec.firstFrameCondition;
      if (refImg) {
        if (!existsSync(refImg)) {
          throw new Error(
            `[COMFYUI ERROR] File ảnh tham chiếu không tồn tại trên đĩa cho shot [${spec.shotId}]: '${refImg}'`
          );
        } else {
          try {
            uploadedImage = await this.uploadInputImage(refImg);
          } catch (uploadErr: any) {
            // If explicit reference image is required, fail fast instead of silently producing degraded t2v
            if (spec.referenceImage) {
              throw new Error(
                `[COMFYUI UPLOAD ERROR] Không thể upload ảnh tham chiếu nhân vật cho shot [${spec.shotId}]: ${uploadErr.message}`
              );
            }
          }
        }
      }

      // Handle dedicated character face consistency image if provided
      let uploadedFaceImage: string | undefined = undefined;
      const charRefImg = spec.characterReferenceImage;
      if (charRefImg && existsSync(charRefImg)) {
        if (refImg && charRefImg === refImg && uploadedImage) {
          uploadedFaceImage = uploadedImage;
        } else {
          try {
            uploadedFaceImage = await this.uploadInputImage(charRefImg);
          } catch (faceUploadErr: any) {
            log.warn(
              `[COMFYUI FACE] Không thể upload ảnh khuôn mặt nhân vật cho shot [${spec.shotId}]: ${faceUploadErr.message}`
            );
          }
        }
      }

      // Handle secondary character face reference for multi-character 2-shot scenes
      let uploadedSecondaryFaceImage: string | undefined = undefined;
      const secRefImg = spec.secondaryCharacterReferenceImage;
      if (secRefImg && existsSync(secRefImg)) {
        try {
          uploadedSecondaryFaceImage = await this.uploadInputImage(secRefImg);
        } catch (secUploadErr: any) {
          log.warn(
            `[COMFYUI SECONDARY FACE] Không thể upload ảnh nhân vật thứ hai cho shot [${spec.shotId}]: ${secUploadErr.message}`
          );
        }
      }

      const promptWorkflow = this.buildPromptWorkflow(
        spec,
        uploadedImage,
        uploadedFaceImage,
        uploadedSecondaryFaceImage
      );
      const payload = {
        prompt: promptWorkflow,
        client_id: this.clientId,
      };

      const response = await axios.post(`${this.baseUrl}/prompt`, payload, {
        headers: { "Content-Type": "application/json" },
        timeout: Number(process.env.COMFYUI_TIMEOUT_MS) || 4000,
      });

      const promptId = response.data?.prompt_id;
      if (!promptId) {
        throw new Error(`ComfyUI did not return a prompt_id: ${JSON.stringify(response.data)}`);
      }

      return { jobId: promptId };
    } catch (err: any) {
      if (
        err.code === "ECONNREFUSED" ||
        err.code === "ETIMEDOUT" ||
        err.code === "ECONNABORTED" ||
        err.message?.includes("ECONNREFUSED") ||
        err.message?.includes("timeout")
      ) {
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
