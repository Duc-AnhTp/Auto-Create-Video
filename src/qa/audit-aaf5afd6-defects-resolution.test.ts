import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { BibleManager } from "../bible/bible-manager.js";
import { SourceIngestionEngine } from "../novel/source-ingestion.js";
import { validateSafePublicUrl } from "../utils/url-security.js";
import { computeSceneContentHash } from "../assembly/hierarchical-assembler.js";
import { HttpVisualQaBackend } from "./face-evaluator.js";
import { downloadVideoSafely } from "../media/media-validator.js";

describe("Audit aaf5afd6 Comprehensive 15-Defect Resolution Suite", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "audit-aaf-"));
  });

  afterEach(() => {
    try {
      if (existsSync(tempDir)) {
        rmSync(tempDir, { recursive: true, force: true });
      }
    } catch {}
  });

  describe("SEC-01 & URL Security", () => {
    it("rejects private IPv4 addresses (127.0.0.1, 10.x, 192.168.x, 169.254.x)", () => {
      expect(validateSafePublicUrl("http://127.0.0.1:8080/video.mp4").safe).toBe(false);
      expect(validateSafePublicUrl("http://10.0.0.1/test.mp4").safe).toBe(false);
      expect(validateSafePublicUrl("http://192.168.1.1/video.mp4").safe).toBe(false);
      expect(validateSafePublicUrl("http://172.16.0.1/video.mp4").safe).toBe(false);
      expect(validateSafePublicUrl("http://169.254.169.254/latest/meta-data/").safe).toBe(false);
    });

    it("rejects localhost and cloud metadata internal hostnames", () => {
      expect(validateSafePublicUrl("http://localhost/video.mp4").safe).toBe(false);
      expect(validateSafePublicUrl("http://sub.localhost:3000/").safe).toBe(false);
      expect(validateSafePublicUrl("http://metadata.google.internal/computeMetadata").safe).toBe(false);
      expect(validateSafePublicUrl("http://service.internal/").safe).toBe(false);
    });

    it("rejects unsupported protocols (ftp, gopher, file)", () => {
      expect(validateSafePublicUrl("file:///etc/passwd").safe).toBe(false);
      expect(validateSafePublicUrl("ftp://example.com/video.mp4").safe).toBe(false);
      expect(validateSafePublicUrl("gopher://example.com/").safe).toBe(false);
    });

    it("accepts valid public HTTP/HTTPS URLs", () => {
      expect(validateSafePublicUrl("https://cdn.example.com/videos/scene01.mp4").safe).toBe(true);
      expect(validateSafePublicUrl("http://images.unsplash.com/photo-1234").safe).toBe(true);
    });
  });

  describe("FIX-03: Scene Content Hashing with Media Byte Checksums", () => {
    it("computes different hash when clip video file content changes at the same path", () => {
      const clipFile = join(tempDir, "clip.mp4");
      writeFileSync(clipFile, "initial_video_bytes_v1");

      const sceneInput1 = {
        sceneNumber: 1,
        sceneId: "sc01",
        shots: [
          {
            shotId: "sh01",
            sourceClipPath: clipFile,
            trimStartSec: 0,
            trimEndSec: 5,
          },
        ],
      };

      const hash1 = computeSceneContentHash(sceneInput1);

      // Overwrite file content at exact same path
      writeFileSync(clipFile, "regenerated_video_bytes_v2_different");

      const hash2 = computeSceneContentHash(sceneInput1);

      expect(hash1).not.toBe(hash2);
    });
  });

  describe("DATA-01 & Finding 10: Immutable Source Revisions Tracking", () => {
    it("records immutable source revision snapshots on ingestion and revisions", () => {
      const bible = new BibleManager(":memory:");
      const rawTextV1 = "Chương 1: Khởi đầu mới tại Cyber Sài Gòn 2088.";

      const res1 = SourceIngestionEngine.ingestSourceText(
        rawTextV1,
        {
          seriesId: "series_cyber",
          title: "Cyber Sài Gòn",
          sourceType: "novel",
        },
        bible
      );

      expect(res1.isNewRevision).toBe(true);
      expect(res1.work.current_revision).toBe(1);

      // Verify revision 1 is stored in source_revisions
      const rev1 = bible.getSourceRevision(res1.work.id, 1);
      expect(rev1).not.toBeNull();
      expect(rev1?.revision).toBe(1);
      expect(rev1?.raw_text).toBe(rawTextV1);

      // Ingest updated revision
      const rawTextV2 = "Chương 1: Khởi đầu mới tại Cyber Sài Gòn 2088. Đêm mưa bão mù mịt.";
      const res2 = SourceIngestionEngine.ingestSourceText(
        rawTextV2,
        {
          seriesId: "series_cyber",
          sourceId: res1.work.id,
          title: "Cyber Sài Gòn",
          sourceType: "novel",
        },
        bible
      );

      expect(res2.isNewRevision).toBe(true);
      expect(res2.work.current_revision).toBe(2);

      const allRevs = bible.listSourceRevisions(res1.work.id);
      expect(allRevs.length).toBe(2);
      expect(allRevs[0].revision).toBe(1);
      expect(allRevs[0].raw_text).toBe(rawTextV1);
      expect(allRevs[1].revision).toBe(2);
      expect(allRevs[1].raw_text).toBe(rawTextV2);
    });

    it("is idempotent when ingesting identical source content", () => {
      const bible = new BibleManager(":memory:");
      const rawText = "Toàn bộ tiểu thuyết không đổi.";

      const res1 = SourceIngestionEngine.ingestSourceText(
        rawText,
        { seriesId: "s1", title: "Novel A" },
        bible
      );
      const res2 = SourceIngestionEngine.ingestSourceText(
        rawText,
        { seriesId: "s1", sourceId: res1.work.id, title: "Novel A" },
        bible
      );

      expect(res2.isNewRevision).toBe(false);
      expect(res2.work.current_revision).toBe(1);
      const revs = bible.listSourceRevisions(res1.work.id);
      expect(revs.length).toBe(1);
    });
  });

  describe("QA-01 & Finding 12: HttpVisualQaBackend Adapter", () => {
    it("reports UNAVAILABLE gracefully when endpoint is unreachable without faking PASS", async () => {
      const backend = new HttpVisualQaBackend({
        endpoint: "http://127.0.0.1:59999/api/nonexistent",
        timeoutMs: 1000,
      });

      const readiness = await backend.checkReadiness();
      expect(readiness.availability).toBe("UNAVAILABLE");
      expect(readiness.isAvailable).toBe(false);

      const lipSync = await backend.checkLipSyncSupport();
      expect(lipSync.isAvailable).toBe(false);

      const frames = await backend.extractFramesAndEmbeddings(join(tempDir, "fake.mp4"));
      expect(frames.error).toBeDefined();
    });
  });

  describe("FIX-05 & Finding 15: downloadVideoSafely Security & Atomic Swap", () => {
    it("rejects local source paths outside allowed workspace roots", async () => {
      const forbiddenSource = "C:\\Windows\\System32\\drivers\\etc\\hosts";
      const dest = join(tempDir, "dest.mp4");

      if (existsSync(forbiddenSource)) {
        await expect(
          downloadVideoSafely(forbiddenSource, dest, { validateWithProbe: false })
        ).rejects.toThrow(/outside allowed workspace/);
      }
    });

    it("rejects SSRF video URLs targeting private IPs", async () => {
      const dest = join(tempDir, "dest.mp4");
      await expect(
        downloadVideoSafely("http://127.0.0.1:8080/secret.mp4", dest, { validateWithProbe: false })
      ).rejects.toThrow(/SSRF/);
    });
  });
});
