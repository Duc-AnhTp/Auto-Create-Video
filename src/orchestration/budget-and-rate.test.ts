import { describe, it, expect, beforeEach } from "vitest";
import { StoryBibleManager } from "../bible/bible-manager.js";
import { BudgetLedger } from "./budget-ledger.js";
import { RateCardManager } from "./rate-card-manager.js";

describe("4-State Budget Ledger & Configurable Rate Cards (Requirements 8, 9, 10)", () => {
  let bible: StoryBibleManager;
  let ledger: BudgetLedger;
  let rateManager: RateCardManager;
  const SERIES_ID = "test_cyber_series_ep1";

  beforeEach(() => {
    bible = new StoryBibleManager(":memory:");
    ledger = new BudgetLedger(bible);
    rateManager = new RateCardManager(bible);

    // Set hard budget cap of $1.00 for testing
    bible.setSeriesBudget({
      series_id: SERIES_ID,
      max_budget_usd: 1.0,
      warning_threshold_ratio: 0.85,
      is_hard_capped: true,
      updated_at: new Date().toISOString(),
    });
  });

  it("RateCardManager seeds official rate cards and resolves dynamically by provider/model", () => {
    rateManager.seedDefaultRatesIfEmpty();
    const klingRate = rateManager.resolveRate("api_kling", "kling-v2");
    expect(klingRate.isConfigured).toBe(true);
    expect(klingRate.ratePerSecUsd).toBe(0.12);
    expect(klingRate.effectiveDate).toBe("2026-09-01");
    expect(klingRate.sourceDocUrl).toContain("klingai.org");

    // Updating a rate card with a newer effective date
    rateManager.setRate({
      id: "rate_kling_special_promo",
      provider: "api_kling",
      model_name: "kling-v2",
      rate_per_sec_usd: 0.10,
      rate_per_unit_usd: 0.10,
      unit_type: "second",
      currency: "USD",
      effective_date: "2026-10-01", // Newer date
      created_at: new Date().toISOString(),
    });

    const updated = rateManager.resolveRate("api_kling", "kling-v2");
    expect(updated.ratePerSecUsd).toBe(0.10);
    expect(updated.effectiveDate).toBe("2026-10-01");
  });

  it("Enforces atomic budget reservation and prevents multi-worker double-spend", () => {
    // Worker 1 reserves $0.60
    const res1 = ledger.atomicReserveForJob({
      id: "job_worker1_sh01",
      series_id: SERIES_ID,
      episode_number: 1,
      shot_id: "sh01",
      provider: "api_kling",
      spec_hash: "hash_sh01",
      attempt_count: 1,
      max_attempts: 3,
      estimated_cost_usd: 0.60,
      reserved_cost_usd: 0.60,
      confirmed_cost_usd: 0,
      uncertain_cost_usd: 0,
      is_retryable: true,
    });

    expect(res1.allowed).toBe(true);
    expect(res1.totalCommittedUsd).toBeCloseTo(0.60);
    expect(res1.remainingUsd).toBeCloseTo(0.40);

    // Worker 2 attempts to reserve $0.50 (0.60 + 0.50 = 1.10 > 1.00 max budget)
    const res2 = ledger.atomicReserveForJob({
      id: "job_worker2_sh02",
      series_id: SERIES_ID,
      episode_number: 1,
      shot_id: "sh02",
      provider: "api_runway",
      spec_hash: "hash_sh02",
      attempt_count: 1,
      max_attempts: 3,
      estimated_cost_usd: 0.50,
      reserved_cost_usd: 0.50,
      confirmed_cost_usd: 0,
      uncertain_cost_usd: 0,
      is_retryable: true,
    });

    // WORKER 2 IS STRICTLY REJECTED! No budget overrun
    expect(res2.allowed).toBe(false);
    expect(res2.reason).toContain("Budget cap exceeded");
    expect(res2.remainingUsd).toBeCloseTo(0.40);
  });

  it("Holds uncertain cost in the ledger so timeout jobs do not release funds prematurely", () => {
    // Worker 1 reserves $0.60
    ledger.atomicReserveForJob({
      id: "job_timeout_sh01",
      series_id: SERIES_ID,
      episode_number: 1,
      shot_id: "sh01",
      provider: "api_kling",
      spec_hash: "hash_sh01",
      attempt_count: 1,
      max_attempts: 3,
      estimated_cost_usd: 0.60,
      reserved_cost_usd: 0.60,
      confirmed_cost_usd: 0,
      uncertain_cost_usd: 0,
      is_retryable: true,
    });

    // Request times out with uncertain outcome
    ledger.markUncertainTimeout("job_timeout_sh01", "Gateway timeout after 120s");

    const summary = ledger.getLedgerSummary(SERIES_ID);
    expect(summary.uncertainCostUsd).toBeCloseTo(0.60);
    expect(summary.reservedCostUsd).toBe(0);
    expect(summary.totalCommittedUsd).toBeCloseTo(0.60);
    expect(summary.remainingAvailableUsd).toBeCloseTo(0.40);

    // Another worker still CANNOT spend the remaining budget with an over-budget job
    const resOver = ledger.atomicReserveForJob({
      id: "job_blocked_sh02",
      series_id: SERIES_ID,
      episode_number: 1,
      shot_id: "sh02",
      provider: "api_kling",
      spec_hash: "hash_sh02",
      attempt_count: 1,
      max_attempts: 3,
      estimated_cost_usd: 0.50,
      reserved_cost_usd: 0.50,
      confirmed_cost_usd: 0,
      uncertain_cost_usd: 0,
      is_retryable: true,
    });
    expect(resOver.allowed).toBe(false);

    // Now reconcile: remote provider confirmed the job was aborted with NO charge
    ledger.reconcileUncertainJob("job_timeout_sh01", "confirmed_no_charge");

    const reconciledSummary = ledger.getLedgerSummary(SERIES_ID);
    expect(reconciledSummary.uncertainCostUsd).toBe(0);
    expect(reconciledSummary.totalCommittedUsd).toBe(0);
    expect(reconciledSummary.remainingAvailableUsd).toBeCloseTo(1.0);

    // Now the second worker CAN reserve!
    const resNowAllowed = ledger.atomicReserveForJob({
      id: "job_unblocked_sh02",
      series_id: SERIES_ID,
      episode_number: 1,
      shot_id: "sh02",
      provider: "api_kling",
      spec_hash: "hash_sh02",
      attempt_count: 1,
      max_attempts: 3,
      estimated_cost_usd: 0.50,
      reserved_cost_usd: 0.50,
      confirmed_cost_usd: 0,
      uncertain_cost_usd: 0,
      is_retryable: true,
    });
    expect(resNowAllowed.allowed).toBe(true);
  });

  it("Records billable failed jobs under confirmed costs", () => {
    ledger.atomicReserveForJob({
      id: "job_failed_billed",
      series_id: SERIES_ID,
      episode_number: 1,
      shot_id: "sh03",
      provider: "api_runway",
      spec_hash: "hash_sh03",
      attempt_count: 1,
      max_attempts: 3,
      estimated_cost_usd: 0.45,
      reserved_cost_usd: 0.45,
      confirmed_cost_usd: 0,
      uncertain_cost_usd: 0,
      is_retryable: false,
    });

    // Remote provider generated the video but downstream content filter tripped and billed $0.45
    ledger.markFailed("job_failed_billed", {
      errorMessage: "Content filter tripped post-render; compute hours billed",
      isBillableFailure: true,
      actualCostUsd: 0.45,
    });

    const summary = ledger.getLedgerSummary(SERIES_ID);
    expect(summary.confirmedCostUsd).toBeCloseTo(0.45);
    expect(summary.reservedCostUsd).toBe(0);
    expect(summary.totalCommittedUsd).toBeCloseTo(0.45);
    expect(summary.remainingAvailableUsd).toBeCloseTo(0.55);
  });
});
