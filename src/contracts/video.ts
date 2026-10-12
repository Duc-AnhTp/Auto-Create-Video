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
  supportsImageInput?: boolean;
  supportsRegionalConditioning?: boolean;
  supportsIdempotencyKey?: boolean;
  supportsCancellation?:boolean;
  requiresLocalRestore?:boolean;
  acceptedImageProtocols: ImageInputProtocol[];
  requiresNetworkDownload: boolean;
  pricingPerSecUsd: number;
  notes?: string;
}

export type BackendProvider =
  | "local_comfyui"
  | "serverless_comfyui"
  | "api_wan"
  | "api_ltx"
  | "api_kling"
  | "api_runway"
  | "api_seedance"
  | "api_veo"
  | "mock";

export type CharacterTurnaroundAngle = "front" | "three_quarter" | "profile" | "full_body";

export interface CharacterTurnaroundSpec {
  front?: string;
  threeQuarter?: string;
  profile?: string;
  fullBody?: string;
  viewAngle?: CharacterTurnaroundAngle;
}

export interface ShotExecutionSpec {
  shotId: string;
  backend?: BackendProvider;
  fallbackProviders?: BackendProvider[];
  priority?: "hero" | "standard";
  durationSec: number;
  prompt: string;
  negativePrompt?: string;
  aspectRatio?: "9:16" | "16:9";
  loras?: Array<{ path: string; weight: number }>;
  referenceImage?: string;
  firstFrameCondition?: string; // used for autoregressive I2V extension
  characterReferenceImage?: string; // Reference portrait for character face & visual anchoring
  characterId?: string; // Associated Story Bible character ID
  characterTurnaround?: CharacterTurnaroundSpec; // 4-angle turnaround pack for visual continuity
  secondaryCharacterReferenceImage?: string; // Secondary character reference for multi-character 2-shot scenes
  secondaryCharacterId?: string; // Secondary Story Bible character ID
  secondaryCharacterTurnaround?: CharacterTurnaroundSpec;
  faceEmbedding?: number[]; // 512-D ArcFace / FaceNet embedding vector
  ipAdapterWeight?: number; // IP-Adapter conditioning weight (default ~0.8)
  applyFaceConsistency?: boolean; // Explicit flag to activate IP-Adapter/FaceID nodes
  regionalConditioning?: {
    enabled: boolean;
    characterAPrompt?: string;
    characterBPrompt?: string;
    characterASide?: "left" | "right";
    characterBSide?: "left" | "right";
  };
  seed?: number;
  metadata?: Record<string, unknown>;
  destinationLocalPath?: string;
  allowDirectExecution?: boolean;
  enableHedge?: boolean;
  hedgeDelayMs?: number;
  hedgeFallbackProvider?: BackendProvider;
  shotType?: string;
}

export interface VideoJobStatus {
  jobId: string;
  status: "queued" | "running" | "completed" | "failed";
  videoUrl?: string;
  localPath?: string;
  durationSec?: number;
  progress?: number;
  error?: string;
  costUsd?: number;
  invoicedCostUsd?: number;
  isConfirmedInvoice?: boolean;
}

export interface VideoProviderAdapter {
  providerName: BackendProvider;
  capabilities?: ProviderCapabilities;
  submitJob(spec: ShotExecutionSpec): Promise<{ jobId: string }>;
  pollStatus(jobId: string): Promise<VideoJobStatus>;
  cancelJob?(jobId: string): Promise<void>;
  restoreJob?(jobId:string,spec:ShotExecutionSpec):void;
}
