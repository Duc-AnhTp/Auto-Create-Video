import {log} from '../../../../platform/observability/logger.js';
import { WorkflowError } from "../../../../platform/workflow-error.js";
import { sqlInput } from "../../../../platform/sqlite/values.js";
import { createRequire } from "node:module";
import { type ApiUsageRecord,type BudgetLedgerSummary,type LlmTokenUsageRecord,type LlmTokenUsageSummary,type ProviderJobRecord,type ProviderRateCardRecord,type SeriesBudgetRecord } from "../../../../contracts/story.js";
import { type ProviderAttemptGroup } from "../../../../contracts/production.js";
import type { DatabaseSession } from "../../../../platform/sqlite/session.js";
import type { ProviderJobsRepositoryStore } from "../../ports/provider-jobs-repository-store.js";
export interface ProviderJobsRepositorySession extends DatabaseSession {store: Pick<ProviderJobsRepositoryStore, "getSeriesMetadata" | "transaction"|"findGroup"|"listGroups"|"putGroup"|"getGroup">;}
const nodeRequire=createRequire(import.meta.url);

export class ProviderJobsRepository {
  constructor(private session:()=>ProviderJobsRepositorySession){}
public logApiUsage(record: ApiUsageRecord & { series_id?: string }): void {
    if(!Number.isFinite(record.cost_usd)||record.cost_usd<0)throw new Error('INVALID_USAGE_AMOUNT');
    const ctx=this.session();
    const seriesId = record.series_id || ctx.store.getSeriesMetadata()?.id || null;
    if (ctx.db && !ctx.isFallback) {
      const stmt = ctx.db.prepare(`
        INSERT INTO api_usage_logs (series_id, episode_number, shot_id, provider, type, units, cost_usd, timestamp)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);
      const inserted=stmt.run(
        seriesId,
        record.episode_number ?? null,
        record.shot_id ?? null,
        record.provider,
        record.type,
        record.units,
        record.cost_usd,
        record.timestamp
      );
      if(!seriesId)ctx.db.prepare("INSERT OR IGNORE INTO legacy_usage_ownership VALUES(?,?,?)").run(inserted.lastInsertRowid,"[]","needs_review");
    } else {
      ctx.memoryStore.api_logs.push({ ...record, series_id: seriesId } as any);
    }
  }

public getEpisodeCost(episodeNumber: number, seriesId?: string): number {
    const ctx=this.session();
    const sId = seriesId || ctx.store.getSeriesMetadata()?.id;
    if (ctx.db && !ctx.isFallback) {
      let row: any;
      if (sId) {
        row = ctx.db.prepare(
          "SELECT SUM(cost_usd) as total_cost FROM api_usage_logs WHERE episode_number = ? AND series_id = ?"
        ).get(episodeNumber, sId);
      } else {
        row = ctx.db.prepare(
          "SELECT SUM(cost_usd) as total_cost FROM api_usage_logs WHERE episode_number = ?"
        ).get(episodeNumber);
      }
      return row?.total_cost ?? 0;
    }
    return ctx.memoryStore.api_logs
      .filter((l) => l.episode_number === episodeNumber && (!sId || (l as any).series_id === sId))
      .reduce((sum, l) => sum + l.cost_usd, 0);
  }

public createOrUpdateProviderJob(job: ProviderJobRecord): void {
    const ctx=this.session();
    const now = new Date().toISOString();
    const cleanJob: ProviderJobRecord = {
      ...job,
      cost_category: job.cost_category || "estimated",
      metadata_json: job.metadata_json || "{}",
      created_at: job.created_at || now,
      updated_at: now,
      is_retryable: Boolean(job.is_retryable),
    };

    if (ctx.db && !ctx.isFallback) {
      const stmt = ctx.db.prepare(`
        INSERT INTO provider_jobs (
          id, series_id, episode_number, shot_id, provider, model_name,
          provider_job_id, idempotency_key, spec_hash, status, attempt_count,
          max_attempts, cost_category, estimated_cost_usd, reserved_cost_usd,
          confirmed_cost_usd, uncertain_cost_usd, output_url, output_local_path,
          error_code, error_message, is_retryable, worker_id, lock_expires_at,
          metadata_json, created_at, updated_at, completed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          status = excluded.status,
          provider_job_id = coalesce(excluded.provider_job_id, provider_jobs.provider_job_id),
          idempotency_key = coalesce(excluded.idempotency_key, provider_jobs.idempotency_key),
          attempt_count = excluded.attempt_count,
          cost_category = excluded.cost_category,
          estimated_cost_usd = excluded.estimated_cost_usd,
          reserved_cost_usd = excluded.reserved_cost_usd,
          confirmed_cost_usd = CASE WHEN json_valid(excluded.metadata_json) AND json_extract(excluded.metadata_json,'$.cost_source') IN ('provider_invoice','manual_reconciliation') THEN excluded.confirmed_cost_usd WHEN excluded.confirmed_cost_usd > provider_jobs.confirmed_cost_usd THEN excluded.confirmed_cost_usd ELSE provider_jobs.confirmed_cost_usd END,
          uncertain_cost_usd = CASE WHEN excluded.cost_category='confirmed' OR json_valid(excluded.metadata_json) AND json_extract(excluded.metadata_json,'$.cost_source')='manual_reconciliation' THEN excluded.uncertain_cost_usd WHEN excluded.uncertain_cost_usd > provider_jobs.uncertain_cost_usd THEN excluded.uncertain_cost_usd ELSE provider_jobs.uncertain_cost_usd END,
          output_url = coalesce(excluded.output_url, provider_jobs.output_url),
          output_local_path = coalesce(excluded.output_local_path, provider_jobs.output_local_path),
          error_code = excluded.error_code,
          error_message = excluded.error_message,
          is_retryable = excluded.is_retryable,
          worker_id = excluded.worker_id,
          lock_expires_at = excluded.lock_expires_at,
          metadata_json = excluded.metadata_json,
          updated_at = excluded.updated_at,
          completed_at = coalesce(excluded.completed_at, provider_jobs.completed_at)
      `);

      stmt.run(
        sqlInput(cleanJob.id),
        sqlInput(cleanJob.series_id),
        sqlInput(cleanJob.episode_number),
        sqlInput(cleanJob.shot_id),
        sqlInput(cleanJob.provider),
        sqlInput(cleanJob.model_name ?? null),
        sqlInput(cleanJob.provider_job_id ?? null),
        sqlInput(cleanJob.idempotency_key ?? null),
        sqlInput(cleanJob.spec_hash),
        sqlInput(cleanJob.status),
        sqlInput(cleanJob.attempt_count ?? 1),
        sqlInput(cleanJob.max_attempts ?? 3),
        sqlInput(cleanJob.cost_category),
        sqlInput(cleanJob.estimated_cost_usd ?? 0.0),
        sqlInput(cleanJob.reserved_cost_usd ?? 0.0),
        sqlInput(cleanJob.confirmed_cost_usd ?? 0.0),
        sqlInput(cleanJob.uncertain_cost_usd ?? 0.0),
        sqlInput(cleanJob.output_url ?? null),
        sqlInput(cleanJob.output_local_path ?? null),
        sqlInput(cleanJob.error_code ?? null),
        sqlInput(cleanJob.error_message ?? null),
        sqlInput(cleanJob.is_retryable ? 1 : 0),
        sqlInput(cleanJob.worker_id ?? null),
        sqlInput(cleanJob.lock_expires_at ?? null),
        sqlInput(cleanJob.metadata_json),
        sqlInput(cleanJob.created_at),
        sqlInput(cleanJob.updated_at),
        sqlInput(cleanJob.completed_at ?? null)
      );
    } else {
      const existing = ctx.memoryStore.provider_jobs.get(cleanJob.id);
      if (existing) {
        const source=JSON.parse(cleanJob.metadata_json??'{}').cost_source;
        if(source!=='provider_invoice'&&source!=='manual_reconciliation')cleanJob.confirmed_cost_usd = Math.max(cleanJob.confirmed_cost_usd ?? 0, existing.confirmed_cost_usd ?? 0);
        cleanJob.uncertain_cost_usd = Math.max(cleanJob.uncertain_cost_usd ?? 0, existing.uncertain_cost_usd ?? 0);
      }
      ctx.memoryStore.provider_jobs.set(cleanJob.id, cleanJob);
    }
  }

public atomicReserveProviderJob(
    job: ProviderJobRecord,
    options: {
      budgetCapUsd?: number;
      workerLeaseSec?: number;
    } = {}
  ): {
    allowed: boolean;
    remainingUsd: number;
    totalCommittedUsd: number;
    reason?: string;
    reservedRecord?: ProviderJobRecord;
  } {
    const ctx=this.session();
    if(options.budgetCapUsd!==undefined&&(!Number.isFinite(options.budgetCapUsd)||options.budgetCapUsd<0))throw new WorkflowError("INVALID_BUDGET_CAP", "INVALID_BUDGET_CAP", "needs_review");
    if(!Number.isFinite(job.estimated_cost_usd)||job.estimated_cost_usd<0)throw new WorkflowError("INVALID_COST_ESTIMATE", "INVALID_COST_ESTIMATE", "failed");
    const seriesId = job.series_id;
    const workerLeaseSec = options.workerLeaseSec ?? 120;
    const now = new Date();
    const nowIso = now.toISOString();
    const lockExpiresAt = new Date(now.getTime() + workerLeaseSec * 1000).toISOString();

    const estimatedCost =
      job.estimated_cost_usd !== undefined
        ? job.estimated_cost_usd
        : (job.reserved_cost_usd ?? 0.0);

    const cleanJob: ProviderJobRecord = {
      ...job,
      status: "reserved",
      cost_category: "reserved",
      estimated_cost_usd: estimatedCost,
      reserved_cost_usd: estimatedCost,
      confirmed_cost_usd: job.confirmed_cost_usd ?? 0.0,
      uncertain_cost_usd: job.uncertain_cost_usd ?? 0.0,
      worker_id: job.worker_id || "worker_default",
      lock_expires_at: lockExpiresAt,
      created_at: job.created_at || nowIso,
      updated_at: nowIso,
    };

    if (ctx.db && !ctx.isFallback) {
      ctx.db.exec("BEGIN IMMEDIATE TRANSACTION;");
      try {
        // 1. Worker lock and lease verification
        const existingRow = ctx.db
          .prepare("SELECT id, worker_id, lock_expires_at, status, spec_hash, provider, confirmed_cost_usd, reserved_cost_usd, uncertain_cost_usd FROM provider_jobs WHERE id = ?")
          .get(cleanJob.id) as any;

        if (existingRow) {
          const isExpired = existingRow.lock_expires_at
            ? new Date(existingRow.lock_expires_at).getTime() <= now.getTime()
            : true;
          if (existingRow.worker_id && existingRow.worker_id !== cleanJob.worker_id && !isExpired) {
            ctx.db.exec("ROLLBACK;");
            const summary = this.getSeriesBudgetLedger(seriesId);
            return {
              allowed: false,
              remainingUsd: summary.remainingAvailableUsd,
              totalCommittedUsd: summary.totalCommittedUsd,
              reason: `Job '${cleanJob.id}' is locked by worker '${existingRow.worker_id}' until ${existingRow.lock_expires_at}`,
            };
          }
          cleanJob.confirmed_cost_usd = Math.max(cleanJob.confirmed_cost_usd, Number(existingRow.confirmed_cost_usd || 0));
          cleanJob.uncertain_cost_usd = Math.max(cleanJob.uncertain_cost_usd, Number(existingRow.uncertain_cost_usd || 0));
        }

        // 2. Query budget ledger within the transaction
        const budget = this.getSeriesBudget(seriesId);
        const effectiveCap =
          options.budgetCapUsd !== undefined
            ? Math.min(budget.max_budget_usd, options.budgetCapUsd)
            : budget.max_budget_usd;

        const rows = ctx.db
          .prepare(`
            SELECT cost_category, status,
                   SUM(confirmed_cost_usd) as sum_confirmed,
                   SUM(reserved_cost_usd) as sum_reserved,
                   SUM(uncertain_cost_usd) as sum_uncertain
            FROM provider_jobs
            WHERE series_id = ?
            GROUP BY cost_category, status
          `)
          .all(seriesId) as any[];

        let confirmedCost = 0;
        let reservedCost = 0;
        let uncertainCost = 0;

        for (const r of rows) {
          if (r.cost_category === "confirmed" || r.status === "completed" && r.cost_category !== "uncertain") {
            confirmedCost += Number(r.sum_confirmed || 0);
          } else if (r.status === "uncertain_timeout" || r.cost_category === "uncertain") {
            uncertainCost += Number(r.sum_uncertain || r.sum_reserved || 0);
          } else if (["reserved", "submitting", "submitted", "running"].includes(r.status)) {
            reservedCost += Number(r.sum_reserved || 0);
          }
        }

        if (existingRow && ["reserved", "submitting", "submitted", "running"].includes(existingRow.status)) {
          reservedCost = Math.max(0, reservedCost - Number(existingRow.reserved_cost_usd || 0));
        }

        const apiLogSum = ctx.db
          .prepare("SELECT SUM(cost_usd) as total FROM api_usage_logs WHERE series_id = ? AND type = 'video'")
          .get(seriesId) as any;
        if (apiLogSum?.total) {
          confirmedCost = Math.max(confirmedCost, Number(apiLogSum.total));
        }

        if(ctx.db.prepare("SELECT log_id FROM legacy_usage_ownership WHERE status='needs_review' AND (candidates='[]' OR EXISTS (SELECT 1 FROM json_each(candidates) WHERE value=?)) LIMIT 1").get(seriesId)) {ctx.db.exec('ROLLBACK');return {allowed:false,remainingUsd:0,totalCommittedUsd:confirmedCost+reservedCost+uncertainCost,reason:'LEGACY_USAGE_RECONCILIATION_REQUIRED'};}
        const currentCommitted = confirmedCost + reservedCost + uncertainCost;
        const requestedCost = cleanJob.estimated_cost_usd ?? 0.0;
        const potentialCommitment = currentCommitted + requestedCost;

        if (potentialCommitment > effectiveCap) {
          ctx.db.exec("ROLLBACK;");
          return {
            allowed: false,
            remainingUsd: Math.max(0, effectiveCap - currentCommitted),
            totalCommittedUsd: Math.round(currentCommitted * 10000) / 10000,
            reason: `Budget cap exceeded ($${effectiveCap.toFixed(2)})`,
          };
        }

        // 3. Write reservation record inside the transaction
        this.createOrUpdateProviderJob(cleanJob);
        const metadata=JSON.parse(cleanJob.metadata_json??"{}");
        if(metadata.attempt_group_id&&!ctx.store.getGroup(metadata.attempt_group_id))ctx.store.putGroup({id:metadata.attempt_group_id,seriesId:cleanJob.series_id,episodeNumber:cleanJob.episode_number,shotId:cleanJob.shot_id,specHash:cleanJob.spec_hash,primaryId:cleanJob.id,hedgeDueAt:0,status:"reserved",spec:metadata.execution_spec??{},createdAt:cleanJob.created_at??new Date().toISOString()});
        ctx.db.exec("COMMIT;");

        const newTotalCommitted = Math.round((currentCommitted + requestedCost) * 10000) / 10000;
        return {
          allowed: true,
          remainingUsd: Math.max(0, Math.round((effectiveCap - newTotalCommitted) * 10000) / 10000),
          totalCommittedUsd: newTotalCommitted,
          reservedRecord: cleanJob,
        };
      } catch (err) {
        try {
          ctx.db.exec("ROLLBACK;");
        } catch (caughtError) { log.warn("[provider-jobs-repository] "+String(caughtError)); }
        throw err;
      }
    } else {
      // Memory store fallback
      const existing = ctx.memoryStore.provider_jobs.get(cleanJob.id);
      if (existing) {
        const isExpired = existing.lock_expires_at
          ? new Date(existing.lock_expires_at).getTime() <= now.getTime()
          : true;
        if (existing.worker_id && existing.worker_id !== cleanJob.worker_id && !isExpired) {
          const summary = this.getSeriesBudgetLedger(seriesId);
          return {
            allowed: false,
            remainingUsd: summary.remainingAvailableUsd,
            totalCommittedUsd: summary.totalCommittedUsd,
            reason: `Job '${cleanJob.id}' is locked by worker '${existing.worker_id}' until ${existing.lock_expires_at}`,
          };
        }
        cleanJob.confirmed_cost_usd = Math.max(cleanJob.confirmed_cost_usd ?? 0, existing.confirmed_cost_usd ?? 0);
        cleanJob.uncertain_cost_usd = Math.max(cleanJob.uncertain_cost_usd ?? 0, existing.uncertain_cost_usd ?? 0);
      }

      const budget = this.getSeriesBudget(seriesId);
      const effectiveCap =
        options.budgetCapUsd !== undefined
          ? Math.min(budget.max_budget_usd, options.budgetCapUsd)
          : budget.max_budget_usd;

      const summary = this.getSeriesBudgetLedger(seriesId);
      const currentJobPreviousReserved =
        (existing && ["reserved", "submitting", "submitted", "running"].includes(existing.status))
          ? (existing.reserved_cost_usd || 0)
          : 0;
      const currentCommitted = summary.totalCommittedUsd - currentJobPreviousReserved;
      const requestedCost = cleanJob.estimated_cost_usd ?? 0.0;
      const potentialCommitment = currentCommitted + requestedCost;

      if (potentialCommitment > effectiveCap) {
        return {
          allowed: false,
          remainingUsd: Math.max(0, effectiveCap - currentCommitted),
          totalCommittedUsd: Math.round(currentCommitted * 10000) / 10000,
          reason: `Budget cap exceeded ($${effectiveCap.toFixed(2)})`,
        };
      }

      this.createOrUpdateProviderJob(cleanJob);
      const newTotalCommitted = Math.round((currentCommitted + requestedCost) * 10000) / 10000;
      return {
        allowed: true,
        remainingUsd: Math.max(0, Math.round((effectiveCap - newTotalCommitted) * 10000) / 10000),
        totalCommittedUsd: newTotalCommitted,
        reservedRecord: cleanJob,
      };
    }
  }

public getProviderJobsForShot(
    seriesId: string,
    episodeNumber: number,
    shotId: string
  ): ProviderJobRecord[] {
    const ctx=this.session();
    if (ctx.db && !ctx.isFallback) {
      const rows = ctx.db
        .prepare(
          "SELECT * FROM provider_jobs WHERE series_id = ? AND episode_number = ? AND shot_id = ? ORDER BY created_at DESC"
        )
        .all(seriesId, episodeNumber, shotId) as any[];
      return rows.map((r) => ({
        ...r,
        is_retryable: Boolean(r.is_retryable),
      }));
    }
    return Array.from(ctx.memoryStore.provider_jobs.values())
      .filter(
        (j) =>
          j.series_id === seriesId &&
          j.episode_number === episodeNumber &&
          j.shot_id === shotId
      )
      .sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""));
  }

public getProviderJob(id: string): ProviderJobRecord | null {
    const ctx=this.session();
    if (ctx.db && !ctx.isFallback) {
      const row = ctx.db.prepare("SELECT * FROM provider_jobs WHERE id = ?").get(id);
      if (!row) return null;
      return {
        ...row,
        is_retryable: Boolean(row.is_retryable),
      } as ProviderJobRecord;
    }
    return ctx.memoryStore.provider_jobs.get(id) ?? null;
  }

public findJobByRemoteId(provider: string, providerJobId: string): ProviderJobRecord | null {
    const ctx=this.session();
    if (ctx.db && !ctx.isFallback) {
      const row = ctx.db.prepare(
        "SELECT * FROM provider_jobs WHERE provider = ? AND provider_job_id = ?"
      ).get(provider, providerJobId);
      if (!row) return null;
      return {
        ...row,
        is_retryable: Boolean(row.is_retryable),
      } as ProviderJobRecord;
    }
    const match = Array.from(ctx.memoryStore.provider_jobs.values()).find(
      (j) => j.provider === provider && j.provider_job_id === providerJobId
    );
    return match ?? null;
  }

public findCompletedJobBySpecHash(specHash: string): ProviderJobRecord | null {
    const ctx=this.session();
    if (ctx.db && !ctx.isFallback) {
      const row = ctx.db.prepare(
        "SELECT * FROM provider_jobs WHERE spec_hash = ? AND status = 'completed' ORDER BY updated_at DESC LIMIT 1"
      ).get(specHash);
      if (!row) return null;
      return {
        ...row,
        is_retryable: Boolean(row.is_retryable),
      } as ProviderJobRecord;
    }
    const matches = Array.from(ctx.memoryStore.provider_jobs.values())
      .filter((j) => j.spec_hash === specHash && j.status === "completed")
      .sort((a, b) => ((b.updated_at || "") > (a.updated_at || "") ? 1 : -1));
    return matches[0] ?? null;
  }

public listPendingJobsForSeries(seriesId: string, episodeNumber?: number): ProviderJobRecord[] {
    const ctx=this.session();
    const pendingStatuses = ["queued", "reserved", "submitting", "submitted", "running", "uncertain_timeout"];
    if (ctx.db && !ctx.isFallback) {
      let query = `
        SELECT * FROM provider_jobs
        WHERE series_id = ? AND status IN (${pendingStatuses.map(() => "?").join(", ")})
      `;
      const params: any[] = [seriesId, ...pendingStatuses];
      if (episodeNumber !== undefined) {
        query += " AND episode_number = ?";
        params.push(episodeNumber);
      }
      query += " ORDER BY episode_number ASC, shot_id ASC";
      const rows = ctx.db.prepare(query).all(...params) as any[];
      return rows.map((r) => ({
        ...r,
        is_retryable: Boolean(r.is_retryable),
      }));
    }
    return Array.from(ctx.memoryStore.provider_jobs.values()).filter(
      (j) =>
        j.series_id === seriesId &&
        pendingStatuses.includes(j.status) &&
        (episodeNumber === undefined || j.episode_number === episodeNumber)
    );
  }

public listProviderJobs(seriesId?: string, episodeNumber?: number): ProviderJobRecord[] {
    const ctx=this.session();
    if (ctx.db && !ctx.isFallback) {
      let query = "SELECT * FROM provider_jobs WHERE 1=1";
      const params: any[] = [];
      if (seriesId) {
        query += " AND series_id = ?";
        params.push(seriesId);
      }
      if (episodeNumber !== undefined) {
        query += " AND episode_number = ?";
        params.push(episodeNumber);
      }
      query += " ORDER BY created_at DESC";
      const rows = ctx.db.prepare(query).all(...params) as any[];
      return rows.map((r) => ({
        ...r,
        is_retryable: Boolean(r.is_retryable),
      }));
    }
    return Array.from(ctx.memoryStore.provider_jobs.values())
      .filter(
        (j) =>
          (!seriesId || j.series_id === seriesId) &&
          (episodeNumber === undefined || j.episode_number === episodeNumber)
      )
      .sort((a, b) => ((b.created_at || "") > (a.created_at || "") ? 1 : -1));
  }

public acquireJobLease(jobId: string, workerId: string, leaseDurationMs: number = 60000): boolean {
    const ctx=this.session();
    const now = new Date();
    const lockExpiresAt = new Date(now.getTime() + leaseDurationMs).toISOString();
    const nowIso = now.toISOString();

    if (ctx.db && !ctx.isFallback) {
      // Atomic compare-and-swap lease acquisition
      const stmt = ctx.db.prepare(`
        UPDATE provider_jobs
        SET worker_id = ?, lock_expires_at = ?, updated_at = ?
        WHERE id = ? AND (worker_id IS NULL OR worker_id = ? OR lock_expires_at < ?)
      `);
      const res = stmt.run(workerId, lockExpiresAt, nowIso, jobId, workerId, nowIso);
      return (res?.changes || 0) > 0;
    }

    const job = ctx.memoryStore.provider_jobs.get(jobId);
    if (!job) return false;
    const isFree = !job.worker_id || job.worker_id === workerId || (job.lock_expires_at && job.lock_expires_at < nowIso);
    if (isFree) {
      job.worker_id = workerId;
      job.lock_expires_at = lockExpiresAt;
      job.updated_at = nowIso;
      return true;
    }
    return false;
  }

public releaseJobLease(jobId: string, workerId: string): void {
    const ctx=this.session();
    const now = new Date().toISOString();
    if (ctx.db && !ctx.isFallback) {
      ctx.db.prepare(`
        UPDATE provider_jobs
        SET worker_id = NULL, lock_expires_at = NULL, updated_at = ?
        WHERE id = ? AND worker_id = ?
      `).run(now, jobId, workerId);
    } else {
      const job = ctx.memoryStore.provider_jobs.get(jobId);
      if (job && job.worker_id === workerId) {
        job.worker_id = undefined;
        job.lock_expires_at = undefined;
        job.updated_at = now;
      }
    }
  }

public setSeriesBudget(
    budgetOrSeriesId: SeriesBudgetRecord | string,
    maxBudgetUsd?: number,
    warningThresholdRatio?: number,
    isHardCapped?: boolean,
    notes?: string
  ): void {
    const ctx=this.session();
    const now = new Date().toISOString();
    let budget: SeriesBudgetRecord;
    if (typeof budgetOrSeriesId === "string") {
      budget = {
        series_id: budgetOrSeriesId,
        max_budget_usd: maxBudgetUsd ?? 10.0,
        warning_threshold_ratio: warningThresholdRatio ?? 0.85,
        is_hard_capped: isHardCapped ?? true,
        notes,
        updated_at: now,
      };
    } else {
      budget = budgetOrSeriesId;
    }
    const clean: SeriesBudgetRecord = {
      ...budget,
      is_hard_capped: Boolean(budget.is_hard_capped),
      updated_at: budget.updated_at || now,
    };

    if (ctx.db && !ctx.isFallback) {
      ctx.db.prepare(`
        INSERT INTO series_budgets (
          series_id, max_budget_usd, warning_threshold_ratio, is_hard_capped, notes, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(series_id) DO UPDATE SET
          max_budget_usd = excluded.max_budget_usd,
          warning_threshold_ratio = excluded.warning_threshold_ratio,
          is_hard_capped = excluded.is_hard_capped,
          notes = excluded.notes,
          updated_at = excluded.updated_at
      `).run(
        clean.series_id,
        clean.max_budget_usd,
        clean.warning_threshold_ratio ?? 0.85,
        clean.is_hard_capped ? 1 : 0,
        clean.notes ?? null,
        clean.updated_at
      );
    } else {
      ctx.memoryStore.series_budgets.set(clean.series_id, clean);
    }
  }

public getSeriesBudget(seriesId: string): SeriesBudgetRecord {
    const ctx=this.session();
    if (ctx.db && !ctx.isFallback) {
      const row = ctx.db.prepare("SELECT * FROM series_budgets WHERE series_id = ?").get(seriesId);
      if (row) {
        return {
          ...row,
          is_hard_capped: Boolean(row.is_hard_capped),
        } as SeriesBudgetRecord;
      }
    } else {
      const b = ctx.memoryStore.series_budgets.get(seriesId);
      if (b) return b;
    }
    return {
      series_id: seriesId,
      max_budget_usd: 25.0, // Default $25 per series
      warning_threshold_ratio: 0.85,
      is_hard_capped: true,
      updated_at: new Date().toISOString(),
    };
  }

public getSeriesBudgetLedger(seriesId: string): BudgetLedgerSummary {
    const ctx=this.session();
    const budget = this.getSeriesBudget(seriesId);
    let estimatedCost = 0;
    let confirmedCost = 0;
    let confirmedInvoicedCostUsd = 0;
    let confirmedEstimatedCostUsd = 0;
    let confirmedManualCostUsd = 0;
    let uncertainAttemptCount = 0;
    let reservedCost = 0;
    let uncertainCost = 0;

    if (ctx.db && !ctx.isFallback) {
      const rows = ctx.db.prepare(`
        SELECT cost_category, status, metadata_json, COUNT(*) AS attempt_count,
               SUM(estimated_cost_usd) as sum_estimated,
               SUM(confirmed_cost_usd) as sum_confirmed,
               SUM(reserved_cost_usd) as sum_reserved,
               SUM(uncertain_cost_usd) as sum_uncertain
        FROM provider_jobs
        WHERE series_id = ?
        GROUP BY cost_category, status, metadata_json
      `).all(seriesId) as any[];

      for (const r of rows) {
        estimatedCost += Number(r.sum_estimated || 0);
        if (r.cost_category === "confirmed" || r.status === "completed" && r.cost_category !== "uncertain") {
          const cost = Number(r.sum_confirmed || 0);
          confirmedCost += cost;
          let isInvoiced = false, isManual = false;
          try {
            const meta = JSON.parse(r.metadata_json || "{}");
            isInvoiced = meta.is_invoiced === true || meta.cost_source === "provider_invoice";
            isManual = meta.cost_source === "manual_reconciliation";
          } catch (caughtError) { log.warn("[provider-jobs-repository] "+String(caughtError)); }
          if (isManual) {
            confirmedManualCostUsd += cost;
          } else if (isInvoiced) {
            confirmedInvoicedCostUsd += cost;
          } else {
            confirmedEstimatedCostUsd += cost;
          }
        } else if (r.status === "uncertain_timeout" || r.cost_category === "uncertain") {
          uncertainAttemptCount += Number(r.attempt_count);
          uncertainCost += Number(r.sum_uncertain || r.sum_reserved || 0);
        } else if (["reserved", "submitting", "submitted", "running"].includes(r.status)) {
          reservedCost += Number(r.sum_reserved || 0);
        }
      }

      // Also sum legacy api_usage_logs if present
      const apiLogSum = ctx.db.prepare(`
        SELECT SUM(cost_usd) as total FROM api_usage_logs WHERE series_id = ? AND type = 'video'
      `).get(seriesId) as any;
      if (apiLogSum?.total) {
        const legacyTotal = Number(apiLogSum.total);
        if (legacyTotal > confirmedCost) {
          const diff = legacyTotal - confirmedCost;
          confirmedEstimatedCostUsd += diff;
          confirmedCost = legacyTotal;
        }
      }
    } else {
      for (const j of ctx.memoryStore.provider_jobs.values()) {
        if (j.series_id !== seriesId) continue;
        estimatedCost += j.estimated_cost_usd || 0;
        if (j.cost_category === "confirmed" || j.status === "completed" && j.cost_category !== "uncertain") {
          const cost = j.confirmed_cost_usd || 0;
          confirmedCost += cost;
          let isInvoiced = false, isManual = false;
          try {
            const meta = JSON.parse(j.metadata_json || "{}");
            isInvoiced = meta.is_invoiced === true || meta.cost_source === "provider_invoice";
            isManual = meta.cost_source === "manual_reconciliation";
          } catch (caughtError) { log.warn("[provider-jobs-repository] "+String(caughtError)); }
          if (isManual) {
            confirmedManualCostUsd += cost;
          } else if (isInvoiced) {
            confirmedInvoicedCostUsd += cost;
          } else {
            confirmedEstimatedCostUsd += cost;
          }
        } else if (j.status === "uncertain_timeout" || j.cost_category === "uncertain") {
          uncertainAttemptCount++;
          uncertainCost += j.uncertain_cost_usd || j.reserved_cost_usd || 0;
        } else if (["reserved", "submitting", "submitted", "running"].includes(j.status)) {
          reservedCost += j.reserved_cost_usd || 0;
        }
      }
    }

    const totalCommitted = confirmedCost + reservedCost + uncertainCost;
    const remainingAvailable = Math.max(0, budget.max_budget_usd - totalCommitted);
    const isExceeded = totalCommitted > budget.max_budget_usd;

    return {
      seriesId,
      maxBudgetUsd: budget.max_budget_usd,
      estimatedCostUsd: Math.round(estimatedCost * 10000) / 10000,
      confirmedCostUsd: Math.round(confirmedCost * 10000) / 10000,
      confirmedInvoicedCostUsd: Math.round(confirmedInvoicedCostUsd * 10000) / 10000,
      confirmedEstimatedCostUsd: Math.round(confirmedEstimatedCostUsd * 10000) / 10000,
      confirmedManualCostUsd: Math.round(confirmedManualCostUsd * 10000) / 10000,
      uncertainAttemptCount,
      reservedCostUsd: Math.round(reservedCost * 10000) / 10000,
      uncertainCostUsd: Math.round(uncertainCost * 10000) / 10000,
      totalCommittedUsd: Math.round(totalCommitted * 10000) / 10000,
      remainingAvailableUsd: Math.round(remainingAvailable * 10000) / 10000,
      isExceeded,
    };
  }

public atomicReserveBudget(
    seriesId: string,
    amountUsd: number
  ): { allowed: boolean; remaining: number; totalCommitted: number } {
    const ctx=this.session();
    const ledger = this.getSeriesBudgetLedger(seriesId);
    if (ledger.totalCommittedUsd + amountUsd > ledger.maxBudgetUsd) {
      return {
        allowed: false,
        remaining: ledger.remainingAvailableUsd,
        totalCommitted: ledger.totalCommittedUsd,
      };
    }
    return {
      allowed: true,
      remaining: ledger.remainingAvailableUsd - amountUsd,
      totalCommitted: ledger.totalCommittedUsd + amountUsd,
    };
  }

public setRateCard(rateCard: any): void {
    const ctx=this.session();
    const now = new Date().toISOString();
    const modelName = rateCard.model_name ?? rateCard.modelName ?? "default";
    const provider = rateCard.provider;
    const effectiveDate = rateCard.effective_date ?? rateCard.effectiveDate ?? now.split("T")[0];
    const id = rateCard.id ?? `rate_${provider}_${modelName}_${effectiveDate.replace(/-/g, "")}`;
    const ratePerSec = rateCard.rate_per_sec_usd ?? rateCard.ratePerSecUsd ?? 0.0;
    const clean: ProviderRateCardRecord = {
      id,
      provider,
      model_name: modelName,
      rate_per_sec_usd: ratePerSec,
      rate_per_unit_usd: rateCard.rate_per_unit_usd ?? rateCard.ratePerUnitUsd ?? ratePerSec,
      unit_type: rateCard.unit_type ?? rateCard.unitType ?? "second",
      currency: rateCard.currency ?? "USD",
      effective_date: effectiveDate,
      source_doc_url: rateCard.source_doc_url ?? rateCard.sourceDocUrl ?? null,
      notes: rateCard.notes ?? null,
      created_at: rateCard.created_at ?? now,
    };

    if (ctx.db && !ctx.isFallback) {
      ctx.db.prepare(`
        INSERT INTO provider_rate_cards (
          id, provider, model_name, rate_per_sec_usd, rate_per_unit_usd,
          unit_type, currency, effective_date, source_doc_url, notes, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          rate_per_sec_usd = excluded.rate_per_sec_usd,
          rate_per_unit_usd = excluded.rate_per_unit_usd,
          unit_type = excluded.unit_type,
          currency = excluded.currency,
          effective_date = excluded.effective_date,
          source_doc_url = excluded.source_doc_url,
          notes = excluded.notes
      `).run(
        clean.id,
        clean.provider,
        clean.model_name,
        clean.rate_per_sec_usd,
        clean.rate_per_unit_usd ?? null,
        clean.unit_type || "second",
        clean.currency || "USD",
        clean.effective_date,
        clean.source_doc_url ?? null,
        clean.notes ?? null,
        clean.created_at
      );
    } else {
      ctx.memoryStore.provider_rate_cards.set(clean.id, clean);
    }
  }

public getRateCard(provider: string, modelName?: string): ProviderRateCardRecord | null {
    const ctx=this.session();
    if (ctx.db && !ctx.isFallback) {
      let query = "SELECT * FROM provider_rate_cards WHERE provider = ?";
      const params: any[] = [provider];
      if (modelName) {
        query += " AND model_name = ?";
        params.push(modelName);
      }
      query += " ORDER BY effective_date DESC LIMIT 1";
      const row = ctx.db.prepare(query).get(...params);
      return (row as unknown as ProviderRateCardRecord) ?? null;
    }

    const matches = Array.from(ctx.memoryStore.provider_rate_cards.values())
      .filter((r) => r.provider === provider && (!modelName || r.model_name === modelName))
      .sort((a, b) => (b.effective_date > a.effective_date ? 1 : -1));
    return matches[0] ?? null;
  }

public listRateCards(provider?: string): ProviderRateCardRecord[] {
    const ctx=this.session();
    if (ctx.db && !ctx.isFallback) {
      let query = "SELECT * FROM provider_rate_cards";
      const params: any[] = [];
      if (provider) {
        query += " WHERE provider = ?";
        params.push(provider);
      }
      query += " ORDER BY provider ASC, effective_date DESC";
      return (ctx.db.prepare(query).all(...params) as unknown as ProviderRateCardRecord[]) ?? [];
    }
    return Array.from(ctx.memoryStore.provider_rate_cards.values()).filter(
      (r) => !provider || r.provider === provider
    );
  }

public atomicReserveProviderGroup(group: ProviderAttemptGroup, jobs: ProviderJobRecord[], cap?: number, forceNew=false,maxReRolls=2): boolean {
    const ctx=this.session();
    return ctx.store.transaction(() => {
      const existing=ctx.store.findGroup(group.seriesId,group.episodeNumber,group.shotId,group.specHash);
      if(existing&&!forceNew){Object.assign(group,existing);return true;}
      if(forceNew&&ctx.store.listGroups().filter(old=>old.seriesId===group.seriesId&&old.episodeNumber===group.episodeNumber&&old.shotId===group.shotId&&old.specHash===group.specHash).length>=maxReRolls+1)throw new WorkflowError("MAX_REROLLS_REACHED", "MAX_REROLLS_REACHED", "failed");
      if (jobs.some(job => this.getProviderJob(job.id))) throw new WorkflowError("ATTEMPT_ALREADY_EXISTS", "ATTEMPT_ALREADY_EXISTS", "failed");
      const summary = this.getSeriesBudgetLedger(group.seriesId);
      const effectiveCap = Math.min(summary.maxBudgetUsd, cap ?? summary.maxBudgetUsd);
      const requested = jobs.reduce((sum, job) => sum + job.estimated_cost_usd, 0);
      if (summary.totalCommittedUsd + requested > effectiveCap) return false;
      for (const job of jobs) this.createOrUpdateProviderJob({ ...job, status: "reserved", cost_category: "reserved", reserved_cost_usd: job.estimated_cost_usd });
      ctx.store.putGroup(group);
      return true;
    });
  }

public recordLlmTokenUsage(
    usage: Omit<LlmTokenUsageRecord, "created_at"> & { created_at?: string }
  ): void {
    const ctx=this.session();
    const counts = [
      usage.input_tokens,
      usage.output_tokens,
      usage.cached_tokens,
      usage.cache_creation_tokens,
    ];
    if (counts.some((count) => !Number.isSafeInteger(count) || count < 0)) {
      throw new RangeError("LLM token usage counts must be non-negative safe integers.");
    }
    if (usage.cached_tokens + usage.cache_creation_tokens > usage.input_tokens) {
      throw new RangeError("Cached and cache-creation tokens cannot exceed total input tokens.");
    }
    if (
      usage.estimated_savings_usd !== null &&
      (!Number.isFinite(usage.estimated_savings_usd) || usage.estimated_savings_usd < 0)
    ) {
      throw new RangeError("Estimated LLM token savings must be a non-negative finite amount or null.");
    }

    const clean: LlmTokenUsageRecord = {
      ...usage,
      provider: usage.provider.trim() || "unknown",
      model: usage.model.trim() || "unknown",
      created_at: usage.created_at || new Date().toISOString(),
    };
    if (ctx.db && !ctx.isFallback) {
      ctx.db.prepare(`
        INSERT INTO llm_token_usage (
          series_id, provider, model, input_tokens, output_tokens,
          cached_tokens, cache_creation_tokens, estimated_savings_usd, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        clean.series_id,
        clean.provider,
        clean.model,
        clean.input_tokens,
        clean.output_tokens,
        clean.cached_tokens,
        clean.cache_creation_tokens,
        clean.estimated_savings_usd,
        clean.created_at
      );
    } else {
      ctx.memoryStore.llm_token_usage.push(clean);
    }
  }

public getLlmTokenUsageSummary(seriesId: string): LlmTokenUsageSummary {
    const ctx=this.session();
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let totalCachedTokens = 0;
    let totalCacheCreationTokens = 0;
    let totalEstimatedSavingsUsd: number | null = null;
    let hasUsage = false;
    let hasUnpricedUsage = false;

    if (ctx.db && !ctx.isFallback) {
      const row = ctx.db.prepare(`
        SELECT COUNT(*) AS usage_count,
               SUM(input_tokens) AS input_tokens,
               SUM(output_tokens) AS output_tokens,
               SUM(cached_tokens) AS cached_tokens,
               SUM(cache_creation_tokens) AS cache_creation_tokens,
               SUM(estimated_savings_usd) AS savings_usd,
               SUM(CASE WHEN estimated_savings_usd IS NULL THEN 1 ELSE 0 END) AS unpriced_count
        FROM llm_token_usage
        WHERE series_id = ?
      `).get(seriesId) as any;
      hasUsage = Number(row?.usage_count || 0) > 0;
      totalInputTokens = Number(row?.input_tokens || 0);
      totalOutputTokens = Number(row?.output_tokens || 0);
      totalCachedTokens = Number(row?.cached_tokens || 0);
      totalCacheCreationTokens = Number(row?.cache_creation_tokens || 0);
      hasUnpricedUsage = Number(row?.unpriced_count || 0) > 0;
      if (hasUsage && !hasUnpricedUsage) totalEstimatedSavingsUsd = Number(row?.savings_usd || 0);
    } else {
      const records = ctx.memoryStore.llm_token_usage.filter((record) => record.series_id === seriesId);
      hasUsage = records.length > 0;
      totalInputTokens = records.reduce((sum, record) => sum + record.input_tokens, 0);
      totalOutputTokens = records.reduce((sum, record) => sum + record.output_tokens, 0);
      totalCachedTokens = records.reduce((sum, record) => sum + record.cached_tokens, 0);
      totalCacheCreationTokens = records.reduce((sum, record) => sum + record.cache_creation_tokens, 0);
      hasUnpricedUsage = records.some((record) => record.estimated_savings_usd === null);
      if (hasUsage && !hasUnpricedUsage) {
        totalEstimatedSavingsUsd = records.reduce((sum, record) => sum + (record.estimated_savings_usd || 0), 0);
      }
    }

    return {
      usageStatus:hasUsage?"available":"unavailable",
      totalInputTokens,
      totalOutputTokens,
      totalCachedTokens,
      totalCacheCreationTokens,
      totalEstimatedSavingsUsd,
      cacheHitRatio: totalInputTokens > 0 ? Number((totalCachedTokens / totalInputTokens).toFixed(4)) : 0,
    };
  }
}
