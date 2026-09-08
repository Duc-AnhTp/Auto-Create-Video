import "dotenv/config";

export type TtsProvider = "lucylab" | "elevenlabs";

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

  // TikTok follow card (outro)
  tiktok: TiktokConfig;

  ttsConcurrency: number;
}

function intDefault(name: string, def: number): number {
  const v = process.env[name];
  if (!v) return def;
  const n = parseInt(v, 10);
  if (isNaN(n)) throw new Error(`Env var ${name} must be integer, got "${v}"`);
  return n;
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

/**
 * Validates that credentials for a specific TTS provider are present in the configuration.
 */
export function validateTtsProvider(
  cfg: Config,
  provider: TtsProvider = cfg.ttsProvider,
  opts?: { requireVoiceId?: boolean }
): void {
  const requireVoiceId = opts?.requireVoiceId ?? true;
  if (provider === "lucylab") {
    if (!cfg.lucylabApiKey || cfg.lucylabApiKey.trim() === "") {
      throw new Error(
        `Missing VIETNAMESE_API_KEY (required when TTS_PROVIDER=lucylab). ` +
        `Copy .env.example to .env.local and fill in your LucyLab API key.`
      );
    }
    if (requireVoiceId && (!cfg.lucylabVoiceId || cfg.lucylabVoiceId.trim() === "")) {
      throw new Error(
        `Missing VIETNAMESE_VOICEID (required when TTS_PROVIDER=lucylab). ` +
        `Copy .env.example to .env.local and fill in your LucyLab voice ID.`
      );
    }
  } else if (provider === "elevenlabs") {
    if (!cfg.elevenlabsApiKey || cfg.elevenlabsApiKey.trim() === "") {
      throw new Error(
        `Missing ELEVENLABS_API_KEY (required when TTS_PROVIDER=elevenlabs). ` +
        `Copy .env.example to .env.local and fill in your ElevenLabs API key.`
      );
    }
    if (requireVoiceId && (!cfg.elevenlabsVoiceId || cfg.elevenlabsVoiceId.trim() === "")) {
      throw new Error(
        `Missing ELEVENLABS_VOICE_ID (required when TTS_PROVIDER=elevenlabs). ` +
        `Copy .env.example to .env.local and fill in your ElevenLabs voice ID.`
      );
    }
  }
}

export function loadConfig(opts?: LoadConfigOptions): Config {
  const provider = (process.env.TTS_PROVIDER ?? "lucylab") as TtsProvider;
  if (provider !== "lucylab" && provider !== "elevenlabs") {
    throw new Error(`TTS_PROVIDER must be "lucylab" or "elevenlabs", got "${provider}"`);
  }

  const cfg: Config = {
    ttsProvider: provider,
    lucylabApiKey: process.env.VIETNAMESE_API_KEY,
    lucylabVoiceId: process.env.VIETNAMESE_VOICEID,
    lucylabEndpoint: process.env.LUCYLAB_ENDPOINT ?? "https://api.lucylab.io/json-rpc",
    lucylabPollIntervalMs: intDefault("LUCYLAB_POLL_INTERVAL_MS", 2000),
    lucylabPollTimeoutMs: intDefault("LUCYLAB_POLL_TIMEOUT_MS", 120000),
    elevenlabsApiKey: process.env.ELEVENLABS_API_KEY,
    elevenlabsVoiceId: process.env.ELEVENLABS_VOICE_ID,
    elevenlabsModelId: process.env.ELEVENLABS_MODEL_ID ?? "eleven_multilingual_v2",
    elevenlabsEndpoint: process.env.ELEVENLABS_ENDPOINT ?? "https://api.elevenlabs.io/v1",
    tiktok: {
      displayName: process.env.TIKTOK_DISPLAY_NAME ?? "Công nghệ 24h",
      handle: process.env.TIKTOK_HANDLE ?? "@congnghe24h",
      followers: process.env.TIKTOK_FOLLOWERS ?? "1.2M followers",
      avatarUrl: process.env.TIKTOK_AVATAR_URL || undefined,
    },
    ttsConcurrency: intDefault("TTS_CONCURRENCY", 1),
  };

  const validateTarget = opts?.validateProvider ?? true;
  if (validateTarget === true) {
    validateTtsProvider(cfg, provider);
  } else if (typeof validateTarget === "string") {
    validateTtsProvider(cfg, validateTarget);
  }

  return cfg;
}
