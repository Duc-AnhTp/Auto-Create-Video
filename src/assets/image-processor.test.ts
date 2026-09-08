import { describe, it, expect, vi } from "vitest";
import { guessExtFromUrl, processImage } from "./image-processor.js";
import { writeFile, unlink } from "node:fs/promises";
import { join } from "node:path";

describe("Image Processor", () => {
  describe("guessExtFromUrl", () => {
    it("identifies common image extensions correctly", () => {
      expect(guessExtFromUrl("https://example.com/photo.jpg")).toBe("jpg");
      expect(guessExtFromUrl("https://example.com/photo.jpeg")).toBe("jpeg");
      expect(guessExtFromUrl("https://example.com/photo.png")).toBe("png");
      expect(guessExtFromUrl("https://example.com/photo.webp")).toBe("webp");
      expect(guessExtFromUrl("https://example.com/photo.avif")).toBe("avif");
      expect(guessExtFromUrl("https://example.com/photo.gif")).toBe("gif");
    });

    it("strips query strings before parsing extension", () => {
      expect(guessExtFromUrl("https://example.com/image.png?width=1000&quality=85")).toBe("png");
      expect(guessExtFromUrl("https://example.com/banner.webp?token=xyz123")).toBe("webp");
    });

    it("falls back to jpg for urls without extensions or invalid urls", () => {
      expect(guessExtFromUrl("https://example.com/no-extension")).toBe("jpg");
      expect(guessExtFromUrl("not-a-url")).toBe("jpg");
    });
  });

  describe("processImage", () => {
    it("throws an error when input file does not exist", async () => {
      await expect(
        processImage("non-existent-input.jpg", "non-existent-output.jpg")
      ).rejects.toThrow("processImage: input file not found");
    });

    it("bypasses processing and returns { optimized: false } when inputPath === outputPath", async () => {
      const tempPath = join(process.cwd(), "test-same-file.tmp");
      await writeFile(tempPath, "dummy content");
      try {
        const res = await processImage(tempPath, tempPath);
        expect(res.optimized).toBe(false);
      } finally {
        await unlink(tempPath).catch(() => {});
      }
    });
  });
});
