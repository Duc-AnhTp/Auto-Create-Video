/**
 * Common TTS client interface.
 *
 * All providers (LucyLab, ElevenLabs, CosyVoice, F5-TTS) implement this
 * so the pipeline can swap providers without changing orchestration logic.
 */
export interface TtsGenerateOptions {
  actingInstruction?: string;
  speed?: number;
  voiceProfileId?: string;
  characterId?: string;
}

export interface TtsClient {
  /**
   * Generate speech audio for `text` and write to `audioOutPath` (mp3 or wav).
   * If `srtOutPath` is provided AND the provider supports subtitles,
   * write the SRT to that path. Otherwise silently skip.
   */
  generate(
    text: string,
    audioOutPath: string,
    srtOutPath?: string,
    options?: TtsGenerateOptions
  ): Promise<void>;
}

import type { Config } from "../config.js";
import { LucylabClient } from "./lucylab-client.js";
import { ElevenLabsClient } from "./elevenlabs-client.js";
import { CosyVoiceClient } from "./cosyvoice-client.js";
import { F5TtsClient } from "./f5tts-client.js";

export function createTtsClient(cfg: Config, options?: { speed?: number }): TtsClient {
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
        speed: options?.speed,
        mockFallback: cfg.ttsMockFallback === true,
      });
    default: {
      const _never: never = cfg.ttsProvider;
      throw new Error(`Unknown TTS provider: ${_never}`);
    }
  }
}
