import type { BackendProvider, ShotExecutionSpec } from "./video-gateway.js";
import { log } from "../utils/logger.js";

export type ImageInputProtocol = "local_path" | "public_url" | "base64_data_uri" | "multipart_upload";

export interface ProviderCapabilities {
  providerName: BackendProvider;
  displayName: string;
  version?: string;
  officialDocUrl: string;
  supportedModes: ("t2v" | "i2v")[];
  /**
   * Allowed discrete durations (e.g. [5, 10] for Kling or Runway),
   * or "continuous" for engines like ComfyUI or Mock.
   */
  allowedDurationsSec: number[] | "continuous";
  minDurationSec: number;
  maxDurationSec: number;
  allowedAspectRatios: ("9:16" | "16:9" | "1:1")[];
  supportsSeed: boolean;
  supportsLastFrameExtension: boolean;
  supportsIdempotencyKey?: boolean;
  acceptedImageProtocols: ImageInputProtocol[];
  requiresNetworkDownload: boolean;
  pricingPerSecUsd: number;
  notes?: string;
}

export class CapabilityMismatchError extends Error {
  constructor(
    public provider: BackendProvider,
    public field: string,
    public reason: string,
    public supportedOptions?: unknown
  ) {
    super(
      `[Lỗi Capability Provider] Provider '${provider}' không hỗ trợ cấu hình '${field}': ${reason}` +
        (supportedOptions ? `\n  Cấu hình hợp lệ: ${JSON.stringify(supportedOptions)}` : "")
    );
    this.name = "CapabilityMismatchError";
  }
}

// ── Official Provider Capability Registry ────────────────────────────────────
export const PROVIDER_CAPABILITY_REGISTRY: Record<string, ProviderCapabilities> = {
  api_kling: {
    providerName: "api_kling",
    displayName: "Kling AI Video (v1.5 / v3.0)",
    version: "3.0",
    officialDocUrl: "https://klingai.com/api/document",
    supportedModes: ["t2v", "i2v"],
    allowedDurationsSec: [5, 10], // Kling standard API only generates discrete 5s or 10s clips
    minDurationSec: 5,
    maxDurationSec: 10,
    allowedAspectRatios: ["16:9", "9:16", "1:1"],
    supportsSeed: true, // Kling v3 supports integer seed for deterministic generations
    supportsLastFrameExtension: true, // via image2video using extracted last frame
    supportsIdempotencyKey: false, // Standard Kling API does not provide idempotency guarantee
    acceptedImageProtocols: ["public_url", "base64_data_uri"],
    requiresNetworkDownload: true,
    pricingPerSecUsd: 0.12,
    notes: "Kling 3.0 architecture. Supports discrete 5s or 10s durations, seed reproducibility, multi-shot coherence, camera motion controls.",
  },

  api_veo: {
    providerName: "api_veo",
    displayName: "Google DeepMind Veo 3.1",
    version: "3.1",
    officialDocUrl: "https://cloud.google.com/vertex-ai/generative-ai/docs/image/generate-videos",
    supportedModes: ["t2v", "i2v"],
    allowedDurationsSec: [5, 10],
    minDurationSec: 5,
    maxDurationSec: 10,
    allowedAspectRatios: ["16:9", "9:16"],
    supportsSeed: true,
    supportsLastFrameExtension: true,
    acceptedImageProtocols: ["public_url", "base64_data_uri"],
    requiresNetworkDownload: true,
    pricingPerSecUsd: 0.20,
    notes: "Google DeepMind Veo 3.1 video generation via Vertex AI / Gemini API. High temporal fidelity, supports seed, discrete 5s/10s.",
  },

  api_seedance: {
    providerName: "api_seedance",
    displayName: "ByteDance Seedance 2.0 (Doubao Video)",
    version: "2.0",
    officialDocUrl: "https://www.volcengine.com/docs/82379/1344400",
    supportedModes: ["t2v", "i2v"],
    allowedDurationsSec: [5, 10],
    minDurationSec: 5,
    maxDurationSec: 10,
    allowedAspectRatios: ["16:9", "9:16", "1:1"],
    supportsSeed: true,
    supportsLastFrameExtension: true,
    acceptedImageProtocols: ["public_url", "base64_data_uri"],
    requiresNetworkDownload: true,
    pricingPerSecUsd: 0.09,
    notes: "ByteDance Seedance 2.0 (Seaweed / Volcano Engine Ark). Discrete 5s/10s, high semantic adherence, seed support, 9:16/16:9/1:1.",
  },

  api_runway: {
    providerName: "api_runway",
    displayName: "Runway Gen-3 Alpha Turbo",
    version: "2024-09-13",
    officialDocUrl: "https://docs.dev.runwayml.com",
    supportedModes: ["t2v", "i2v"],
    allowedDurationsSec: [5, 10], // Runway Gen-3 Alpha Turbo strictly supports 5 or 10 seconds
    minDurationSec: 5,
    maxDurationSec: 10,
    allowedAspectRatios: ["16:9", "9:16"], // 1280:768 or 768:1280
    supportsSeed: true, // Supported (integer 1..4294967295)
    supportsLastFrameExtension: true, // via promptImage condition
    supportsIdempotencyKey: true, // Runway supports X-Idempotency-Key
    acceptedImageProtocols: ["public_url", "base64_data_uri"],
    requiresNetworkDownload: true,
    pricingPerSecUsd: 0.15,
    notes: "Duration strictly 5s or 10s. Image must be public URL or base64 Data URI. Seed supported.",
  },

  local_comfyui: {
    providerName: "local_comfyui",
    displayName: "Local ComfyUI (Wan 2.1 / Wan 2.2)",
    version: "0.3.x",
    officialDocUrl: "https://github.com/comfyanonymous/ComfyUI",
    supportedModes: ["t2v", "i2v"],
    allowedDurationsSec: "continuous",
    minDurationSec: 1,
    maxDurationSec: 15,
    allowedAspectRatios: ["9:16", "16:9", "1:1"],
    supportsSeed: true,
    supportsLastFrameExtension: true,
    acceptedImageProtocols: ["local_path", "multipart_upload"],
    requiresNetworkDownload: true, // downloaded from local ComfyUI /view endpoint
    pricingPerSecUsd: 0.0,
    notes: "Zero compute cost. Accepts local file paths via /upload/image. Full seed and continuous duration support.",
  },

  mock: {
    providerName: "mock",
    displayName: "Mock Media Simulator",
    version: "3.0",
    officialDocUrl: "local://tests/mock-adapter",
    supportedModes: ["t2v", "i2v"],
    allowedDurationsSec: "continuous",
    minDurationSec: 0.1,
    maxDurationSec: 60,
    allowedAspectRatios: ["9:16", "16:9", "1:1"],
    supportsSeed: true,
    supportsLastFrameExtension: true,
    supportsIdempotencyKey: true,
    acceptedImageProtocols: ["local_path", "public_url", "base64_data_uri"],
    requiresNetworkDownload: false,
    pricingPerSecUsd: 0.0,
    notes: "Deterministic offline testing engine.",
  },
};

