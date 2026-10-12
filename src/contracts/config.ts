export type TtsProvider = "lucylab" | "elevenlabs" | "cosyvoice" | "f5tts";

export interface TiktokConfig {
  displayName: string;
  handle: string;
  followers: string;
  /** URL to download avatar JPG. If undefined, the bundled `assets/avatar.jpg` is used. */
  avatarUrl?: string;
}

export interface Config {
  ttsProvider: TtsProvider;

  // LucyLab
  lucylabApiKey?: string;
  lucylabVoiceId?: string;
  lucylabEndpoint: string;
  lucylabPollIntervalMs: number;
  lucylabPollTimeoutMs: number;

  // ElevenLabs
  elevenlabsApiKey?: string;
  elevenlabsVoiceId?: string;
  elevenlabsModelId: string;
  elevenlabsEndpoint: string;

  // CosyVoice 2 (Neural Instruct Emotion TTS)
  cosyvoiceEndpoint?: string;
  cosyvoiceApiKey?: string;
  cosyvoiceVoiceId?: string;

  // F5-TTS (Flow Matching Neural TTS)
  f5ttsEndpoint?: string;
  f5ttsApiKey?: string;
  f5ttsRefAudio?: string;
  f5ttsRefText?: string;
  f5ttsVoiceProfiles?: Record<string,{refAudio:string;refText?:string}|string>;

  // TikTok follow card (outro)
  tiktok: TiktokConfig;

  ttsConcurrency: number;
  ttsMockFallback?: boolean;
}

export interface LoadConfigOptions {
  /**
   * Whether to validate provider credentials immediately.
   * - `true` (default): validates credentials for `ttsProvider`.
   * - `false`: skips provider validation (useful for rerender or when script specifies provider).
   * - `TtsProvider`: validates specifically for the given provider.
   */
  validateProvider?: boolean | TtsProvider;
}
