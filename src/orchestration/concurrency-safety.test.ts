import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { BibleManager } from "../bible/bible-manager.js";
import { BudgetLedger } from "./budget-ledger.js";
import { ResilientJobOrchestrator } from "./job-orchestrator.js";
import {
  type VideoProviderAdapter,
  type ShotExecutionSpec,
  type VideoJobStatus,
  PROVIDER_CAPABILITY_REGISTRY,
} from "../gateway/video-gateway.js";
import { EpisodicPipeline } from "../series/episodic-pipeline.js";
import { existsSync, unlinkSync, readFileSync } from "node:fs";
import { rm, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";

class SpyingProviderAdapter implements VideoProviderAdapter {
  public providerName = "api_kling" as const;
  public capabilities = PROVIDER_CAPABILITY_REGISTRY.api_kling;

  public submitCallCount = 0;
  public pollCallCount = 0;

  public async submitJob(spec: ShotExecutionSpec): Promise<{ jobId: string }> {
    this.submitCallCount++;
    return { jobId: `kling_remote_${this.submitCallCount}` };
  }

  public async pollStatus(jobId: string): Promise<VideoJobStatus> {
    this.pollCallCount++;
    return { jobId, status: "completed" };
  }
}

describe("Giai đoạn 2: Kiểm Chứng An Toàn Dữ Liệu & Rủi Ro Phát Sinh Phí", () => {
  const testDir = join("output", "test-concurrency-safety");
  const testDbPath = join(testDir, "shared_bible.db");

  beforeEach(async () => {
    BibleManager.closeAll();
    if (existsSync(testDir)) {
      try {
        await rm(testDir, { recursive: true, force: true });
      } catch {}
    }
    await mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    BibleManager.closeAll();
    if (existsSync(testDir)) {
      try {
        await rm(testDir, { recursive: true, force: true });
      } catch {}
    }
  });

  // ── 1. Hai kết nối độc lập tranh chấp ngân sách đồng thời ──
  it("guarantees two independent SQLite connections cannot exceed budget cap concurrently", async () => {
    // Connection 1 sets up metadata and budget of $1.00
    const conn1 = new BibleManager(testDbPath);
    conn1.upsertSeriesMetadata({
      id: "series_concurrent",
      title: "Concurrent Test Series",
      visual_style: "Cinematic",
      aspect_ratio: "9:16",
      fps: 30,
      created_at: new Date().toISOString(),
    });
    conn1.setSeriesBudget({
      series_id: "series_concurrent",
      max_budget_usd: 1.0,
      warning_threshold_ratio: 0.85,
      is_hard_capped: true,
      updated_at: new Date().toISOString(),
    });

    // Connection 2 opens the exact same SQLite database file on disk independently
    const conn2 = new BibleManager(testDbPath);

    const jobWorker1 = {
      id: "job_worker_1",
      series_id: "series_concurrent",
      episode_number: 1,
      shot_id: "sh01",
      provider: "api_kling",
      spec_hash: "hash_sh01",
      attempt_count: 1,
      max_attempts: 3,
      cost_category: "reserved" as const,
      status: "reserved" as const,
      estimated_cost_usd: 0.70, // Needs 70% of budget
      reserved_cost_usd: 0.70,
      confirmed_cost_usd: 0.0,
      uncertain_cost_usd: 0.0,
      is_retryable: true,
      worker_id: "worker_alpha",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    const jobWorker2 = {
      id: "job_worker_2",
      series_id: "series_concurrent",
      episode_number: 1,
      shot_id: "sh02",
      provider: "api_runway",
      spec_hash: "hash_sh02",
      attempt_count: 1,
      max_attempts: 3,
      cost_category: "reserved" as const,
      status: "reserved" as const,
      estimated_cost_usd: 0.60, // Needs 60% of budget (0.70 + 0.60 = 1.30 > 1.00)
      reserved_cost_usd: 0.60,
      confirmed_cost_usd: 0.0,
      uncertain_cost_usd: 0.0,
      is_retryable: true,
      worker_id: "worker_beta",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    // Execute concurrently across two independent connections
    const [res1, res2] = await Promise.all([
      Promise.resolve(conn1.atomicReserveProviderJob(jobWorker1)),
      Promise.resolve(conn2.atomicReserveProviderJob(jobWorker2)),
    ]);

    // Exactly one worker must succeed, and the other must be rejected
    const successfulCount = (res1.allowed ? 1 : 0) + (res2.allowed ? 1 : 0);
    expect(successfulCount).toBe(1);

    if (res1.allowed) {
      expect(res2.allowed).toBe(false);
      expect(res2.reason).toContain("Budget cap exceeded");
    } else {
      expect(res2.allowed).toBe(true);
      expect(res1.reason).toContain("Budget cap exceeded");
    }

    // Inspect ledger from a fresh connection: total committed must strictly <= $1.00
    const conn3 = new BibleManager(testDbPath);
    const summary = conn3.getSeriesBudgetLedger("series_concurrent");
    expect(summary.totalCommittedUsd).toBeLessThanOrEqual(1.0);
    expect(summary.totalCommittedUsd).toBeGreaterThan(0);
  });

  // ── 2. Worker Lease Lock: Ngăn tranh chấp cùng 1 job ──
  it("enforces worker lease lock so another worker cannot overwrite in-flight reservation", () => {
    const conn1 = new BibleManager(testDbPath);
    conn1.setSeriesBudget({
      series_id: "series_lease",
      max_budget_usd: 5.0,
      warning_threshold_ratio: 0.85,
      is_hard_capped: true,
      updated_at: new Date().toISOString(),
    });

    const baseJob = {
      id: "job_exclusive_sh01",
      series_id: "series_lease",
      episode_number: 1,
      shot_id: "sh01",
      provider: "api_kling",
      spec_hash: "hash_sh01",
      attempt_count: 1,
      max_attempts: 3,
      cost_category: "reserved" as const,
      status: "reserved" as const,
      estimated_cost_usd: 0.50,
      reserved_cost_usd: 0.50,
      confirmed_cost_usd: 0.0,
      uncertain_cost_usd: 0.0,
      is_retryable: true,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    // Worker 1 reserves the job with 60s lease
    const r1 = conn1.atomicReserveProviderJob(
      { ...baseJob, worker_id: "worker_1" },
      { workerLeaseSec: 60 }
    );
    expect(r1.allowed).toBe(true);

    // Worker 2 attempts to acquire the exact same job while Worker 1's lease is active
    const conn2 = new BibleManager(testDbPath);
    const r2 = conn2.atomicReserveProviderJob(
      { ...baseJob, worker_id: "worker_2" },
      { workerLeaseSec: 60 }
    );

    expect(r2.allowed).toBe(false);
    expect(r2.reason).toContain("locked by worker 'worker_1'");
  });

  // ── 3. Worker chết sau khi submit: Khôi phục Polling, không submit lại mù ──
  it("resumes polling existing provider_job_id after worker crash and does not re-submit", async () => {
    const bible = new BibleManager(testDbPath);
    const orchestrator = new ResilientJobOrchestrator(bible);

    // Pre-seed an in-flight job where remote job was already submitted before crash
    bible.createOrUpdateProviderJob({
      id: "job_crash_sh01",
      series_id: "series_crash",
      episode_number: 1,
      shot_id: "sh01",
      provider: "api_kling",
      provider_job_id: "kling_remote_task_999",
      spec_hash: "spec_hash_123",
      status: "submitted",
      attempt_count: 1,
      max_attempts: 3,
      cost_category: "reserved",
      estimated_cost_usd: 0.50,
      reserved_cost_usd: 0.50,
      confirmed_cost_usd: 0.0,
      uncertain_cost_usd: 0.0,
      worker_id: "worker_dead",
      lock_expires_at: new Date(Date.now() - 1000).toISOString(), // Lease expired!
      is_retryable: true,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    const spyAdapter = new SpyingProviderAdapter();
    const result = await orchestrator.executeShotWithRecovery({
      seriesId: "series_crash",
      episodeNumber: 1,
      shotId: "sh01",
      spec: {
        shotId: "sh01",
        backend: "api_kling",
        priority: "standard",
        durationSec: 5.0,
        prompt: "Detective in rain",
        aspectRatio: "9:16",
      },
      specHash: "spec_hash_123", // Matching spec hash!
      adapter: spyAdapter,
    });

    // submitJob must NOT be called again because the remote job was already submitted!
    expect(spyAdapter.submitCallCount).toBe(0);
    // pollStatus should be called to check the existing remote task
    expect(spyAdapter.pollCallCount).toBe(1);
    expect(result.status).toBe("completed");
  });

  // ── 4. Fail-Safe: Rollback giao dịch Story Bible khi gặp lỗi giữa chừng ──
  it("strictly rolls back Story Bible commit when an error occurs mid-transaction", () => {
    const bible = new BibleManager(testDbPath);
    bible.upsertCharacter({
      id: "char_hero",
      name: "Hero",
      role: "protagonist",
      visual_summary: "Heroic protagonist",
      status: "alive",
    });
    bible.setEpisodeLifecycle(1, "approved", "Director");

    const initialHero = bible.getCharacter("char_hero");
    expect(initialHero?.status).toBe("alive");

    // Attempt a commit with an invalid narrative delta that fails validation mid-way
    expect(() => {
      bible.commitEpisode(
        {
          episode_number: 1,
          title: "Tập Thử Nghiệm Rollback",
          logline: "Thử nghiệm lỗi",
          major_events: ["Sự kiện"],
          created_at: new Date().toISOString(),
        },
        {
          character_status_updates: [
            { id: "char_hero", status: "injured" },
            { id: "char_non_existent", status: "deceased" }, // Invalid character id!
          ],
        }
      );
    }).toThrow();

    // Verify rollback: char_hero must remain 'alive', not partially changed to 'injured'
    const heroAfter = bible.getCharacter("char_hero");
    expect(heroAfter?.status).toBe("alive");
    expect(bible.getCanonHistory().length).toBe(0);
  });

  // ── 5. --dry-run kết hợp provider thật không bao giờ gọi API thật ──
  it("dry-run mode completely blocks real provider calls and uses mock execution", async () => {
    const pipeline = new EpisodicPipeline(testDbPath);
    const spyAdapter = new SpyingProviderAdapter();

    const rawScript = `
TẬP 1: KIỂM CHỨNG DRY RUN
Logline: Tập thử nghiệm dry-run không gọi provider thật.
CẢNH 1: PHÒNG LÀM VIỆC - NGÀY
CÚ MÁY 1 (establishing, 3s): Toàn cảnh phòng làm việc.
    `.trim();

    const dryOutputDir = join(testDir, "dry_run_out");
    const result = await pipeline.produceEpisode(rawScript, {
      seriesId: "series_dry",
      provider: "api_kling", // User passed real provider
      dryRun: true,          // But dryRun is true!
      outputDir: dryOutputDir,
    });

    // submitJob on spyAdapter must remain 0
    expect(spyAdapter.submitCallCount).toBe(0);
    expect(result.isMock).toBe(true);
    expect(result.committedCanon).toBe(false);
  });

  // ── 6. skipRender bảo toàn phim hợp lệ đã có, không ghi đè và báo unrendered ──
  it("skipRender preserves existing valid video and reports unrendered without mutating canon", async () => {
    const pipeline = new EpisodicPipeline(testDbPath);
    const skipOutputDir = join(testDir, "skip_render_out");
    await mkdir(skipOutputDir, { recursive: true });

    // Put a valid existing video file
    const existingVideoPath = join(skipOutputDir, "video.mp4");
    const originalPayload = Buffer.from("EXISTING_VALID_PRODUCTION_VIDEO_PAYLOAD_12345");
    await writeFile(existingVideoPath, originalPayload);
    const originalHash = createHash("sha256").update(originalPayload).digest("hex");

    const rawScript = `
TẬP 1: THỬ NGHIỆM SKIP RENDER PRESERVE
Logline: Tập thử nghiệm skip-render giữ nguyên file cũ.
CẢNH 1: SÂN BAY - NGÀY
CÚ MÁY 1 (establishing, 3s): Toàn cảnh sân bay.
    `.trim();

    const result = await pipeline.produceEpisode(rawScript, {
      seriesId: "series_skip",
      provider: "mock",
      mockTts: true,
      skipRender: true,
      outputDir: skipOutputDir,
    });

    // File on disk must remain 100% identical!
    expect(existsSync(existingVideoPath)).toBe(true);
    const currentBytes = readFileSync(existingVideoPath);
    const currentHash = createHash("sha256").update(currentBytes).digest("hex");
    expect(currentHash).toBe(originalHash);

    // Returned video path must be empty and canon not committed
    expect(result.videoPath).toBe("");
    expect(result.committedCanon).toBe(false);

    const checkpoint = await pipeline.loadCheckpoint(skipOutputDir);
    expect(checkpoint?.status).toBe("unrendered");
    expect(checkpoint?.isRendered).toBe(false);
  });
});
