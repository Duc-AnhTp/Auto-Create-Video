import axios from "axios";
import { writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname } from "node:path";
import { createValidMockMp3File } from "../assets/mock-media-generator.js";

export interface FoleyOptions {
  durationSec?: number;
  volume?: number;
  sampleRate?: number;
  mockFallback?: boolean;
}

export interface FoleyGenerator {
  /**
   * Generates synchronized Foley SFX from shot video and action description.
   */
  generateFoley(
    videoPath: string,
    actionPrompt: string,
    outPath: string,
    options?: FoleyOptions
  ): Promise<string>;
}

export interface MmaudioConfig {
  endpoint: string; // e.g. "http://localhost:50002" or serverless V2A endpoint
  apiKey?: string;
  mockFallback?: boolean;
}

/**
 * Video-to-Audio (V2A) Foley Generator using MMAudio / FoleyCrafter.
 * Automatically synthesizes sound effects (footsteps, cloth rustle, door impact, ambient interaction)
 * synchronized with visual video frames.
 */
export class MmaudioFoleyClient implements FoleyGenerator {
  constructor(private cfg: MmaudioConfig) {}

  async generateFoley(
    videoPath: string,
    actionPrompt: string,
    outPath: string,
    options?: FoleyOptions
  ): Promise<string> {
    const durationSec = options?.durationSec ?? 3.0;

    try {
      const url = `${this.cfg.endpoint.replace(/\/+$/, "")}/api/v2a/generate`;
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (this.cfg.apiKey) {
        headers["Authorization"] = `Bearer ${this.cfg.apiKey}`;
      }

      const payload = {
        video_path: videoPath,
        action_prompt: actionPrompt,
        duration_sec: durationSec,
        volume: options?.volume ?? 0.8,
      };

      const resp = await axios.post<ArrayBuffer>(url, payload, {
        headers,
        responseType: "arraybuffer",
        timeout: 60000,
      });

      await mkdir(dirname(outPath), { recursive: true });
      await writeFile(outPath, Buffer.from(resp.data));
      return outPath;
    } catch (err: any) {
      if (this.cfg.mockFallback || process.env.NODE_ENV === "test") {
        await mkdir(dirname(outPath), { recursive: true });
        await createValidMockMp3File(outPath, durationSec);
        return outPath;
      }
      throw new Error(`MMAudio Foley generation failed: ${err?.message || err}`);
    }
  }
}
