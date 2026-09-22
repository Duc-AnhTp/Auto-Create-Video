import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { CosyVoiceClient } from "./cosyvoice-client.js";
import { F5TtsClient } from "./f5tts-client.js";
import { LucylabClient } from "./lucylab-client.js";
import { ElevenLabsClient } from "./elevenlabs-client.js";
import { createTtsClient } from "./tts-client.js";
import type { Config } from "../config.js";

let tmp: string;
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "tts-test-"));
});
afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe("CosyVoiceClient", () => {
  it("extracts inline emotional brackets properly", () => {
    const res1 = CosyVoiceClient.extractInlineEmotion("[thì thầm, lo lắng] Có ai ở đó không?");
    expect(res1.inlineEmotion).toBe("thì thầm, lo lắng");
    expect(res1.cleanText).toBe("Có ai ở đó không?");

    const resParen = CosyVoiceClient.extractInlineEmotion("(nghẹn ngào) Không thể như thế...");
    expect(resParen.inlineEmotion).toBe("nghẹn ngào");
    expect(resParen.cleanText).toBe("Không thể như thế...");

    const res2 = CosyVoiceClient.extractInlineEmotion("Câu thoại bình thường không có cảm xúc");
    expect(res2.inlineEmotion).toBeUndefined();
    expect(res2.cleanText).toBe("Câu thoại bình thường không có cảm xúc");
  });

  it("generates fallback mock audio when offline / mockFallback is active", async () => {
    const client = new CosyVoiceClient({
      endpoint: "http://127.0.0.1:59999", // non-existent offline port
      mockFallback: true,
    });

    const outPath = join(tmp, "cosy_test.mp3");
    await client.generate("Xin chào, tôi là nhân vật chính!", outPath, undefined, {
      actingInstruction: "hào hứng, phấn khởi",
    });

    expect(existsSync(outPath)).toBe(true);
  });
});

describe("F5TtsClient", () => {
  it("cleans dialogue text removing stage instructions and brackets", () => {
    expect(F5TtsClient.cleanDialogueText("[thì thầm, lo lắng] Cẩn thận!")).toBe("Cẩn thận!");
    expect(F5TtsClient.cleanDialogueText("(nghẹn ngào) Không thể như thế...")).toBe("Không thể như thế...");
    expect(F5TtsClient.cleanDialogueText('"Câu thoại trong ngoặc kép"')).toBe("Câu thoại trong ngoặc kép");
  });

  it("generates fallback mock audio when offline", async () => {
    const client = new F5TtsClient({
      endpoint: "http://127.0.0.1:59999",
      mockFallback: true,
    });

    const outPath = join(tmp, "f5_test.mp3");
    await client.generate("Đây là thử nghiệm giọng nói F5-TTS", outPath);
    expect(existsSync(outPath)).toBe(true);
  });
});

describe("createTtsClient factory", () => {
  const baseCfg: Config = {
    ttsProvider: "cosyvoice",
    cosyvoiceEndpoint: "http://localhost:50000",
    f5ttsEndpoint: "http://localhost:50001",
    lucylabEndpoint: "https://api.lucylab.io",
    lucylabPollIntervalMs: 1000,
    lucylabPollTimeoutMs: 10000,
    elevenlabsModelId: "eleven_multilingual_v2",
    elevenlabsEndpoint: "https://api.elevenlabs.io",
    tiktok: { displayName: "Test", handle: "@test", followers: "1k" },
    ttsConcurrency: 1,
  };

  it("creates CosyVoiceClient when ttsProvider is cosyvoice", () => {
    const client = createTtsClient({ ...baseCfg, ttsProvider: "cosyvoice" });
    expect(client).toBeInstanceOf(CosyVoiceClient);
  });

  it("creates F5TtsClient when ttsProvider is f5tts", () => {
    const client = createTtsClient({ ...baseCfg, ttsProvider: "f5tts" });
    expect(client).toBeInstanceOf(F5TtsClient);
  });

  it("cleans acting instructions for Lucylab and Elevenlabs clients", () => {
    expect(LucylabClient.cleanDialogueText("[thì thầm] Cẩn thận!")).toBe("Cẩn thận!");
    expect(LucylabClient.cleanDialogueText("(nghẹn ngào) Không thể như thế...")).toBe("Không thể như thế...");
    expect(ElevenLabsClient.cleanDialogueText("[hét lớn] Dừng lại!")).toBe("Dừng lại!");
    expect(ElevenLabsClient.cleanDialogueText("(run rẩy) Có ai không?")).toBe("Có ai không?");
  });
});
