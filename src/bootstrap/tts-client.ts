import {DurableTtsClient} from '../modules/media/adapters/tts/durable-tts-client.js';
import {SqliteTtsAttemptStore} from '../modules/production/adapters/sqlite/tts-attempt-store.js';
import {resolve} from 'node:path';
import type { TtsClient } from "../contracts/tts.js";
import type { Config } from "../contracts/config.js";
import { LucylabClient } from "../modules/media/adapters/tts/lucylab-client.js";
import { ElevenLabsClient } from "../modules/media/adapters/tts/elevenlabs-client.js";
import { CosyVoiceClient } from "../modules/media/adapters/tts/cosyvoice-client.js";
import { F5TtsClient } from "../modules/media/adapters/tts/f5tts-client.js";
function createRawTtsClient(cfg: Config, options?: {
    speed?: number;
}): TtsClient {
    switch (cfg.ttsProvider) {
        case "lucylab":
            return new LucylabClient({
                apiKey: cfg.lucylabApiKey!,
                voiceId: cfg.lucylabVoiceId!,
                endpoint: cfg.lucylabEndpoint,
                pollIntervalMs: cfg.lucylabPollIntervalMs,
                pollTimeoutMs: cfg.lucylabPollTimeoutMs,
                speed: options?.speed,
            });
        case "elevenlabs":
            return new ElevenLabsClient({
                apiKey: cfg.elevenlabsApiKey!,
                voiceId: cfg.elevenlabsVoiceId!,
                modelId: cfg.elevenlabsModelId,
                endpoint: cfg.elevenlabsEndpoint,
                speed: options?.speed,
            });
        case "cosyvoice":
            return new CosyVoiceClient({
                endpoint: cfg.cosyvoiceEndpoint || "http://localhost:50000",
                apiKey: cfg.cosyvoiceApiKey,
                defaultVoiceId: cfg.cosyvoiceVoiceId,
                speed: options?.speed,
                mockFallback: cfg.ttsMockFallback === true,
            });
        case "f5tts":
            return new F5TtsClient({
                endpoint: cfg.f5ttsEndpoint || "http://localhost:50001",
                apiKey: cfg.f5ttsApiKey,
                defaultRefAudio: cfg.f5ttsRefAudio,
                defaultRefText: cfg.f5ttsRefText,
                voiceProfiles: cfg.f5ttsVoiceProfiles,
                speed: options?.speed,
                mockFallback: cfg.ttsMockFallback === true,
            });
        default: {
            const _never: never = cfg.ttsProvider;
            throw new Error(`Unknown TTS provider: ${_never}`);
        }
    }
}

export function createTtsClient(cfg:Config,options?:{speed?:number;mockTts?:boolean}):TtsClient {
 const client=createRawTtsClient({...cfg,ttsMockFallback:options?.mockTts===true},options);
 return options?.mockTts?client:new DurableTtsClient(client,cfg.ttsProvider,()=>new SqliteTtsAttemptStore(process.env.STUDIO_JOB_DB??resolve('data/studio-jobs.db')));
}
