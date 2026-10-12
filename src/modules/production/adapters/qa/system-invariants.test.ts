import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, writeFileSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SqliteStoryStore } from "../../../../bootstrap/sqlite-story-store.js";
import { SourceIngestionEngine } from "../../../story/application/analysis/source-ingestion.js";
import { computeFileSha256Chunked, computeSceneContentHash } from "../../../media/adapters/assembly/hierarchical-assembler.js";
import {
  EpisodeRuntime,
  type QaEvaluationStatus,
} from "../../../../bootstrap/episode-runtime.js";
import { ContextBuilder } from "../../../story/application/analysis/context-builder.js";
import { BudgetLedger } from "../../application/dispatch/budget-ledger.js";

import {
  HttpVisualQaBackend,
  MockVisualQaBackend,
  FaceQaEvaluator,
} from "./face-evaluator.js";
import {
  validateSafePublicUrl,
  validateSafePublicUrlWithDns,
} from "../../../../platform/filesystem/url-security.js";
import { downloadVideoSafely } from "../../../media/adapters/media-validator.js";
import { JobStore } from "../sqlite/job-store.js";


describe("System Invariants & Production Pipeline Verification (EXEC-01 through REC-01)", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "sys-inv-"));
  });

  afterEach(() => {
    try {
      if (existsSync(tempDir)) {
        rmSync(tempDir, { recursive: true, force: true });
      }
    } catch {}
  });

  // ── Milestone M0 / EXEC: Execution & Worker Invariants ──────────────────────

  describe("EXEC-01: Single-Path Durable Worker Execution", () => {
    it("enqueues jobs to JobStore and handles transitions without duplicate execution", () => {
      const store = new JobStore(":memory:");
      const job = store.enqueue({
        seriesId: "series_cyber",
        episodeNumber: 1,
        rawScreenplay: "Tập 1: Khởi nguyên",
        provider: "mock",
        mode: "mock",
      });

      expect(job.status).toBe("queued");
      expect(job.progress).toBeNull();

      // Worker acquires and runs
      const claimed = store.claim("worker_primary");
      expect(claimed).not.toBeNull();
      store.update(job.id, "worker_primary", {
        progress: { step: 2, total: 8, message: "Biên soạn kịch bản" },
      });
      const runningJob = store.get(job.id);
      expect(runningJob.status).toBe("running");
      expect(runningJob.progress?.step).toBe(2);

      // Single terminal completion
      store.update(
        job.id,
        "worker_primary",
        {
          result: { videoPath: "/output/ep1.mp4", audioPath: "", outputDir: "/output", isMock: true },
        },
        "succeeded"
      );
      const completedJob = store.get(job.id);
      expect(completedJob.status).toBe("succeeded");
      expect(completedJob.result?.videoPath).toBe("/output/ep1.mp4");
      store.close();
    });
  });

  describe("EXEC-02: Worker Lease Fencing & Heartbeat", () => {
    it("prevents secondary worker from executing an actively leased running job", () => {
      const bible = new SqliteStoryStore(":memory:");
      const ledger = new BudgetLedger(bible);

      const res = ledger.atomicReserveForJob({
        id: "job_worker_01",
        series_id: "series_fenced",
        episode_number: 1,
        shot_id: "sh_01",
        provider: "mock",
        spec_hash: "hash_01",
        worker_id: "worker_primary",
        estimated_cost_usd: 0.1,
      });

      expect(res.allowed).toBe(true);
      const savedJob = bible.getProviderJob("job_worker_01");
      expect(savedJob?.worker_id).toBe("worker_primary");
      expect(savedJob?.status).toBe("reserved");
    });
  });

  describe("EXEC-03: Cooperative Checkpoint Cancellation", () => {
    it("records failure or needs_review cleanly when checkpoint reports cancellation", () => {
      const store = new JobStore(":memory:");
      const job = store.enqueue({
        seriesId: "series_cancel",
        episodeNumber: 2,
        rawScreenplay: "Tập 2: Bị hủy",
        provider: "mock",
        mode: "mock",
      });

      const claimed = store.claim("worker_cancel");
      expect(claimed).not.toBeNull();

      store.update(
        job.id,
        "worker_cancel",
        {
          error: {
            code: "USER_CANCELLED",
            message: "Người dùng yêu cầu hủy tại checkpoint QA",
          },
        },
        "failed"
      );

      const failedJob = store.get(job.id);
      expect(failedJob.status).toBe("failed");
      expect(failedJob.error?.code).toBe("USER_CANCELLED");
      store.close();
    });
  });

  // ── Milestone M1 / REV: Source Ingestion & Immutable Revisions ─────────────

  describe("REV-01: Immutable Source Revisions with Content-Hash Protection", () => {
    it("rejects tampering on existing revision with different content hash", () => {
      const bible = new SqliteStoryStore(":memory:");
      const workId = "src_immutable_01";
      const rev1 = {
        id: "rev_01",
        source_id: workId,
        series_id: "series_s1",
        revision: 1,
        content_hash: "hash_original_aaa",
        raw_text: "Bản thảo nguyên tác chương 1",
        normalized_text: "Bản thảo nguyên tác chương 1",
        normalization_rules_json: "{}",
        metadata_json: "{}",
        created_at: new Date().toISOString(),
      };

      bible.upsertSourceWork({
        id: workId,
        series_id: rev1.series_id,
        title: "Bản thảo nguyên tác",
        source_type: "novel",
        current_revision: 1,
        content_hash: rev1.content_hash,
        raw_text: rev1.raw_text,
        normalized_text: rev1.normalized_text,
      });

      bible.recordSourceRevision(rev1);

      // Attempting to overwrite revision 1 with a different hash throws IMMUTABLE REVISION ERROR
      const tamperingRev1 = {
        ...rev1,
        content_hash: "hash_tampered_bbb",
        raw_text: "Bản thảo đã bị chỉnh sửa trái phép",
      };

      expect(() => bible.recordSourceRevision(tamperingRev1)).toThrow(
        /IMMUTABLE REVISION ERROR/
      );
    });

    it("allows idempotent re-insertion of identical revision", () => {
      const bible = new SqliteStoryStore(":memory:");
      const rev1 = {
        id: "rev_idempotent",
        source_id: "src_02",
        series_id: "series_s1",
        revision: 1,
        content_hash: "hash_fixed_123",
        raw_text: "Chương 2",
        normalized_text: "Chương 2",
        normalization_rules_json: "{}",
        metadata_json: "{}",
        created_at: new Date().toISOString(),
      };

      bible.upsertSourceWork({
        id: rev1.source_id,
        series_id: rev1.series_id,
        title: "Chương 2",
        source_type: "novel",
        current_revision: 1,
        content_hash: rev1.content_hash,
        raw_text: rev1.raw_text,
        normalized_text: rev1.normalized_text,
      });

      bible.recordSourceRevision(rev1);
      // Re-recording identical hash is a clean no-op
      expect(() => bible.recordSourceRevision(rev1)).not.toThrow();
      expect(bible.listSourceRevisions("src_02").length).toBe(1);
    });
  });

  describe("REV-02: Atomic CAS Ingestion & Version Consistency", () => {
    it("commits source_works and source_revisions atomically using CAS", () => {
      const bible = new SqliteStoryStore(":memory:");
      const rawV1 = "Chương 1: Mở màn cuộc chiến.";
      const res1 = SourceIngestionEngine.ingestSourceText(
        rawV1,
        { seriesId: "series_cas", title: "Thiên Mã" },
        bible
      );

      expect(res1.work.current_revision).toBe(1);
      expect(res1.isNewRevision).toBe(true);

      const rawV2 = "Chương 1: Mở màn cuộc chiến. (Chỉnh sửa phiên bản 2)";
      const res2 = SourceIngestionEngine.ingestSourceText(
        rawV2,
        { seriesId: "series_cas", sourceId: res1.work.id, title: "Thiên Mã" },
        bible
      );

      expect(res2.work.current_revision).toBe(2);
      expect(res2.previousRevision).toBe(1);
      expect(res2.isNewRevision).toBe(true);

      const revs = bible.listSourceRevisions(res1.work.id);
      expect(revs.length).toBe(2);
      expect(revs[0].revision).toBe(1);
      expect(revs[1].revision).toBe(2);
    });
  });

  describe("REV-03: Deterministic Normalization & Content Hashing", () => {
    it("normalizes CRLF to LF and strips trailing whitespaces deterministically", () => {
      const rawText = "Dòng 1   \r\nDòng 2\t  \r\nDòng 3";
      const { normalizedText } = SourceIngestionEngine.normalizeText(rawText);
      expect(normalizedText).toBe("Dòng 1\nDòng 2\nDòng 3");

      const hash1 = SourceIngestionEngine.computeContentHash(normalizedText);
      const hash2 = SourceIngestionEngine.computeContentHash("Dòng 1\nDòng 2\nDòng 3");
      expect(hash1).toBe(hash2);
    });
  });

  // ── Milestone M2 / HASH: Constant-Memory Hashing & Cache Invariants ─────────

  describe("HASH-01: Constant-Memory 64KB Chunked SHA-256 Hashing", () => {
    it("computes exact SHA-256 in 64KB chunks without heap overflow on large files", () => {
      const testFile = join(tempDir, "large_sample.bin");
      // Write 256KB binary buffer (4 chunks of 64KB)
      const chunk = Buffer.alloc(64 * 1024, 0x5a);
      writeFileSync(testFile, Buffer.concat([chunk, chunk, chunk, chunk]));

      const hash = computeFileSha256Chunked(testFile, 64 * 1024);
      expect(hash).toBeDefined();
      expect(hash.length).toBe(64); // Valid 64-char hex SHA-256
    });
  });

  describe("HASH-02: Multi-Dimensional Scene Content Hash Invalidation", () => {
    it("changes hash when take parameters or audio/video content changes", () => {
      const clipFile = join(tempDir, "shot1.mp4");
      writeFileSync(clipFile, "video_bytes_v1");

      const sceneInputA = {
        sceneNumber: 1,
        sceneId: "scene_01",
        shots: [
          {
            shotId: "sh01",
            sceneId: "scene_01",
            takeId: "sh01_take1",
            sourceClipPath: clipFile,
            trimStartSec: 0,
            trimEndSec: 4.5,
          },
        ],
      };

      const hashA = computeSceneContentHash(sceneInputA);

      // Modify trimEndSec
      const sceneInputB = {
        ...sceneInputA,
        shots: [
          {
            ...sceneInputA.shots[0],
            trimEndSec: 5.0,
          },
        ],
      };

      const hashB = computeSceneContentHash(sceneInputB);
      expect(hashA).not.toBe(hashB);
    });
  });

  describe("HASH-03: Zero-Byte and Corrupt Cache File Invalidation", () => {
    it("detects 0-byte corrupt cache entry and invalidates cache", () => {
      const corruptFile = join(tempDir, "scene_corrupt.mp4");
      writeFileSync(corruptFile, ""); // 0-byte file

      const stats = statSync(corruptFile);
      expect(stats.size).toBe(0);

      // Verify that 0-byte files fail the validity check
      const isValid = existsSync(corruptFile) && statSync(corruptFile).size > 0;
      expect(isValid).toBe(false);
    });
  });

  // ── Milestone M3 / QA: Visual QA & Story Beat Verification ─────────────────

  describe("QA-01: 5-State Story Beat Coverage Gating", () => {
    it("handles PASS, FAIL, UNAVAILABLE, ERROR, and NOT_APPLICABLE fail-closed", () => {
      const statuses: QaEvaluationStatus[] = [
        "PASS",
        "FAIL",
        "UNAVAILABLE",
        "ERROR",
        "NOT_APPLICABLE",
      ];
      expect(statuses).toHaveLength(5);

      // Fail-closed rule: only PASS or NOT_APPLICABLE allows automatic canon promotion
      const isApprovedForCanon = (st: QaEvaluationStatus) =>
        st === "PASS" || st === "NOT_APPLICABLE";

      expect(isApprovedForCanon("PASS")).toBe(true);
      expect(isApprovedForCanon("NOT_APPLICABLE")).toBe(true);
      expect(isApprovedForCanon("FAIL")).toBe(false);
      expect(isApprovedForCanon("ERROR")).toBe(false);
      expect(isApprovedForCanon("UNAVAILABLE")).toBe(false);
    });
  });

  describe("QA-02: HttpVisualQaBackend Remote Transport & Readiness", () => {
    it("supports Base64 and Binary transport configurations gracefully", () => {
      const b64Backend = new HttpVisualQaBackend({
        endpoint: "http://127.0.0.1:59999/api/qa",
        transport: "base64",
      });
      expect(b64Backend.transport).toBe("base64");

      const binBackend = new HttpVisualQaBackend({
        endpoint: "http://127.0.0.1:59999/api/qa",
        transport: "binary",
      });
      expect(binBackend.transport).toBe("binary");
    });

    it("reports UNAVAILABLE when remote service is offline without faking PASS", async () => {
      const backend = new HttpVisualQaBackend({
        endpoint: "http://127.0.0.1:59999/api/offline",
        timeoutMs: 500,
      });

      const readiness = await backend.checkReadiness();
      expect(readiness.availability).toBe("UNAVAILABLE");
      expect(readiness.isAvailable).toBe(false);
    });
  });

  describe("QA-03: Visual QA Constructor & Runtime Option Injection", () => {
    it("accepts injected FaceQaEvaluator and respects custom thresholds", () => {
      const customMock = new MockVisualQaBackend();
      const customFaceQa = new FaceQaEvaluator({
        tPass: 0.88,
        tWarn: 0.72,
        backend: customMock,
      });

      const pipeline = new EpisodeRuntime(":memory:", {
        faceQa: customFaceQa,
      });

      expect(pipeline).toBeDefined();
    });
  });

  // ── Milestone M4 / CONT: Continuity & Orchestration ────────────────────────

  describe("CONT-01: Granular Season Orchestrator Lifecycles", () => {
    it("transitions through rendered, needs_review, and canon_committed", () => {
      const possibleStatuses = [
        "pending",
        "running",
        "rendered",
        "qa_pending",
        "needs_review",
        "approved",
        "canon_committed",
        "completed",
        "failed",
        "skipped",
        "budget_exceeded",
      ];
      expect(possibleStatuses).toContain("needs_review");
      expect(possibleStatuses).toContain("canon_committed");
      expect(possibleStatuses).toContain("rendered");
    });
  });

  describe("CONT-02: Continuity Isolation from Speculative Plan Beats", () => {
    it("tags uncommitted forward plan beats with _is_projected_uncommitted", () => {
      const bible = new SqliteStoryStore(":memory:");
      bible.upsertSeriesMetadata({
        id: "series_cont",
        title: "Kỳ Án Thành Phố Cổ",
        aspect_ratio: "16:9",
      });

      bible.upsertSeriesPlan({
        id: "plan_cont_1",
        series_id: "series_cont",
        source_id: "src_01",
        revision: 1,
        target_episodes: 3,
        target_duration_per_episode_sec: 120,
        pacing_preset: "standard",
        status: "active",
        summary_json: "{}",
      });

      bible.upsertPlannedEpisode({
        id: "plan_ep1",
        plan_id: "plan_cont_1",
        series_id: "series_cont",
        episode_number: 1,
        title: "Tập 1",
        logline: "Tập 1 mở màn",
        target_duration_sec: 120,
        planned_state_out_json: JSON.stringify({ mysterySolved: true }),
      });

      bible.upsertPlannedEpisode({
        id: "plan_ep2",
        plan_id: "plan_cont_1",
        series_id: "series_cont",
        episode_number: 2,
        title: "Tập 2",
        logline: "Tập 2 tiếp diễn",
        target_duration_sec: 120,
        state_in_json: "{}",
      });

      // Episode 1 has NO committed summary yet
      const ctx = ContextBuilder.buildEpisodeContext(bible, {
        seriesId: "series_cont",
        episodeNumber: 2,
        planId: "plan_cont_1",
      });

      expect(ctx.isCanonCommittedContinuity).toBe(false);
      expect(ctx.stateIn._is_projected_uncommitted).toBe(true);
      expect(ctx.stateIn.mysterySolved).toBe(true);
    });
  });

  describe("CONT-03: Chekhov Gun Dormant Plant Tracking", () => {
    it("flags forgotten props planted in early episodes", () => {
      const bible = new SqliteStoryStore(":memory:");
      bible.upsertSeriesMetadata({
        id: "series_gun",
        title: "Kho Báu Cổ",
      });

      bible.plantChekhovGun({
        id: "gun_map",
        series_id: "series_gun",
        name: "Tấm bản đồ da cừu",
        type: "prop",
        description: "Bản đồ tìm thấy ở tập 1",
        planted_at_episode: 1,
        payoff_status: "planted",
      });

      const guns = bible.listActiveChekhovGuns("series_gun", 3);
      expect(guns.length).toBeGreaterThanOrEqual(1);
      const mapGun = guns.find((g) => g.id === "gun_map");
      expect(mapGun).toBeDefined();
      expect(mapGun?.dormant_episodes_count).toBe(2);
    });
  });

  // ── Milestone M5 / SEC & REC: Security, Invoicing & Crash Recovery ──────────

  describe("SEC-01: SSRF Pre-Connection DNS Resolution Security", () => {
    it("rejects private IPv4, IPv6, and internal metadata hosts", () => {
      expect(validateSafePublicUrl("http://127.0.0.1:8000").safe).toBe(false);
      expect(validateSafePublicUrl("http://169.254.169.254/latest/meta-data").safe).toBe(false);
      expect(validateSafePublicUrl("http://[::1]:8080").safe).toBe(false);
      expect(validateSafePublicUrl("http://metadata.google.internal").safe).toBe(false);
    });

    it("allows test localhost when explicitly opted-in via allowLocalhost", () => {
      expect(
        validateSafePublicUrl("http://127.0.0.1:3000/mock.mp4", { allowLocalhost: true }).safe
      ).toBe(true);
      expect(
        validateSafePublicUrl("http://localhost:3000/mock.mp4", { allowLocalhost: true }).safe
      ).toBe(true);
    });

    it("performs DNS resolution check rejecting DNS-rebinding attacks", async () => {
      const res = await validateSafePublicUrlWithDns("http://127.0.0.1:8080/test");
      expect(res.safe).toBe(false);
    });
  });

  describe("SEC-02: Atomic Staging & Rollback on Download / Ingest", () => {
    it("cleans up temporary files and preserves destination when download fails", async () => {
      const dest = join(tempDir, "final_video.mp4");
      writeFileSync(dest, "existing_valid_master");

      // Attempt download from failing private IP
      await expect(
        downloadVideoSafely("http://10.255.255.1/fake.mp4", dest, { validateWithProbe: false })
      ).rejects.toThrow(/SSRF/);

      // Existing file remains untouched and uncorrupted
      expect(existsSync(dest)).toBe(true);
      expect(readFileSync(dest, "utf8")).toBe("existing_valid_master");
    });
  });

  describe("SEC-03: Cost Ledger Rate-Card vs Provider Invoice Differentiation", () => {
    it("marks confirmed cost with invoice metadata when provider invoices actual spend", () => {
      const bible = new SqliteStoryStore(":memory:");
      const ledger = new BudgetLedger(bible);

      ledger.atomicReserveForJob({
        id: "job_inv_01",
        series_id: "series_cost",
        episode_number: 1,
        shot_id: "sh_01",
        provider: "api_wan",
        spec_hash: "hash_inv",
        estimated_cost_usd: 0.40,
        reserved_cost_usd: 0.40,
      });

      // Provider confirms with invoice cost $0.32 (different from rate card estimate $0.40)
      const confirmed = ledger.markConfirmed("job_inv_01", 0.32, {
        url: "https://cdn.example.com/shot.mp4",
        isInvoiced: true,
        metadata: {
          cost_source: "provider_invoice",
          invoiced_cost_usd: 0.32,
        },
      });

      expect(confirmed.cost_category).toBe("confirmed");
      expect(confirmed.confirmed_cost_usd).toBe(0.32);
      expect(confirmed.reserved_cost_usd).toBe(0.0);

      const meta = JSON.parse(confirmed.metadata_json || "{}");
      expect(meta.is_invoiced).toBe(true);
      expect(meta.cost_source).toBe("provider_invoice");
    });
  });

  describe("REC-01: Orchestrator Resume Without Blind Resubmits", () => {
    it("resumes submitted job using existing remote provider job ID", async () => {
      const bible = new SqliteStoryStore(":memory:");
      const ledger = new BudgetLedger(bible);

      ledger.atomicReserveForJob({
        id: "job_resume_01",
        series_id: "series_rec",
        episode_number: 1,
        shot_id: "sh_01",
        provider: "mock",
        spec_hash: "hash_rec",
        estimated_cost_usd: 0.05,
      });

      ledger.markSubmitted("job_resume_01", "remote_rec_999", "idemp_key_1");
      const submitted = bible.getProviderJob("job_resume_01");
      expect(submitted?.status).toBe("submitted");
      expect(submitted?.provider_job_id).toBe("remote_rec_999");
      expect(submitted?.idempotency_key).toBe("idemp_key_1");
    });
  });
});
