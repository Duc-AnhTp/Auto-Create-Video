import "dotenv/config";
function parseF5Profiles(raw?:string): Config['f5ttsVoiceProfiles'] {
    if(!raw)return undefined;
    const profiles=JSON.parse(raw);
    if(!profiles||typeof profiles!=='object'||Array.isArray(profiles))throw new Error('F5_VOICE_PROFILES_INVALID');
    for(const [id,profile] of Object.entries(profiles)){
        if(!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(id))throw new Error('F5_VOICE_PROFILE_INVALID');
        if(typeof profile==='string'){if(!profile)throw new Error('F5_REFERENCE_REQUIRED');}
        else if(!profile||typeof profile!=='object'||typeof (profile as any).refAudio!=='string'||!(profile as any).refAudio||((profile as any).refText!==undefined&&typeof (profile as any).refText!=='string'))throw new Error('F5_VOICE_PROFILE_INVALID');
    }
    return profiles;
}
function intDefault(name: string, def: number): number {
    const v = process.env[name];
    if (!v)
        return def;
    const n = parseInt(v, 10);
    if (isNaN(n))
        throw new Error(`Env var ${name} must be integer, got "${v}"`);
    return n;
}
/**
 * Validates that credentials for a specific TTS provider are present in the configuration.
 */
export function validateTtsProvider(cfg: Config, provider: TtsProvider = cfg.ttsProvider, opts?: {
    requireVoiceId?: boolean;
}): void {
    const requireVoiceId = opts?.requireVoiceId ?? true;
    if (provider === "lucylab") {
        if (!cfg.lucylabApiKey || cfg.lucylabApiKey.trim() === "") {
            throw new Error(`Missing VIETNAMESE_API_KEY (required when TTS_PROVIDER=lucylab). ` +
                `Copy .env.example to .env.local and fill in your LucyLab API key.`);
        }
        if (requireVoiceId && (!cfg.lucylabVoiceId || cfg.lucylabVoiceId.trim() === "")) {
            throw new Error(`Missing VIETNAMESE_VOICEID (required when TTS_PROVIDER=lucylab). ` +
                `Copy .env.example to .env.local and fill in your LucyLab voice ID.`);
        }
    }
    else if (provider === "elevenlabs") {
        if (!cfg.elevenlabsApiKey || cfg.elevenlabsApiKey.trim() === "") {
            throw new Error(`Missing ELEVENLABS_API_KEY (required when TTS_PROVIDER=elevenlabs). ` +
                `Copy .env.example to .env.local and fill in your ElevenLabs API key.`);
        }
        if (requireVoiceId && (!cfg.elevenlabsVoiceId || cfg.elevenlabsVoiceId.trim() === "")) {
            throw new Error(`Missing ELEVENLABS_VOICE_ID (required when TTS_PROVIDER=elevenlabs). ` +
                `Copy .env.example to .env.local and fill in your ElevenLabs voice ID.`);
        }
    }
    else if (provider === "cosyvoice") {
        if (!cfg.cosyvoiceEndpoint || cfg.cosyvoiceEndpoint.trim() === "") {
            throw new Error(`Missing COSYVOICE_ENDPOINT (required when TTS_PROVIDER=cosyvoice). ` +
                `Set COSYVOICE_ENDPOINT (e.g. http://localhost:50000) in .env.`);
        }
    }
    else if (provider === "f5tts") {
        if (!cfg.f5ttsEndpoint || cfg.f5ttsEndpoint.trim() === "") {
            throw new Error(`Missing F5TTS_ENDPOINT (required when TTS_PROVIDER=f5tts). ` +
                `Set F5TTS_ENDPOINT (e.g. http://localhost:50001) in .env.`);
        }
    }
}
export function loadConfig(opts?: LoadConfigOptions): Config {
    const validProviders: TtsProvider[] = ["lucylab", "elevenlabs", "cosyvoice", "f5tts"];
    const provider = (process.env.TTS_PROVIDER ?? "lucylab") as TtsProvider;
    if (!validProviders.includes(provider)) {
        throw new Error(`TTS_PROVIDER must be one of ${validProviders.join(", ")}, got "${provider}"`);
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
        cosyvoiceEndpoint: process.env.COSYVOICE_ENDPOINT ?? "http://localhost:50000",
        cosyvoiceApiKey: process.env.COSYVOICE_API_KEY,
        cosyvoiceVoiceId: process.env.COSYVOICE_VOICE_ID,
        f5ttsEndpoint: process.env.F5TTS_ENDPOINT ?? "http://localhost:50001",
        f5ttsApiKey: process.env.F5TTS_API_KEY,
        f5ttsRefAudio: process.env.F5TTS_REF_AUDIO,
        f5ttsRefText: process.env.F5TTS_REF_TEXT,
        f5ttsVoiceProfiles: parseF5Profiles(process.env.F5TTS_VOICE_PROFILES),
        tiktok: {
            displayName: process.env.TIKTOK_DISPLAY_NAME ?? "Công nghệ 24h",
            handle: process.env.TIKTOK_HANDLE ?? "@congnghe24h",
            followers: process.env.TIKTOK_FOLLOWERS ?? "1.2M followers",
            avatarUrl: process.env.TIKTOK_AVATAR_URL || undefined,
        },
        ttsConcurrency: intDefault("TTS_CONCURRENCY", 1),
        ttsMockFallback: process.env.TTS_MOCK_FALLBACK === "true" ||
            process.env.MOCK_TTS === "true" ||
            process.env.MOCK_ALL === "true",
    };
    const validateTarget = opts?.validateProvider ?? true;
    if (validateTarget === true) {
        validateTtsProvider(cfg, provider);
    }
    else if (typeof validateTarget === "string") {
        validateTtsProvider(cfg, validateTarget);
    }
    return cfg;
}
export type { TtsProvider, TiktokConfig, Config, LoadConfigOptions } from "../contracts/config.js";
import type { TtsProvider, TiktokConfig, Config, LoadConfigOptions } from "../contracts/config.js";