/**
 * Validates a ShotExecutionSpec against provider capabilities before job submission.
 * Catches capability mismatches early and fails with actionable guidance.
 */
export function validateSpecAgainstCapabilities(
  spec: ShotExecutionSpec,
  caps: ProviderCapabilities,
  options: { strictSeed?: boolean } = {}
): void {
  // 1. Mode Validation (T2V vs I2V)
  const isI2v = Boolean(spec.referenceImage || spec.firstFrameCondition);
  const requiredMode = isI2v ? "i2v" : "t2v";
  if (!caps.supportedModes.includes(requiredMode)) {
    throw new CapabilityMismatchError(
      caps.providerName,
      "mode",
      `Yêu cầu chế độ '${requiredMode}' nhưng provider chỉ hỗ trợ [${caps.supportedModes.join(", ")}]`,
      caps.supportedModes
    );
  }

  // 2. Duration Validation
  if (Array.isArray(caps.allowedDurationsSec)) {
    const roundedDur = Math.round(spec.durationSec);
    if (!caps.allowedDurationsSec.includes(roundedDur)) {
      throw new CapabilityMismatchError(
        caps.providerName,
        "durationSec",
        `Thời lượng yêu cầu ${spec.durationSec}s (làm tròn ${roundedDur}s) không nằm trong danh mục thời lượng được hỗ trợ`,
        caps.allowedDurationsSec
      );
    }
  } else if (caps.allowedDurationsSec === "continuous") {
    if (spec.durationSec < caps.minDurationSec || spec.durationSec > caps.maxDurationSec) {
      throw new CapabilityMismatchError(
        caps.providerName,
        "durationSec",
        `Thời lượng ${spec.durationSec}s nằm ngoài giới hạn cho phép [${caps.minDurationSec}s - ${caps.maxDurationSec}s]`,
        { min: caps.minDurationSec, max: caps.maxDurationSec }
      );
    }
  }

  // 3. Aspect Ratio Validation
  if (spec.aspectRatio && !caps.allowedAspectRatios.includes(spec.aspectRatio)) {
    throw new CapabilityMismatchError(
      caps.providerName,
      "aspectRatio",
      `Tỷ lệ khung hình '${spec.aspectRatio}' không được hỗ trợ bởi provider này`,
      caps.allowedAspectRatios
    );
  }

  // 4. Seed Support Validation
  if (spec.seed !== undefined && !caps.supportsSeed) {
    if (options.strictSeed) {
      throw new CapabilityMismatchError(
        caps.providerName,
        "seed",
        `Provider '${caps.providerName}' không hỗ trợ tham số seed cố định để tái tạo`,
        { supportsSeed: false }
      );
    } else {
      log.warn(
        `[CAPABILITY WARNING] Provider '${caps.providerName}' không hỗ trợ seed tái tạo (${spec.seed}). Tham số seed sẽ bị bỏ qua khi gửi yêu cầu.`
      );
    }
  }

  // 5. Image Input Format Pre-flight Check (Rule 3)
  const imageInput = spec.firstFrameCondition || spec.referenceImage;
  if (imageInput) {
    const isUrl = imageInput.startsWith("http://") || imageInput.startsWith("https://");
    const isDataUri = imageInput.startsWith("data:");
    const isLocal = !isUrl && !isDataUri;

    if (isLocal && !caps.acceptedImageProtocols.includes("local_path") && !caps.acceptedImageProtocols.includes("multipart_upload")) {
      // Remote cloud APIs strictly require URL or Data URI
      throw new CapabilityMismatchError(
        caps.providerName,
        "referenceImage",
        `Đường dẫn file local ('${imageInput}') không thể gửi trực tiếp cho remote provider. Ảnh phải được mã hóa Base64 Data URI hoặc upload thành public URL.`,
        caps.acceptedImageProtocols
      );
    }
  }
}
