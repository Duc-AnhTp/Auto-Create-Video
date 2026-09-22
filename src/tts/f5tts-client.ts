import axios from "axios";
import { writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import type { TtsClient, TtsGenerateOptions } from "./tts-client.js";
import { createValidMockMp3File } from "../assets/mock-media-generator.js";

export interface F5TtsOpts {
  endpoint: string; // e.g. "http://localhost:50001" or cloud serverless URL
  apiKey?: string;
  defaultRefAudio?: string;
  defaultRefText?: string;
  voiceProfiles?: Record<string, { refAudio: string; refText?: string } | string>;
  speed?: number;
  mockFallback?: boolean;
}

/**
 * F5-TTS (Flow Matching Neural TTS) Client.
 *
 * Provides non-autoregressive speech generation with reference voice cloning.
 */
export class F5TtsClient implements TtsClient {
  constructor(private cfg: F5TtsOpts) {}

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
    text = text.replace(/^(?:\[[^\]]+\]|\([^)]+\))\s*/s, "").trim();
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
    const cleanText = F5TtsClient.cleanDialogueText(text);
    const effectiveSpeed = options?.speed ?? this.cfg.speed ?? 1.0;

    let refAudio = this.cfg.defaultRefAudio || "";
    let refText = this.cfg.defaultRefText || "";

    if (options?.voiceProfileId) {
      const vp = options.voiceProfileId;
      const mapped = this.cfg.voiceProfiles?.[vp];
      if (typeof mapped === "string") {
        refAudio = mapped;
      } else if (mapped && typeof mapped === "object") {
        refAudio = mapped.refAudio || refAudio;
        if (mapped.refText) refText = mapped.refText;
      } else if (
        vp.includes("/") ||
        vp.includes("\\") ||
        /\.(wav|mp3|ogg|flac|m4a)$/i.test(vp) ||
        vp.startsWith("http://") ||
        vp.startsWith("https://")
      ) {
        refAudio = vp;
      }
    }

    try {
      const url = `${this.cfg.endpoint.replace(/\/+$/, "")}/api/generate`;
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (this.cfg.apiKey) {
        headers["Authorization"] = `Bearer ${this.cfg.apiKey}`;
      }

      const payload = {
        gen_text: cleanText,
        ref_audio: refAudio,
        ref_text: refText,
        speed: effectiveSpeed,
        remove_silence: true,
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
        await mkdir(dirname(audioOutPath), { recursive: true });
        const estimatedDur = Math.max(1.0, cleanText.split(/\s+/).length * 0.35);
        await createValidMockMp3File(audioOutPath, estimatedDur);
        return;
      }
      throw new Error(`F5-TTS request failed: ${err?.message || err}`);
    }
  }
}
