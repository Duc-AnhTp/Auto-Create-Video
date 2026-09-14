import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { SettingsManager } from "./settings-manager.js";
import { existsSync, unlinkSync } from "node:fs";
import { resolve } from "node:path";

describe("SettingsManager Unit Tests", () => {
  const testEnvPath = resolve(process.cwd(), ".env.test.local");
  let manager: SettingsManager;

  beforeEach(() => {
    if (existsSync(testEnvPath)) {
      try {
        unlinkSync(testEnvPath);
      } catch {}
    }
    manager = new SettingsManager(testEnvPath);
  });

  afterEach(() => {
    if (existsSync(testEnvPath)) {
      try {
        unlinkSync(testEnvPath);
      } catch {}
    }
  });

  it("1. Correctly masks secret credentials for UI privacy", () => {
    expect(SettingsManager.maskSecret("")).toBe("");
    expect(SettingsManager.maskSecret("   ")).toBe("");
    expect(SettingsManager.maskSecret("short")).toBe("••••••••");
    expect(SettingsManager.maskSecret("12345678")).toBe("••••••••");
    const masked = SettingsManager.maskSecret("sk-ant-api03-abcdefghijklmnop-1234");
    expect(masked.startsWith("sk-a")).toBe(true);
    expect(masked.endsWith("1234")).toBe(true);
    expect(masked).toContain("••••••••");
  });

  it("2. Enumerates standard model providers across LLM, Video, Voice, and Local GPU", () => {
    const providers = manager.getProviders();
    expect(providers.length).toBeGreaterThanOrEqual(8);

    const categories = new Set(providers.map((p) => p.category));
    expect(categories.has("llm")).toBe(true);
    expect(categories.has("video")).toBe(true);
    expect(categories.has("voice")).toBe(true);
    expect(categories.has("local_gpu")).toBe(true);

    const anthropic = providers.find((p) => p.id === "anthropic");
    expect(anthropic).toBeDefined();
    expect(anthropic?.name).toContain("Anthropic");
    expect(anthropic?.fields.some((f) => f.key === "apiKey")).toBe(true);
  });

  it("3. Saves config updates to file and patches process.env dynamically", () => {
    manager.saveConfigUpdates({
      TEST_API_KEY_FOO: "secret-value-12345678",
      TEST_MODEL_NAME: "test-model-turbo",
    });

    expect(process.env.TEST_API_KEY_FOO).toBe("secret-value-12345678");
    expect(process.env.TEST_MODEL_NAME).toBe("test-model-turbo");

    const reloaded = manager.readEnvConfig();
    expect(reloaded.TEST_API_KEY_FOO).toBe("secret-value-12345678");
    expect(reloaded.TEST_MODEL_NAME).toBe("test-model-turbo");
  });

  it("4. Probing unconfigured provider yields clear failure message", async () => {
    delete process.env.ELEVENLABS_API_KEY;
    const probe = await manager.probeProvider("elevenlabs", { apiKey: "" });
    expect(probe.success).toBe(false);
    expect(probe.message).toContain("Chưa cung cấp ELEVENLABS_API_KEY");
  });

  it("5. Probing with valid format credentials returns success and latency", async () => {
    const probe = await manager.probeProvider("lucylab", {
      apiKey: "lucy-test-key-valid-123456",
    });
    expect(probe.success).toBe(true);
    expect(probe.latencyMs).toBeGreaterThanOrEqual(0);
    expect(probe.message).toContain("thành công");
  });
});
