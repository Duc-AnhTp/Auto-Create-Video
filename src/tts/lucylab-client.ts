import axios, { AxiosError } from "axios";
import { writeFile } from "node:fs/promises";
import type { TtsClient, TtsGenerateOptions } from "./tts-client.js";

export interface LucylabOpts {
  apiKey: string;
  voiceId: string;
  endpoint: string;
  pollIntervalMs: number;
  pollTimeoutMs: number;
  speed?: number;
}

interface JsonRpcOk<T> { jsonrpc: "2.0"; id: string; result: T; }
interface JsonRpcErr { jsonrpc: "2.0"; id: string; error: { code: string; message: string }; }
type JsonRpcResp<T> = JsonRpcOk<T> | JsonRpcErr;

interface TtsLongTextResult {
  projectExportId: string;
  characterCount: number;
  blockCount: number;
}

interface ExportStatus {
  jobId: string;
  state: "pending" | "completed" | "failed" | string;
  url?: string;
  srtUrl?: string;
  error?: string;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class LucylabClient implements TtsClient {
  constructor(private cfg: LucylabOpts) {}

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
    srtOutPath?: string,
    _options?: TtsGenerateOptions
  ): Promise<void> {
    const cleanText = LucylabClient.cleanDialogueText(text);
    const projectExportId = await this.submitWithRetry(cleanText);
    const { url, srtUrl } = await this.pollUntilDone(projectExportId);
    await this.download(url, audioOutPath);
    if (srtOutPath && srtUrl) {
      await this.download(srtUrl, srtOutPath);
    }
  }

  private async rpc<T>(method: string, input: unknown, idHint: string): Promise<T> {
    const resp = await axios.post<JsonRpcResp<T>>(
      this.cfg.endpoint,
      { jsonrpc: "2.0", method, input, id: idHint },
      {
        headers: {
          Authorization: `Bearer ${this.cfg.apiKey}`,
          "Content-Type": "application/json",
        },
        timeout: 30000,
      },
    );
    const body = resp.data;
    if ("error" in body) {
      throw new Error(`LucyLab ${method} error: ${body.error.message}`);
    }
    return body.result;
  }

  private async submitWithRetry(text: string): Promise<string> {
    const delays = [1000, 2000, 4000];
    let lastErr: unknown;
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        const result = await this.rpc<TtsLongTextResult>(
          "ttsLongText",
          { text, userVoiceId: this.cfg.voiceId, speed: this.cfg.speed ?? 1 },
          `submit-${Date.now()}`,
        );
        return result.projectExportId;
      } catch (e) {
        lastErr = e;
        const status = (e as AxiosError).response?.status;
        const retryable = status === undefined || status >= 500;
        if (!retryable || attempt === delays.length) throw e;
        await sleep(delays[attempt]);
      }
    }
    throw lastErr;
  }

  private async pollUntilDone(projectExportId: string): Promise<{ url: string; srtUrl?: string }> {
    const start = Date.now();
    while (Date.now() - start < this.cfg.pollTimeoutMs) {
      const status = await this.rpc<ExportStatus>(
        "getExportStatus",
        { projectExportId },
        `poll-${Date.now()}`,
      );
      if (status.state === "completed") {
        if (!status.url) throw new Error(`LucyLab returned state=completed without url for ${projectExportId}`);
        return { url: status.url, srtUrl: status.srtUrl };
      }
      if (status.state === "failed") {
        throw new Error(`LucyLab export ${projectExportId} failed: ${status.error ?? "unknown"}`);
      }
      await sleep(this.cfg.pollIntervalMs);
    }
    throw new Error(`LucyLab export ${projectExportId} polling timeout after ${this.cfg.pollTimeoutMs}ms`);
  }

  private async download(url: string, outPath: string): Promise<void> {
    const resp = await axios.get<ArrayBuffer>(url, { responseType: "arraybuffer", timeout: 60000 });
    await writeFile(outPath, Buffer.from(resp.data));
  }
}
