import axios from "axios";
import { writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import type { TtsClient, TtsGenerateOptions } from "./tts-client.js";
import { createValidMockMp3File } from "../assets/mock-media-generator.js";

export interface CosyVoiceOpts {
  endpoint: string; // e.g. "http://localhost:50000" or cloud serverless URL
  apiKey?: string;
  defaultVoiceId?: string;
  speed?: number;
  mockFallback?: boolean;
}

/**
 * CosyVoice 2 Neural TTS Client with Instruct-driven Emotional Acting.
 *
 * Supports emotional instruction conditioning:
 * - Direct `actingInstruction` (e.g., "thì thầm, lo lắng", "hét lớn, tức giận", "nghẹn ngào")
 * - In-line text emotion bracket detection: "[thì thầm] ..." -> instruct: "thì thầm", clean text: "..."
 * - Zero-shot voice cloning via reference voice ID/audio prompt.
 */
export class CosyVoiceClient implements TtsClient {
  constructor(private cfg: CosyVoiceOpts) {}

  /**
   * Extracts inline emotion annotations from text if present.
   * e.g. "[thì thầm, lo lắng] Cẩn thận phía sau!" -> { cleanText: "Cẩn thận phía sau!", inlineEmotion: "thì thầm, lo lắng" }
   */
  public static extractInlineEmotion(text: string): { cleanText: string; inlineEmotion?: string } {
    const match = text.match(/^\s*(?:\[|\()([^\])]+)(?:\]|\))\s*(.*)$/s);
    if (match) {
      return {
        inlineEmotion: match[1].trim(),
        cleanText: match[2].trim(),
      };
    }
    return { cleanText: text };
  }

  async generate(
    text: string,
    audioOutPath: string,
    _srtOutPath?: string,
    options?: TtsGenerateOptions
  ): Promise<void> {
    const { cleanText, inlineEmotion } = CosyVoiceClient.extractInlineEmotion(text);
    const effectiveEmotion = options?.actingInstruction || inlineEmotion;
    const effectiveSpeed = options?.speed ?? this.cfg.speed ?? 1.0;
    const voiceId = options?.voiceProfileId || this.cfg.defaultVoiceId || "default";

    try {
      const url = `${this.cfg.endpoint.replace(/\/+$/, "")}/inference_instruct`;
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (this.cfg.apiKey) {
        headers["Authorization"] = `Bearer ${this.cfg.apiKey}`;
      }

      const payload = {
        tts_text: cleanText,
        instruct_text: effectiveEmotion ? `Thể hiện cảm xúc: ${effectiveEmotion}` : "Nói chuyện tự nhiên",
        voice_id: voiceId,
        speed: effectiveSpeed,
      };

      const resp = await axios.post<ArrayBuffer>(url, payload, {
        headers,
        responseType: "arraybuffer",
        timeout: 45000,
      });

      await mkdir(dirname(audioOutPath), { recursive: true });
      await writeFile(audioOutPath, Buffer.from(resp.data));
    } catch (err: any) {
      if (this.cfg.mockFallback || process.env.NODE_ENV === "test") {
        // Fallback to valid mock audio for development / test environments without running GPU
        await mkdir(dirname(audioOutPath), { recursive: true });
        const estimatedDur = Math.max(1.0, cleanText.split(/\s+/).length * 0.35);
        await createValidMockMp3File(audioOutPath, estimatedDur);
        return;
      }
      throw new Error(`CosyVoice TTS request failed: ${err?.message || err}`);
    }
  }
}
