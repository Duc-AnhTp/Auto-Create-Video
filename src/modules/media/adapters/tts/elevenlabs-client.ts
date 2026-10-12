import axios from "axios";
import { writeFile } from "node:fs/promises";
import type { TtsClient, TtsGenerateOptions } from "../../../../contracts/tts.js";

export interface ElevenLabsOpts {
  apiKey: string;
  voiceId: string;
  modelId: string;       // e.g. "eleven_multilingual_v2", "eleven_turbo_v2_5"
  endpoint: string;      // e.g. "https://api.elevenlabs.io/v1"
  speed?: number;
}



/**
 * ElevenLabs TTS client.
 *
 * API reference: https://elevenlabs.io/docs/api-reference/text-to-speech
 *
 * Synchronous: POST text → returns mp3 binary directly. No polling needed.
 * Vietnamese support via `eleven_multilingual_v2` model (default).
 *
 * Note: ElevenLabs does NOT return SRT subtitles in TTS endpoint.
 * `srtOutPath` arg is ignored silently.
 */
export class ElevenLabsClient implements TtsClient {
  constructor(private cfg: ElevenLabsOpts) {}

  /**
   * Sanitizes dialogue text by stripping leading/inline acting directions, stage instructions,
   * bracketed expressions [thì thầm] and parenthesized annotations (lo lắng) so they aren't vocalized aloud.
   */
  public static cleanDialogueText(raw: string): string {
    if (!raw) return "";
    let text = raw.trim();
    if ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith("'") && text.endsWith("'"))) {
      text = text.slice(1, -1).trim();
    }
    text = text.replace(/^(?:\[[^\]]+\]|\([^)]+\)\s*)+/s, "").trim();
    if ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith("'") && text.endsWith("'"))) {
      text = text.slice(1, -1).trim();
    }
    return text;
  }

  async generate(
    text: string,
    audioOutPath: string,
    _srtOutPath?: string,
    options?: TtsGenerateOptions
  ): Promise<void> {
    const cleanText = options?.normalizedText ? text : ElevenLabsClient.cleanDialogueText(text);
    await this.synthesizeOnce(cleanText, audioOutPath, options);
    // ElevenLabs has no SRT — silently skip srtOutPath.
  }

  private async synthesizeOnce(text: string, outPath: string, options?: TtsGenerateOptions): Promise<void> {

    const voiceId=options?.voiceProfileId??this.cfg.voiceId;
    const speed=options?.speed??this.cfg.speed;
    // One paid POST. Local persistence errors must never resubmit speech.
        const url = `${this.cfg.endpoint}/text-to-speech/${voiceId}`;
        const resp = await axios.post<ArrayBuffer>(
          url,
          {
            text,
            model_id: this.cfg.modelId,
            voice_settings: {
              stability: 0.5,
              similarity_boost: 0.75,
              style: 0.0,
              use_speaker_boost: true,
              ...(speed !== undefined ? { speed } : {}),
            },
          },
          {
            headers: {
              "xi-api-key": this.cfg.apiKey,
              "Content-Type": "application/json",
              "Accept": "audio/mpeg",
            },
            responseType: "arraybuffer",
            timeout: 60000,
            signal: options?.signal, maxContentLength: 64 * 1024 * 1024,
          },
        );
    await writeFile(outPath,Buffer.from(resp.data));
  }
}
