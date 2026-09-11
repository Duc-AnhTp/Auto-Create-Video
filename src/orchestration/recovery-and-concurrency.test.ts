import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { BibleManager } from "../bible/bible-manager.js";
import { BudgetLedger } from "./budget-ledger.js";
import { RateCardManager } from "./rate-card-manager.js";
import {
  ResilientJobOrchestrator,
  UncertainTimeoutError,
} from "./job-orchestrator.js";
import {
  VideoModelGateway,
  type VideoProviderAdapter,
  type ShotExecutionSpec,
  type VideoJobStatus,
  BudgetExceededError,
} from "../gateway/video-gateway.js";
import { buildInvalidationGraph } from "./dependency-graph.js";
import { computeVideoSpecHash } from "./spec-hasher.js";
import { PROVIDER_CAPABILITY_REGISTRY } from "../gateway/provider-capabilities.js";
import { existsSync, unlinkSync } from "node:fs";
import { writeFile, rm, mkdir } from "node:fs/promises";
import { join } from "node:path";

class ControlledMockAdapter implements VideoProviderAdapter {
  public providerName = "mock" as const;
  public capabilities = PROVIDER_CAPABILITY_REGISTRY.mock;

  public submitCallCount = 0;
  public pollCallCount = 0;
  public submittedJobs: Map<string, ShotExecutionSpec> = new Map();
  public simulateTimeoutOnSubmit = false;
  public jobStatuses: Map<string, VideoJobStatus> = new Map();
  public autoComplete = false;
  public mockVideoPath = "";

  public async submitJob(spec: ShotExecutionSpec): Promise<{ jobId: string }> {
    this.submitCallCount++;
    if (this.simulateTimeoutOnSubmit) {
      throw new Error("ETIMEDOUT: Connection to provider timed out after 30000ms");
    }
    const jobId = `remote_task_${spec.shotId}_${this.submitCallCount}`;
    this.submittedJobs.set(jobId, spec);
    if (this.autoComplete) {
      this.jobStatuses.set(jobId, {
        jobId,
        status: "completed",
        localPath: this.mockVideoPath,
      });
    } else {
      this.jobStatuses.set(jobId, {
        jobId,
        status: "running",
        progress: 50,
      });
    }
    return { jobId };
  }

  public async pollStatus(jobId: string): Promise<VideoJobStatus> {
    this.pollCallCount++;
    const current = this.jobStatuses.get(jobId);
    if (!current) {
      if (this.autoComplete) {
        return {
          jobId,
          status: "completed",
          localPath: this.mockVideoPath,
        };
      }
      return { jobId, status: "failed", error: "Not found" };
    }
    return current;
  }
}

