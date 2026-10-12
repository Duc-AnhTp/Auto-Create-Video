import {log} from '../../../../platform/observability/logger.js';
import { sqlInput } from "../../../../platform/sqlite/values.js";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { type AtomicReserveShotTakeParams,type AtomicReserveShotTakeResult,type ReferenceAssetRecord,type ShotTakeRecord,type StoryboardKeyframeRecord } from "../../../../contracts/story.js";
import type { DatabaseSession } from "../../../../platform/sqlite/session.js";
export interface ReferencesRepositorySession extends DatabaseSession {}
const nodeRequire=createRequire(import.meta.url);

export class ReferencesRepository {
  constructor(private session:()=>ReferencesRepositorySession){}
public recordShotTake(take: ShotTakeRecord): void {
    const ctx=this.session();
    if (ctx.db && !ctx.isFallback) {
      const stmt = ctx.db.prepare(`
        INSERT INTO shot_takes (
          id, series_id, episode_number, shot_id, take_number, provider,
          prompt, seed, local_path, duration_sec, qa_status, qa_score,
          qa_notes, qa_report_json, storyboard_keyframe_id, used_references_json,
          is_approved, cost_usd, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          provider = excluded.provider,
          prompt = excluded.prompt,
          duration_sec = excluded.duration_sec,
          qa_status = excluded.qa_status,
          qa_score = excluded.qa_score,
          qa_notes = excluded.qa_notes,
          qa_report_json = excluded.qa_report_json,
          storyboard_keyframe_id = excluded.storyboard_keyframe_id,
          used_references_json = excluded.used_references_json,
          is_approved = excluded.is_approved,
          local_path = excluded.local_path,
          cost_usd = excluded.cost_usd
      `);
      stmt.run(
        take.id,
        take.series_id,
        take.episode_number,
        take.shot_id,
        take.take_number ?? 1,
        take.provider,
        take.prompt ?? "",
        take.seed ?? null,
        take.local_path ?? null,
        take.duration_sec ?? 0,
        take.qa_status ?? "PASS",
        take.qa_score ?? null,
        take.qa_notes ?? null,
        take.qa_report_json ?? null,
        take.storyboard_keyframe_id ?? null,
        take.used_references_json ?? "[]",
        take.is_approved ? 1 : 0,
        take.cost_usd ?? 0.0,
        take.created_at || new Date().toISOString()
      );
    } else {
      ctx.memoryStore.shot_takes.set(take.id, {
        ...take,
        is_approved: Boolean(take.is_approved),
      });
    }
  }

public upsertShotTake(take: ShotTakeRecord): void {
    const ctx=this.session();
    this.recordShotTake(take);
  }

public atomicReserveShotTake(
    params: AtomicReserveShotTakeParams
  ): AtomicReserveShotTakeResult {
    const ctx=this.session();
    const seriesPrefix = params.seriesId.replace(/[^a-zA-Z0-9_-]/g, "_");
    const epNumStr = String(params.episodeNumber).padStart(2, "0");
    const shotIds = this.getEquivalentShotIds(params.shotId);

    if (ctx.db && !ctx.isFallback) {
      let attempts = 0;
      const maxAttempts = 10;
      while (attempts < maxAttempts) {
        attempts++;
        try {
          ctx.db.exec("BEGIN IMMEDIATE TRANSACTION;");
        } catch (busyErr: any) {
          if (attempts >= maxAttempts) throw busyErr;
          continue;
        }

        let inTransaction = true;
        try {
          const placeholders = shotIds.map(() => "?").join(", ");
          const row = ctx.db
            .prepare(
              `SELECT COALESCE(MAX(take_number), 0) AS max_take FROM shot_takes WHERE series_id = ? AND episode_number = ? AND shot_id IN (${placeholders})`
            )
            .get(params.seriesId, params.episodeNumber, ...shotIds) as { max_take: number } | undefined;

          let takeNumber = Math.max(params.minTakeNumber ?? 1, (row?.max_take ?? 0) + 1);
          let takeNumStr = String(takeNumber).padStart(2, "0");
          let takeId = `${seriesPrefix}_ep${epNumStr}_${params.shotId}_take${takeNumStr}`;
          let localPath = params.localPathBuilder
            ? params.localPathBuilder(takeNumber, takeNumStr)
            : "";

          while (
            (localPath && existsSync(localPath)) ||
            ctx.db.prepare("SELECT id FROM shot_takes WHERE id = ?").get(takeId) ||
            ctx.db
              .prepare(
                `SELECT id FROM shot_takes WHERE series_id = ? AND episode_number = ? AND shot_id IN (${placeholders}) AND take_number = ?`
              )
              .get(params.seriesId, params.episodeNumber, ...shotIds, takeNumber)
          ) {
            takeNumber++;
            takeNumStr = String(takeNumber).padStart(2, "0");
            takeId = `${seriesPrefix}_ep${epNumStr}_${params.shotId}_take${takeNumStr}`;
            localPath = params.localPathBuilder
              ? params.localPathBuilder(takeNumber, takeNumStr)
              : "";
          }

          const stmt = ctx.db.prepare(`
            INSERT INTO shot_takes (
              id, series_id, episode_number, shot_id, take_number, provider,
              prompt, seed, local_path, duration_sec, qa_status, qa_score,
              qa_notes, qa_report_json, storyboard_keyframe_id, used_references_json,
              is_approved, cost_usd, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `);

          const record: ShotTakeRecord = {
            id: takeId,
            series_id: params.seriesId,
            episode_number: params.episodeNumber,
            shot_id: params.shotId,
            take_number: takeNumber,
            provider: params.provider,
            prompt: params.prompt,
            seed: params.seed,
            local_path: localPath,
            duration_sec: params.durationSec ?? 0,
            qa_status: params.qaStatus ?? "NOT_RUN",
            qa_score: undefined,
            qa_notes: undefined,
            qa_report_json: undefined,
            storyboard_keyframe_id: params.storyboardKeyframeId,
            used_references_json: params.usedReferencesJson ?? "[]",
            is_approved: params.isApproved ? 1 : 0,
            cost_usd: params.costUsd ?? 0,
            created_at: new Date().toISOString(),
          };

          stmt.run(
            sqlInput(record.id),
            sqlInput(record.series_id),
            sqlInput(record.episode_number),
            sqlInput(record.shot_id),
            sqlInput(record.take_number),
            sqlInput(record.provider),
            sqlInput(record.prompt),
            sqlInput(record.seed ?? null),
            sqlInput(record.local_path),
            sqlInput(record.duration_sec),
            sqlInput(record.qa_status),
            sqlInput(record.qa_score ?? null),
            sqlInput(record.qa_notes ?? null),
            sqlInput(record.qa_report_json ?? null),
            sqlInput(record.storyboard_keyframe_id ?? null),
            sqlInput(record.used_references_json ?? "[]"),
            sqlInput(record.is_approved ? 1 : 0),
            sqlInput(record.cost_usd ?? 0),
            sqlInput(record.created_at)
          );

          ctx.db.exec("COMMIT;");
          inTransaction = false;

          return {
            takeNumber,
            takeNumStr,
            takeId,
            localPath,
            record: {
              ...record,
              is_approved: Boolean(record.is_approved),
            },
          };
        } catch (err: any) {
          if (inTransaction) {
            try {
              ctx.db.exec("ROLLBACK;");
            } catch (caughtError) { log.warn("[references-repository] "+String(caughtError)); }
          }
          if (
            err.message?.includes("UNIQUE") ||
            err.message?.includes("busy") ||
            err.code === "SQLITE_BUSY"
          ) {
            continue;
          }
          throw err;
        }
      }
      throw new Error(`Failed to atomically reserve shot take after ${maxAttempts} attempts due to concurrency contention.`);
    }

    // In-memory fallback
    const existingTakes = Array.from(ctx.memoryStore.shot_takes.values()).filter(
      (t) =>
        t.series_id === params.seriesId &&
        t.episode_number === params.episodeNumber &&
        shotIds.includes(t.shot_id)
    );
    const maxTake = existingTakes.reduce((acc, t) => Math.max(acc, t.take_number ?? 0), 0);
    let takeNumber = Math.max(params.minTakeNumber ?? 1, maxTake + 1);
    let takeNumStr = String(takeNumber).padStart(2, "0");
    let takeId = `${seriesPrefix}_ep${epNumStr}_${params.shotId}_take${takeNumStr}`;
    let localPath = params.localPathBuilder
      ? params.localPathBuilder(takeNumber, takeNumStr)
      : "";

    while (ctx.memoryStore.shot_takes.has(takeId) || (localPath && existsSync(localPath))) {
      takeNumber++;
      takeNumStr = String(takeNumber).padStart(2, "0");
      takeId = `${seriesPrefix}_ep${epNumStr}_${params.shotId}_take${takeNumStr}`;
      localPath = params.localPathBuilder
        ? params.localPathBuilder(takeNumber, takeNumStr)
        : "";
    }

    const record: ShotTakeRecord = {
      id: takeId,
      series_id: params.seriesId,
      episode_number: params.episodeNumber,
      shot_id: params.shotId,
      take_number: takeNumber,
      provider: params.provider,
      prompt: params.prompt,
      seed: params.seed,
      local_path: localPath,
      duration_sec: params.durationSec ?? 0,
      qa_status: params.qaStatus ?? "NOT_RUN",
      qa_score: undefined,
      qa_notes: undefined,
      qa_report_json: undefined,
      storyboard_keyframe_id: params.storyboardKeyframeId,
      used_references_json: params.usedReferencesJson ?? "[]",
      is_approved: Boolean(params.isApproved),
      cost_usd: params.costUsd ?? 0,
      created_at: new Date().toISOString(),
    };

    ctx.memoryStore.shot_takes.set(takeId, record);

    return {
      takeNumber,
      takeNumStr,
      takeId,
      localPath,
      record,
    };
  }

public getShotTake(takeId: string): ShotTakeRecord | null {
    const ctx=this.session();
    if (ctx.db && !ctx.isFallback) {
      const row = ctx.db.prepare("SELECT * FROM shot_takes WHERE id = ?").get(takeId);
      if (!row) return null;
      return {
        ...row,
        is_approved: Boolean(row.is_approved),
      } as ShotTakeRecord;
    }
    return ctx.memoryStore.shot_takes.get(takeId) ?? null;
  }

public getEquivalentShotIds(shotId: string): string[] {
    const ctx=this.session();
    const set = new Set<string>([shotId]);
    const m = shotId.match(/^sc(\d+)_sh(\d+)$/i);
    if (m) {
      const sc = parseInt(m[1], 10);
      const sh = parseInt(m[2], 10);
      const scPad = String(sc).padStart(2, "0");
      const shPad = String(sh).padStart(2, "0");
      set.add(`sc${sc}_sh${sh}`);
      set.add(`sc${scPad}_sh${shPad}`);
      set.add(`sc${scPad}_sh${sh}`);
      set.add(`sc${sc}_sh${shPad}`);
    }
    return Array.from(set);
  }

public listShotTakes(seriesId: string, episodeNumber: number, shotId?: string): ShotTakeRecord[] {
    const ctx=this.session();
    if (ctx.db && !ctx.isFallback) {
      let rows: any[];
      if (shotId) {
        const shotIds = this.getEquivalentShotIds(shotId);
        const placeholders = shotIds.map(() => "?").join(", ");
        const stmt = ctx.db.prepare(
          `SELECT * FROM shot_takes WHERE series_id = ? AND episode_number = ? AND shot_id IN (${placeholders}) ORDER BY take_number ASC`
        );
        rows = stmt.all(seriesId, episodeNumber, ...shotIds);
      } else {
        const stmt = ctx.db.prepare(
          "SELECT * FROM shot_takes WHERE series_id = ? AND episode_number = ? ORDER BY shot_id ASC, take_number ASC"
        );
        rows = stmt.all(seriesId, episodeNumber);
      }
      return rows.map((r: any) => ({
        ...r,
        is_approved: Boolean(r.is_approved),
      }));
    }
    const shotIds = shotId ? this.getEquivalentShotIds(shotId) : [];
    return Array.from(ctx.memoryStore.shot_takes.values()).filter(
      (t) =>
        t.series_id === seriesId &&
        t.episode_number === episodeNumber &&
        (!shotId || shotIds.includes(t.shot_id))
    );
  }

public updateShotTakeQa(
    takeId: string,
    qa: {
      qa_status: "PASS" | "WARN" | "FAIL" | "NOT_RUN" | "UNAVAILABLE";
      qa_score?: number;
      qa_notes?: string;
      qa_report_json?: string;
    }
  ): void {
    const ctx=this.session();
    if (ctx.db && !ctx.isFallback) {
      ctx.db
        .prepare(
          "UPDATE shot_takes SET qa_status = ?, qa_score = ?, qa_notes = ?, qa_report_json = COALESCE(?, qa_report_json) WHERE id = ?"
        )
        .run(qa.qa_status, qa.qa_score ?? null, qa.qa_notes ?? null, qa.qa_report_json ?? null, takeId);
    } else {
      const take = ctx.memoryStore.shot_takes.get(takeId);
      if (take) {
        take.qa_status = qa.qa_status;
        take.qa_score = qa.qa_score;
        take.qa_notes = qa.qa_notes;
        if (qa.qa_report_json !== undefined) {
          take.qa_report_json = qa.qa_report_json;
        }
      }
    }
  }

public approveShotTake(takeId: string): void {
    const ctx=this.session();
    const take = this.getShotTake(takeId);
    if (!take) return;

    const shotIds = this.getEquivalentShotIds(take.shot_id);
    if (ctx.db && !ctx.isFallback) {
      const placeholders = shotIds.map(() => "?").join(", ");
      ctx.db.prepare(
        `UPDATE shot_takes SET is_approved = 0 WHERE series_id = ? AND episode_number = ? AND shot_id IN (${placeholders})`
      ).run(take.series_id, take.episode_number, ...shotIds);

      ctx.db.prepare("UPDATE shot_takes SET is_approved = 1 WHERE id = ?").run(takeId);
    } else {
      for (const t of ctx.memoryStore.shot_takes.values()) {
        if (
          t.series_id === take.series_id &&
          t.episode_number === take.episode_number &&
          shotIds.includes(t.shot_id)
        ) {
          t.is_approved = false;
        }
      }
      const target = ctx.memoryStore.shot_takes.get(takeId);
      if (target) target.is_approved = true;
    }
  }

public selectShotTake(takeId: string): void {
    const ctx=this.session();
    this.approveShotTake(takeId);
  }

public rejectShotTake(takeId: string, rejectionReason?: string): void {
    const ctx=this.session();
    const take = this.getShotTake(takeId);
    if (!take) return;

    const updatedNotes = rejectionReason
      ? `${take.qa_notes || ""}\n[REJECTED] ${rejectionReason}`.trim()
      : take.qa_notes;

    if (ctx.db && !ctx.isFallback) {
      ctx.db.prepare(
        "UPDATE shot_takes SET is_approved = 0, qa_notes = ? WHERE id = ?"
      ).run(updatedNotes ?? null, takeId);
    } else {
      const target = ctx.memoryStore.shot_takes.get(takeId);
      if (target) {
        target.is_approved = false;
        target.qa_notes = updatedNotes;
      }
    }
  }

public getApprovedTakeForShot(
    seriesId: string,
    episodeNumber: number,
    shotId: string
  ): ShotTakeRecord | null {
    const ctx=this.session();
    const shotIds = this.getEquivalentShotIds(shotId);
    if (ctx.db && !ctx.isFallback) {
      const placeholders = shotIds.map(() => "?").join(", ");
      const row = ctx.db.prepare(
        `SELECT * FROM shot_takes WHERE series_id = ? AND episode_number = ? AND shot_id IN (${placeholders}) AND is_approved = 1 LIMIT 1`
      ).get(seriesId, episodeNumber, ...shotIds);
      if (!row) return null;
      return {
        ...row,
        is_approved: true,
      } as ShotTakeRecord;
    }
    const match = Array.from(ctx.memoryStore.shot_takes.values()).find(
      (t) =>
        t.series_id === seriesId &&
        t.episode_number === episodeNumber &&
        shotIds.includes(t.shot_id) &&
        Boolean(t.is_approved)
    );
    return match ?? null;
  }

public getNextTakeNumber(
    seriesId: string,
    episodeNumber: number,
    shotId: string
  ): number {
    const ctx=this.session();
    const shotIds = this.getEquivalentShotIds(shotId);
    if (ctx.db && !ctx.isFallback) {
      const placeholders = shotIds.map(() => "?").join(", ");
      const row = ctx.db
        .prepare(
          `SELECT COALESCE(MAX(take_number), 0) AS max_take FROM shot_takes WHERE series_id = ? AND episode_number = ? AND shot_id IN (${placeholders})`
        )
        .get(seriesId, episodeNumber, ...shotIds) as { max_take: number } | undefined;
      return (row?.max_take ?? 0) + 1;
    }
    const takes = Array.from(ctx.memoryStore.shot_takes.values()).filter(
      (t) =>
        t.series_id === seriesId &&
        t.episode_number === episodeNumber &&
        shotIds.includes(t.shot_id)
    );
    const maxTake = takes.reduce((acc, t) => Math.max(acc, t.take_number ?? 0), 0);
    return maxTake + 1;
  }

public getSeriesCostAndTakesSummary(seriesId: string): {
    totalTakes: number;
    approvedTakes: number;
    totalCostUsd: number;
    episodes: Array<{
      episodeNumber: number;
      takeCount: number;
      approvedCount: number;
      costUsd: number;
    }>;
  } {
    const ctx=this.session();
    let allTakes: any[] = [];
    if (ctx.db && !ctx.isFallback) {
      allTakes = ctx.db.prepare("SELECT * FROM shot_takes WHERE series_id = ?").all(seriesId) as any[];
    } else {
      allTakes = Array.from(ctx.memoryStore.shot_takes.values()).filter((t) => t.series_id === seriesId);
    }

    const episodesMap = new Map<number, { takeCount: number; approvedCount: number; costUsd: number }>();
    let totalCostUsd = 0;
    let approvedTakes = 0;

    for (const t of allTakes) {
      const ep = t.episode_number;
      if (!episodesMap.has(ep)) {
        episodesMap.set(ep, { takeCount: 0, approvedCount: 0, costUsd: 0 });
      }
      const epStat = episodesMap.get(ep)!;
      epStat.takeCount++;
      if (t.is_approved) {
        epStat.approvedCount++;
        approvedTakes++;
      }
      const cost = Number(t.cost_usd || 0);
      epStat.costUsd += cost;
      totalCostUsd += cost;
    }

    const episodes = Array.from(episodesMap.entries())
      .map(([episodeNumber, stat]) => ({
        episodeNumber,
        takeCount: stat.takeCount,
        approvedCount: stat.approvedCount,
        costUsd: Number(stat.costUsd.toFixed(4)),
      }))
      .sort((a, b) => a.episodeNumber - b.episodeNumber);

    return {
      totalTakes: allTakes.length,
      approvedTakes,
      totalCostUsd: Number(totalCostUsd.toFixed(4)),
      episodes,
    };
  }

public addReferenceAsset(asset: ReferenceAssetRecord): void {
    const ctx=this.session();
    if (ctx.db && !ctx.isFallback) {
      const stmt = ctx.db.prepare(`
        INSERT INTO reference_assets (
          id, series_id, entity_type, entity_id, asset_kind,
          image_path, version, is_active, description, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          image_path = excluded.image_path,
          version = excluded.version,
          is_active = excluded.is_active,
          description = excluded.description
      `);
      stmt.run(
        asset.id,
        asset.series_id,
        asset.entity_type,
        asset.entity_id,
        asset.asset_kind,
        asset.image_path,
        asset.version ?? 1,
        asset.is_active ? 1 : 0,
        asset.description ?? null,
        asset.created_at || new Date().toISOString()
      );
    } else {
      ctx.memoryStore.reference_assets.set(asset.id, {
        ...asset,
        is_active: Boolean(asset.is_active),
      });
    }
  }

public getReferenceAsset(assetId: string): ReferenceAssetRecord | null {
    const ctx=this.session();
    if (ctx.db && !ctx.isFallback) {
      const row = ctx.db.prepare("SELECT * FROM reference_assets WHERE id = ?").get(assetId);
      if (!row) return null;
      return {
        ...row,
        is_active: Boolean(row.is_active),
      } as ReferenceAssetRecord;
    }
    return ctx.memoryStore.reference_assets.get(assetId) ?? null;
  }

public listReferenceAssets(
    seriesId: string,
    entityType?: string,
    entityId?: string,
    activeOnly: boolean = true
  ): ReferenceAssetRecord[] {
    const ctx=this.session();
    if (ctx.db && !ctx.isFallback) {
      let query = "SELECT * FROM reference_assets WHERE series_id = ?";
      const params: any[] = [seriesId];
      if (entityType) {
        query += " AND entity_type = ?";
        params.push(entityType);
      }
      if (entityId) {
        query += " AND entity_id = ?";
        params.push(entityId);
      }
      if (activeOnly) {
        query += " AND is_active = 1";
      }
      query += " ORDER BY entity_type ASC, entity_id ASC, version DESC";
      const rows = ctx.db.prepare(query).all(...params) as any[];
      return rows.map((r) => ({
        ...r,
        is_active: Boolean(r.is_active),
      }));
    }
    return Array.from(ctx.memoryStore.reference_assets.values()).filter(
      (a) =>
        a.series_id === seriesId &&
        (!entityType || a.entity_type === entityType) &&
        (!entityId || a.entity_id === entityId) &&
        (!activeOnly || Boolean(a.is_active))
    );
  }

public deprecateReferenceAsset(assetId: string): void {
    const ctx=this.session();
    if (ctx.db && !ctx.isFallback) {
      ctx.db.prepare("UPDATE reference_assets SET is_active = 0 WHERE id = ?").run(assetId);
    } else {
      const a = ctx.memoryStore.reference_assets.get(assetId);
      if (a) a.is_active = false;
    }
  }

public recordStoryboardKeyframe(keyframe: StoryboardKeyframeRecord): void {
    const ctx=this.session();
    if (ctx.db && !ctx.isFallback) {
      const stmt = ctx.db.prepare(`
        INSERT INTO storyboard_keyframes (
          id, series_id, episode_number, shot_id, version,
          composition_layout, camera_framing, image_path,
          is_approved, used_references_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          composition_layout = excluded.composition_layout,
          camera_framing = excluded.camera_framing,
          image_path = excluded.image_path,
          is_approved = excluded.is_approved,
          used_references_json = excluded.used_references_json
      `);
      stmt.run(
        keyframe.id,
        keyframe.series_id,
        keyframe.episode_number,
        keyframe.shot_id,
        keyframe.version ?? 1,
        keyframe.composition_layout,
        keyframe.camera_framing,
        keyframe.image_path,
        keyframe.is_approved ? 1 : 0,
        keyframe.used_references_json ?? "[]",
        keyframe.created_at || new Date().toISOString()
      );
    } else {
      ctx.memoryStore.storyboard_keyframes.set(keyframe.id, {
        ...keyframe,
        is_approved: Boolean(keyframe.is_approved),
      });
    }
  }

public getStoryboardKeyframe(keyframeId: string): StoryboardKeyframeRecord | null {
    const ctx=this.session();
    if (ctx.db && !ctx.isFallback) {
      const row = ctx.db.prepare("SELECT * FROM storyboard_keyframes WHERE id = ?").get(keyframeId);
      if (!row) return null;
      return {
        ...row,
        is_approved: Boolean(row.is_approved),
      } as StoryboardKeyframeRecord;
    }
    return ctx.memoryStore.storyboard_keyframes.get(keyframeId) ?? null;
  }

public listStoryboardKeyframes(
    seriesId: string,
    episodeNumber: number,
    shotId?: string
  ): StoryboardKeyframeRecord[] {
    const ctx=this.session();
    if (ctx.db && !ctx.isFallback) {
      let query = "SELECT * FROM storyboard_keyframes WHERE series_id = ? AND episode_number = ?";
      const params: any[] = [seriesId, episodeNumber];
      if (shotId) {
        query += " AND shot_id = ?";
        params.push(shotId);
      }
      query += " ORDER BY shot_id ASC, version DESC";
      const rows = ctx.db.prepare(query).all(...params) as any[];
      return rows.map((r) => ({
        ...r,
        is_approved: Boolean(r.is_approved),
      }));
    }
    return Array.from(ctx.memoryStore.storyboard_keyframes.values()).filter(
      (sb) =>
        sb.series_id === seriesId &&
        sb.episode_number === episodeNumber &&
        (!shotId || sb.shot_id === shotId)
    );
  }

public getApprovedStoryboardForShot(
    seriesId: string,
    episodeNumber: number,
    shotId: string
  ): StoryboardKeyframeRecord | null {
    const ctx=this.session();
    if (ctx.db && !ctx.isFallback) {
      const row = ctx.db.prepare(
        "SELECT * FROM storyboard_keyframes WHERE series_id = ? AND episode_number = ? AND shot_id = ? AND is_approved = 1"
      ).get(seriesId, episodeNumber, shotId);
      if (!row) return null;
      return {
        ...row,
        is_approved: true,
      } as StoryboardKeyframeRecord;
    }
    const match = Array.from(ctx.memoryStore.storyboard_keyframes.values()).find(
      (sb) =>
        sb.series_id === seriesId &&
        sb.episode_number === episodeNumber &&
        sb.shot_id === shotId &&
        Boolean(sb.is_approved)
    );
    return match ?? null;
  }

public approveStoryboardKeyframe(keyframeId: string, isApproved: boolean = true): void {
    const ctx=this.session();
    const keyframe = this.getStoryboardKeyframe(keyframeId);
    if (!keyframe) return;

    if (ctx.db && !ctx.isFallback) {
      if (isApproved) {
        ctx.db.prepare(
          "UPDATE storyboard_keyframes SET is_approved = 0 WHERE series_id = ? AND episode_number = ? AND shot_id = ?"
        ).run(keyframe.series_id, keyframe.episode_number, keyframe.shot_id);
      }
      ctx.db.prepare("UPDATE storyboard_keyframes SET is_approved = ? WHERE id = ?").run(
        isApproved ? 1 : 0,
        keyframeId
      );
    } else {
      if (isApproved) {
        for (const sb of ctx.memoryStore.storyboard_keyframes.values()) {
          if (
            sb.series_id === keyframe.series_id &&
            sb.episode_number === keyframe.episode_number &&
            sb.shot_id === keyframe.shot_id
          ) {
            sb.is_approved = false;
          }
        }
      }
      const target = ctx.memoryStore.storyboard_keyframes.get(keyframeId);
      if (target) target.is_approved = isApproved;
    }
  }
}
