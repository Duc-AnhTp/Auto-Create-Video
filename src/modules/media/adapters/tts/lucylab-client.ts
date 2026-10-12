import axios, { AxiosError } from "axios";
import { downloadTtsAsset } from "./safe-tts-download.js";
import type { TtsClient, TtsGenerateOptions } from "../../../../contracts/tts.js";

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
    options?: TtsGenerateOptions
  ): Promise<import("../../../../contracts/tts.js").TtsGenerationResult> {
    const cleanText = LucylabClient.cleanDialogueText(text);
    const projectExportId = options?.remoteId ?? await this.submitOnce(cleanText, options);
    await options?.onAccepted?.(projectExportId);
    const { url, srtUrl } = await this.pollUntilDone(projectExportId, options?.signal);
    await downloadTtsAsset(url, audioOutPath, false, options?.signal);
    if (srtOutPath && srtUrl) {
      await downloadTtsAsset(srtUrl, srtOutPath, true, options?.signal);
    }
    return {provider: "lucylab", remoteId: projectExportId, audioPath: audioOutPath};
  }

  private async rpc<T>(method: string, input: unknown, idHint: string, signal?: AbortSignal): Promise<T> {
    const resp = await axios.post<JsonRpcResp<T>>(
      this.cfg.endpoint,
      { jsonrpc: "2.0", method, input, id: idHint },
      {
        headers: {
          Authorization: `Bearer ${this.cfg.apiKey}`,
          "Content-Type": "application/json",
        },
        timeout: 30000,
        signal,
      },
    );
    const body = resp.data;
    if ("error" in body) {
      throw new Error(`LucyLab ${method} error: ${body.error.message}`);
    }
    return body.result;
  }

  private async submitOnce(text: string, options?: TtsGenerateOptions): Promise<string> {
    const result = await this.rpc<TtsLongTextResult>('ttsLongText', {
      text, userVoiceId: options?.voiceProfileId ?? this.cfg.voiceId,
      speed: options?.speed ?? this.cfg.speed ?? 1,
    }, 'submit-' + Date.now(), options?.signal);
    if (!result.projectExportId) throw new Error('TTS_REMOTE_ID_MISSING');
    return result.projectExportId;
  }

  private async pollUntilDone(projectExportId: string, signal?: AbortSignal): Promise<{ url: string; srtUrl?: string }> {
    const start = Date.now();
    while (Date.now() - start < this.cfg.pollTimeoutMs) {
      const status = await this.rpc<ExportStatus>(
        "getExportStatus",
        { projectExportId },
        `poll-${Date.now()}`,
        signal,
      );
      if (status.state === "completed") {
        if (!status.url) throw new Error(`LucyLab returned state=completed without url for ${projectExportId}`);
        return { url: status.url, srtUrl: status.srtUrl };
      }
      if (status.state === "failed") {
        throw new Error(`LucyLab export ${projectExportId} failed: ${status.error ?? "unknown"}`);
      }
      await import("node:timers/promises").then(t => t.setTimeout(this.cfg.pollIntervalMs, undefined, {signal}));
    }
    throw new Error(`LucyLab export ${projectExportId} polling timeout after ${this.cfg.pollTimeoutMs}ms`);
  }

}