describe("Resilience, Recovery, Concurrency & Timeout Reconciliation Acceptance Tests", () => {
  const testDbPath = join("output", "test-orchestration-recovery.db");
  const testOutputDir = join("output", "test-orchestration-recovery");

  beforeEach(async () => {
    BibleManager.closeAll();
    if (existsSync(testDbPath)) {
      try {
        unlinkSync(testDbPath);
      } catch {}
    }
    if (existsSync(testOutputDir)) {
      try {
        await rm(testOutputDir, { recursive: true, force: true });
      } catch {}
    }
    await mkdir(testOutputDir, { recursive: true });
  });

  afterEach(async () => {
    BibleManager.closeAll();
    if (existsSync(testDbPath)) {
      try {
        unlinkSync(testDbPath);
      } catch {}
    }
    if (existsSync(testOutputDir)) {
      try {
        await rm(testOutputDir, { recursive: true, force: true });
      } catch {}
    }
  });

  describe("1. Dừng tiến trình sau khi submit và Khởi động lại: Tiếp tục Polling, Không tạo Job mới", () => {
    it("resumes polling existing provider_job_id on restart and never submits a duplicate job", async () => {
      // 1. Pre-condition in SQLite: Worker 1 submitted the job and recorded provider_job_id before crashing
      const bible1 = new BibleManager(testDbPath);
      bible1.upsertSeriesMetadata({
        id: "series_resilience",
        title: "Test Series",
        aspect_ratio: "9:16",
        fps: 30,
        created_at: new Date().toISOString(),
      });
      bible1.setSeriesBudget("series_resilience", 100.0, 0.0);

      const shotSpec: ShotExecutionSpec = {
        shotId: "sc1_sh1",
        backend: "mock",
        priority: "standard",
        durationSec: 4.0,
        prompt: "Cyberpunk alleyway with neon reflections in puddles",
        aspectRatio: "9:16",
      };

      const specHash = computeVideoSpecHash({
        prompt: shotSpec.prompt,
        provider: "mock",
        durationSec: 4.0,
        aspectRatio: "9:16",
      });

      // Worker 1 atomically reserved and submitted pjob_series_resilience_ep1_sc1_sh1 to provider
      bible1.createOrUpdateProviderJob({
        id: "pjob_series_resilience_ep1_sc1_sh1",
        series_id: "series_resilience",
        episode_number: 1,
        shot_id: "sc1_sh1",
        provider: "mock",
        provider_job_id: "remote_task_sc1_sh1_99",
        spec_hash: specHash,
        status: "submitted",
        attempt_count: 1,
        max_attempts: 3,
        estimated_cost_usd: 0.08,
        reserved_cost_usd: 0.08,
        confirmed_cost_usd: 0,
        uncertain_cost_usd: 0,
        worker_id: "worker_dead",
        is_retryable: true,
      });

      // Provider has the task in progress, and now completes it
      const adapter = new ControlledMockAdapter();
      const validMockVideo = join(testOutputDir, "mock_output.mp4");
      await writeFile(validMockVideo, Buffer.from("RIFF_HEADER_VALID_VIDEO_PAYLOAD"));
      adapter.jobStatuses.set("remote_task_sc1_sh1_99", {
        jobId: "remote_task_sc1_sh1_99",
        status: "completed",
        localPath: validMockVideo,
      });

      // 2. SIMULATE PROCESS RESTART: Fresh new worker instance boots up
      const bible2 = new BibleManager(testDbPath);
      const gateway2 = new VideoModelGateway();
      gateway2.registerAdapter(adapter);

      const orchestrator2 = new ResilientJobOrchestrator(bible2, gateway2, {
        pollIntervalMs: 20,
        pollTimeoutMs: 3000,
      });

      // Call executeShot again on the restarted worker
      const resumedResult = await orchestrator2.executeShot(
        "series_resilience",
        1,
        shotSpec,
        { destinationPath: join(testOutputDir, "final_sc1_sh1.mp4") }
      );

      // CRITICAL ACCEPTANCE CHECK:
      // adapter.submitJob MUST NEVER BE CALLED! (submitCallCount is strictly 0)
      expect(adapter.submitCallCount).toBe(0);
      expect(resumedResult.status).toBe("completed");
      expect(resumedResult.providerJobId).toBe("remote_task_sc1_sh1_99");
      expect(existsSync(resumedResult.videoPath!)).toBe(true);

      // Budget ledger should be confirmed without duplicate reservations
      const finalJob = bible2.getProviderJob("pjob_series_resilience_ep1_sc1_sh1");
      expect(finalJob?.status).toBe("completed");
      expect(finalJob?.confirmed_cost_usd).toBe(0.08);
      expect(finalJob?.reserved_cost_usd).toBe(0);

      // 3. Test resumePendingJobsForSeries (batch scan resume)
      bible2.createOrUpdateProviderJob({
        id: "pjob_series_resilience_ep1_sc1_sh2",
        series_id: "series_resilience",
        episode_number: 1,
        shot_id: "sc1_sh2",
        provider: "mock",
        provider_job_id: "remote_task_sc1_sh2_88",
        spec_hash: "hash_sc1_sh2",
        status: "running",
        attempt_count: 1,
        max_attempts: 3,
        estimated_cost_usd: 0.05,
        reserved_cost_usd: 0.05,
        confirmed_cost_usd: 0,
        uncertain_cost_usd: 0,
        worker_id: "worker_dead",
        is_retryable: true,
      });

      adapter.jobStatuses.set("remote_task_sc1_sh2_88", {
        jobId: "remote_task_sc1_sh2_88",
        status: "completed",
        localPath: validMockVideo,
      });

      const batchResume = await orchestrator2.resumePendingJobsForSeries("series_resilience", 1);
      expect(batchResume.resumedCount).toBe(1);
      expect(batchResume.completedCount).toBe(1);
      expect(adapter.submitCallCount).toBe(0); // Still 0 submit calls!
    });
  });

  describe("2. Xử lý Timeout chưa rõ kết quả (Uncertain Timeout): Ngăn chặn Retry Mù & Đối soát", () => {
    it("marks uncertain_timeout, locks budget into uncertain, prevents blind retries, and requires reconciliation", async () => {
      const bible = new BibleManager(testDbPath);
      bible.upsertSeriesMetadata({
        id: "series_timeout",
        title: "Timeout Series",
        aspect_ratio: "9:16",
        fps: 30,
        created_at: new Date().toISOString(),
      });
      bible.setSeriesBudget("series_timeout", 50.0, 0.0);

      const adapter = new ControlledMockAdapter();
      adapter.simulateTimeoutOnSubmit = true; // Simulate network connection drop during submit

      const gateway = new VideoModelGateway();
      gateway.registerAdapter(adapter);

      const orchestrator = new ResilientJobOrchestrator(bible, gateway, {
        maxAttempts: 3,
        submitTimeoutMs: 500,
      });

      const shotSpec: ShotExecutionSpec = {
        shotId: "sc1_sh2",
        backend: "mock",
        priority: "standard",
        durationSec: 5.0,
        prompt: "Drone view of flying vehicles in rainy dusk",
      };

      // 1. Submit should catch network drop and throw UncertainTimeoutError (NOT blind retry 3 times)
      let caughtError: any;
      try {
        await orchestrator.executeShot("series_timeout", 1, shotSpec);
      } catch (err) {
        caughtError = err;
      }

      expect(caughtError).toBeInstanceOf(UncertainTimeoutError);
      expect(adapter.submitCallCount).toBe(1); // Crucial: did NOT blind retry on uncertain timeout!

      // 2. Verify Job state and 4-State Budget Ledger
      const jobRecord = bible.getProviderJob("pjob_series_timeout_ep1_sc1_sh2");
      expect(jobRecord).toBeDefined();
      expect(jobRecord?.status).toBe("uncertain_timeout");
      expect(jobRecord?.uncertain_cost_usd).toBeGreaterThan(0);
      expect(jobRecord?.reserved_cost_usd).toBe(0);

      const ledger = bible.getSeriesBudgetLedger("series_timeout");
      expect(ledger.uncertainCostUsd).toBeGreaterThan(0);
      expect(ledger.reservedCostUsd).toBe(0);

      // 3. Trying to execute the shot again immediately MUST be rejected to prevent blind double-spend
      let secondTryError: any;
      try {
        await orchestrator.executeShot("series_timeout", 1, shotSpec);
      } catch (err) {
        secondTryError = err;
      }
      expect(secondTryError).toBeInstanceOf(UncertainTimeoutError);
      expect(adapter.submitCallCount).toBe(1); // Still 1!

      // 4. Perform Reconciliation (series:reconcile)
      // Suppose we check provider logs and verify the remote task never landed, so we discard
      const budgetLedger = new BudgetLedger(bible);
      const reconciled = budgetLedger.reconcileUncertainJob(
        "pjob_series_timeout_ep1_sc1_sh2",
        "discard"
      );
      expect(reconciled.status).toBe("failed");
      expect(reconciled.uncertain_cost_usd).toBe(0);

      const reconciledLedger = bible.getSeriesBudgetLedger("series_timeout");
      expect(reconciledLedger.uncertainCostUsd).toBe(0);
      expect(reconciledLedger.totalCommittedUsd).toBe(0);
    });
  });

  describe("3. Đa Worker & Giới hạn Ngân sách An toàn (Atomic Budget Reservation)", () => {
    it("guarantees two concurrent workers cannot overspend remaining budget or acquire the same lease", async () => {
      const bible = new BibleManager(testDbPath);
      bible.upsertSeriesMetadata({
        id: "series_budget_guard",
        title: "Budget Guard Series",
        aspect_ratio: "9:16",
        fps: 30,
        created_at: new Date().toISOString(),
      });

      // Set tiny budget remaining: $0.15. Each 5-second mock shot costs $0.10.
      // So ONLY ONE shot can be reserved; second worker MUST be blocked.
      bible.setSeriesBudget("series_budget_guard", 0.15, 0.0);

      const rateManager = new RateCardManager(bible);
      rateManager.setRate({
        provider: "mock",
        modelName: "default",
        ratePerSecUsd: 0.02, // 5s * 0.02 = $0.10
        effectiveDate: "2026-09-09",
        sourceDocUrl: "https://internal.test/rates",
      });

      const adapter = new ControlledMockAdapter();
      adapter.autoComplete = true;
      adapter.mockVideoPath = join(testOutputDir, "mock_concurrency.mp4");
      await writeFile(adapter.mockVideoPath, Buffer.from("RIFF_CONCURRENCY_MOCK"));

      const gateway = new VideoModelGateway();
      gateway.registerAdapter(adapter);

      const worker1 = new ResilientJobOrchestrator(bible, gateway, {
        workerId: "worker_alpha",
        pollIntervalMs: 20,
        pollTimeoutMs: 2000,
      });
      const worker2 = new ResilientJobOrchestrator(bible, gateway, {
        workerId: "worker_beta",
        pollIntervalMs: 20,
        pollTimeoutMs: 2000,
      });

      const specA: ShotExecutionSpec = {
        shotId: "shot_A",
        backend: "mock",
        priority: "standard",
        durationSec: 5.0, // costs $0.10
        prompt: "Shot A scene",
      };

      const specB: ShotExecutionSpec = {
        shotId: "shot_B",
        backend: "mock",
        priority: "standard",
        durationSec: 5.0, // costs $0.10
        prompt: "Shot B scene",
      };

      // Both workers attempt atomic reserve simultaneously
      const results = await Promise.allSettled([
        worker1.executeShot("series_budget_guard", 1, specA),
        worker2.executeShot("series_budget_guard", 1, specB),
      ]);

      const fulfilled = results.filter((r) => r.status === "fulfilled");
      const rejected = results.filter((r) => r.status === "rejected");

      // CRITICAL CHECK: Exactly one succeeds, the other is rejected with BudgetExceededError
      expect(fulfilled.length).toBe(1);
      expect(rejected.length).toBe(1);
      const rejectedReason = (rejected[0] as PromiseRejectedResult).reason;
      expect(rejectedReason).toBeInstanceOf(BudgetExceededError);

      // Verify total committed in SQLite never exceeds the $0.15 budget cap
      const ledger = bible.getSeriesBudgetLedger("series_budget_guard");
      expect(ledger.totalCommittedUsd).toBeLessThanOrEqual(0.15);

      // Verify Job Lease: Worker Alpha holding lease on job_lease_test blocks Worker Beta
      bible.createOrUpdateProviderJob({
        id: "pjob_lease_test",
        series_id: "series_budget_guard",
        episode_number: 1,
        shot_id: "shot_lease",
        provider: "mock",
        spec_hash: "hash123",
        status: "reserved",
        attempt_count: 1,
        max_attempts: 3,
        estimated_cost_usd: 0.05,
        reserved_cost_usd: 0.05,
        confirmed_cost_usd: 0,
        uncertain_cost_usd: 0,
        worker_id: "worker_alpha",
        is_retryable: true,
      });

      // Worker Alpha claims lease
      const leaseAlpha = bible.acquireJobLease("pjob_lease_test", "worker_alpha", 5000);
      expect(leaseAlpha).toBe(true);

      // Worker Beta tries to claim same lease -> MUST FAIL
      const leaseBeta = bible.acquireJobLease("pjob_lease_test", "worker_beta", 5000);
      expect(leaseBeta).toBe(false);

      // Once Alpha releases lease, Beta can acquire it
      bible.releaseJobLease("pjob_lease_test", "worker_alpha");
      const leaseBetaAfter = bible.acquireJobLease("pjob_lease_test", "worker_beta", 5000);
      expect(leaseBetaAfter).toBe(true);
    });
  });

  describe("4. Đồ thị Vô hiệu hóa Phụ thuộc Tối thiểu (Dependency Invalidation Graph)", () => {
    it("re-renders only dialogue audio when speech changes without requiring lip-sync, preserving 100% video compute", () => {
      const videoSpec = {
        prompt: "An looking into holographic terminal",
        provider: "mock",
        modelName: "default",
        durationSec: 4.0,
      };
      const vHash = computeVideoSpecHash(videoSpec);

      const prevGraph = {
        seriesId: "series_invalidation",
        episodeNumber: 1,
        nodes: {
          sc1_sh1: {
            shotId: "sc1_sh1",
            videoSpecHash: vHash,
            audioSpecHash: "audio_hash_v1",
            videoAssetPath: "output/shots/sc1_sh1.mp4",
            audioAssetPath: "output/audio/sc1_sh1.mp3",
            requiresLipSync: false, // NO LIP SYNC NEEDED
          },
        },
        masterTimelineAssetPath: "output/final.mp4",
      };

      // Now we modify ONLY dialogue text (audio spec hash changes, video spec hash is IDENTICAL)
      const currentShots = [
        {
          shotId: "sc1_sh1",
          videoSpec,
          audioSpec: {
            text: "Kế hoạch đã thay đổi, chuẩn bị rút lui ngay!",
            speaker: "An",
          },
          requiresLipSync: false,
        },
      ];

      const diff = buildInvalidationGraph(prevGraph, currentShots);

      // CRITICAL ACCEPTANCE CHECKS:
      // 1. Video shot MUST NOT be invalidated
      expect(diff.videoShotsToRender).toHaveLength(0);
      expect(diff.reusableVideoShots.get("sc1_sh1")).toBe("output/shots/sc1_sh1.mp4");

      // 2. Audio shot MUST be invalidated and re-rendered
      expect(diff.dialogueShotsToRender).toContain("sc1_sh1");

      // 3. Master timeline must be remuxed
      expect(diff.mustRebuildMasterTimeline).toBe(true);

      // Conversely, if requiresLipSync WAS true, then video MUST also be invalidated!
      const lipSyncShots = [
        {
          shotId: "sc1_sh1",
          videoSpec,
          audioSpec: {
            text: "Kế hoạch đã thay đổi, chuẩn bị rút lui ngay!",
            speaker: "An",
          },
          requiresLipSync: true, // Requires lip-sync!
        },
      ];

      const lipSyncDiff = buildInvalidationGraph(prevGraph, lipSyncShots);
      expect(lipSyncDiff.videoShotsToRender).toContain("sc1_sh1");
    });
  });

  describe("5. Bảng giá Động (Configurable Rate Cards) & Khảo sát Không Hard-code", () => {
    it("updates rate card dynamically and computes costs without hardcoded assumptions", () => {
      const bible = new BibleManager(testDbPath);
      const rateManager = new RateCardManager(bible);

      // Set new rate for Kling 3.0
      rateManager.setRate({
        provider: "api_kling",
        modelName: "kling-v3.0",
        ratePerSecUsd: 0.05,
        effectiveDate: "2026-09-09",
        sourceDocUrl: "https://klingai.org/pricing/2026-09",
        notes: "Official updated rate card for Kling 3.0",
      });

      const resolved = rateManager.resolveRate("api_kling", "kling-v3.0");
      expect(resolved.ratePerSecUsd).toBe(0.05);
      expect(resolved.effectiveDate).toBe("2026-09-09");
      expect(resolved.sourceDocUrl).toBe("https://klingai.org/pricing/2026-09");

      // Verify listing returns all active cards
      const allRates = rateManager.listActiveRates();
      expect(allRates.some((r) => r.model_name === "kling-v3.0")).toBe(true);
    });
  });
});
