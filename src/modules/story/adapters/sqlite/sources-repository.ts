import {log} from '../../../../platform/observability/logger.js';
import { sqlInput } from "../../../../platform/sqlite/values.js";
import { createRequire } from "node:module";
import { type AnalysisReviewItemRecord,type ChekhovGunRecord,type CoverageLedgerRecord,type KnowledgeStateRecord,type PlannedEpisodeRecord,type SeriesPlanRecord,type SourceBlockRecord,type SourceRevisionRecord,type SourceUnitRecord,type SourceWorkRecord,type StoryBeatRecord,type StoryThreadRecord } from "../../../../contracts/story.js";
import type { DatabaseSession } from "../../../../platform/sqlite/session.js";
export interface SourcesRepositorySession extends DatabaseSession {}
const nodeRequire=createRequire(import.meta.url);

export class SourcesRepository {
  constructor(private session:()=>SourcesRepositorySession){}
public upsertSourceWork(work: SourceWorkRecord): void {
    const ctx=this.session();
    const now = new Date().toISOString();
    const clean: SourceWorkRecord = {
      ...work,
      author: work.author ?? null,
      normalization_rules_json: work.normalization_rules_json ?? "{}",
      metadata_json: work.metadata_json ?? "{}",
      created_at: work.created_at || now,
      updated_at: now,
    };

    if (ctx.db && !ctx.isFallback) {
      ctx.db
        .prepare(`
          INSERT INTO source_works (
            id, series_id, title, author, source_type, current_revision,
            content_hash, raw_text, normalized_text, normalization_rules_json,
            metadata_json, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            title = excluded.title,
            author = excluded.author,
            source_type = excluded.source_type,
            current_revision = excluded.current_revision,
            content_hash = excluded.content_hash,
            raw_text = excluded.raw_text,
            normalized_text = excluded.normalized_text,
            normalization_rules_json = excluded.normalization_rules_json,
            metadata_json = excluded.metadata_json,
            updated_at = excluded.updated_at
        `)
        .run(
          sqlInput(clean.id),
          sqlInput(clean.series_id),
          sqlInput(clean.title),
          sqlInput(clean.author),
          sqlInput(clean.source_type),
          sqlInput(clean.current_revision),
          sqlInput(clean.content_hash),
          sqlInput(clean.raw_text),
          sqlInput(clean.normalized_text),
          sqlInput(clean.normalization_rules_json),
          sqlInput(clean.metadata_json),
          sqlInput(clean.created_at),
          sqlInput(clean.updated_at)
        );
    } else {
      ctx.memoryStore.source_works.set(clean.id, clean);
    }
  }

public getSourceWork(id: string): SourceWorkRecord | null {
    const ctx=this.session();
    if (ctx.db && !ctx.isFallback) {
      const row = ctx.db.prepare("SELECT * FROM source_works WHERE id = ?").get(id);
      return (row as unknown as SourceWorkRecord) ?? null;
    }
    return ctx.memoryStore.source_works.get(id) ?? null;
  }

public listSourceWorks(seriesId?: string): SourceWorkRecord[] {
    const ctx=this.session();
    if (ctx.db && !ctx.isFallback) {
      let query = "SELECT * FROM source_works";
      const params: any[] = [];
      if (seriesId) {
        query += " WHERE series_id = ?";
        params.push(seriesId);
      }
      query += " ORDER BY updated_at DESC";
      return (ctx.db.prepare(query).all(...params) as unknown as SourceWorkRecord[]) ?? [];
    }
    return Array.from(ctx.memoryStore.source_works.values()).filter(
      (w) => !seriesId || w.series_id === seriesId
    );
  }

public deleteSourceWork(id: string): void {
    const ctx=this.session();
    if (ctx.db && !ctx.isFallback) {
      ctx.db.prepare("DELETE FROM source_works WHERE id = ?").run(id);
    } else {
      ctx.memoryStore.source_works.delete(id);
    }
  }

public recordSourceRevision(rev: SourceRevisionRecord): void {
    const ctx=this.session();
    const now = rev.created_at || new Date().toISOString();
    const clean: SourceRevisionRecord = {
      ...rev,
      normalization_rules_json: rev.normalization_rules_json ?? "{}",
      metadata_json: rev.metadata_json ?? "{}",
      created_at: now,
    };

    if (ctx.db && !ctx.isFallback) {
      const existing = ctx.db
        .prepare("SELECT * FROM source_revisions WHERE source_id = ? AND revision = ?")
        .get(clean.source_id, clean.revision) as SourceRevisionRecord | undefined;

      if (existing) {
        if (existing.content_hash !== clean.content_hash) {
          throw new Error(
            `[IMMUTABLE REVISION ERROR] Revision ${clean.revision} of source '${clean.source_id}' already exists with different content_hash (${existing.content_hash} vs ${clean.content_hash}). Revisions are immutable.`
          );
        }
        return; // Idempotent no-op
      }

      ctx.db
        .prepare(`
          INSERT INTO source_revisions (
            id, source_id, series_id, revision, content_hash,
            raw_text, normalized_text, normalization_rules_json,
            metadata_json, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `)
        .run(
          sqlInput(clean.id),
          sqlInput(clean.source_id),
          sqlInput(clean.series_id),
          sqlInput(clean.revision),
          sqlInput(clean.content_hash),
          sqlInput(clean.raw_text),
          sqlInput(clean.normalized_text),
          sqlInput(clean.normalization_rules_json),
          sqlInput(clean.metadata_json),
          sqlInput(clean.created_at)
        );
    } else {
      const existing = Array.from(ctx.memoryStore.source_revisions.values()).find(
        (r) => r.source_id === clean.source_id && r.revision === clean.revision
      );
      if (existing) {
        if (existing.content_hash !== clean.content_hash) {
          throw new Error(
            `[IMMUTABLE REVISION ERROR] Revision ${clean.revision} of source '${clean.source_id}' already exists with different content_hash (${existing.content_hash} vs ${clean.content_hash}). Revisions are immutable.`
          );
        }
        return; // Idempotent no-op
      }
      ctx.memoryStore.source_revisions.set(clean.id, clean);
    }
  }

public recordSourceWorkWithRevision(
    work: SourceWorkRecord,
    rev: SourceRevisionRecord,
    expectedPreviousRevision?: number
  ): void {
    const ctx=this.session();
    if (ctx.db && !ctx.isFallback) {
      ctx.db.exec("BEGIN IMMEDIATE;");
      try {
        const existingWork = ctx.db
          .prepare("SELECT current_revision FROM source_works WHERE id = ?")
          .get(work.id) as { current_revision: number } | undefined;

        if (expectedPreviousRevision !== undefined) {
          if (!existingWork) {
            if (expectedPreviousRevision !== 0) {
              throw new Error(
                `[CAS CONFLICT ERROR] Source work '${work.id}' expected revision ${expectedPreviousRevision}, but source work does not exist.`
              );
            }
          } else if (existingWork.current_revision !== expectedPreviousRevision) {
            throw new Error(
              `[CAS CONFLICT ERROR] Source work '${work.id}' expected revision ${expectedPreviousRevision}, but found revision ${existingWork.current_revision}.`
            );
          }
        }

        this.upsertSourceWork(work);
        this.recordSourceRevision(rev);
        ctx.db.exec("COMMIT;");
      } catch (err) {
        try {
          ctx.db.exec("ROLLBACK;");
        } catch (caughtError) { log.warn("[sources-repository] "+String(caughtError)); }
        throw err;
      }
    } else {
      const existingWork = ctx.memoryStore.source_works.get(work.id);
      if (expectedPreviousRevision !== undefined) {
        if (!existingWork) {
          if (expectedPreviousRevision !== 0) {
            throw new Error(
              `[CAS CONFLICT ERROR] Source work '${work.id}' expected revision ${expectedPreviousRevision}, but source work does not exist.`
            );
          }
        } else if (existingWork.current_revision !== expectedPreviousRevision) {
          throw new Error(
            `[CAS CONFLICT ERROR] Source work '${work.id}' expected revision ${expectedPreviousRevision}, but found revision ${existingWork.current_revision}.`
          );
        }
      }
      this.upsertSourceWork(work);
      this.recordSourceRevision(rev);
    }
  }

public getSourceRevision(sourceId: string, revision: number): SourceRevisionRecord | null {
    const ctx=this.session();
    if (ctx.db && !ctx.isFallback) {
      const row = ctx.db
        .prepare("SELECT * FROM source_revisions WHERE source_id = ? AND revision = ?")
        .get(sourceId, revision);
      return (row as unknown as SourceRevisionRecord) ?? null;
    }
    const found = Array.from(ctx.memoryStore.source_revisions.values()).find(
      (r) => r.source_id === sourceId && r.revision === revision
    );
    return found ?? null;
  }

public listSourceRevisions(sourceId: string): SourceRevisionRecord[] {
    const ctx=this.session();
    if (ctx.db && !ctx.isFallback) {
      const rows = ctx.db
        .prepare("SELECT * FROM source_revisions WHERE source_id = ? ORDER BY revision ASC")
        .all(sourceId);
      return (rows as unknown as SourceRevisionRecord[]) ?? [];
    }
    return Array.from(ctx.memoryStore.source_revisions.values())
      .filter((r) => r.source_id === sourceId)
      .sort((a, b) => a.revision - b.revision);
  }

public upsertSourceUnit(unit: SourceUnitRecord): void {
    const ctx=this.session();
    const now = unit.created_at || new Date().toISOString();
    const clean: SourceUnitRecord = {
      ...unit,
      summary: unit.summary ?? null,
      token_count_estimate: unit.token_count_estimate ?? 0,
      created_at: now,
    };

    if (ctx.db && !ctx.isFallback) {
      ctx.db
        .prepare(`
          INSERT INTO source_units (
            id, source_id, series_id, revision, unit_type, unit_number,
            title, order_index, char_start, char_end, raw_text,
            summary, token_count_estimate, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            revision = excluded.revision,
            unit_type = excluded.unit_type,
            unit_number = excluded.unit_number,
            title = excluded.title,
            order_index = excluded.order_index,
            char_start = excluded.char_start,
            char_end = excluded.char_end,
            raw_text = excluded.raw_text,
            summary = excluded.summary,
            token_count_estimate = excluded.token_count_estimate
        `)
        .run(
          sqlInput(clean.id),
          sqlInput(clean.source_id),
          sqlInput(clean.series_id),
          sqlInput(clean.revision),
          sqlInput(clean.unit_type),
          sqlInput(clean.unit_number),
          sqlInput(clean.title),
          sqlInput(clean.order_index),
          sqlInput(clean.char_start),
          sqlInput(clean.char_end),
          sqlInput(clean.raw_text),
          sqlInput(clean.summary),
          sqlInput(clean.token_count_estimate),
          sqlInput(clean.created_at)
        );
    } else {
      ctx.memoryStore.source_units.set(clean.id, clean);
    }
  }

public getSourceUnit(id: string): SourceUnitRecord | null {
    const ctx=this.session();
    if (ctx.db && !ctx.isFallback) {
      const row = ctx.db.prepare("SELECT * FROM source_units WHERE id = ?").get(id);
      return (row as unknown as SourceUnitRecord) ?? null;
    }
    return ctx.memoryStore.source_units.get(id) ?? null;
  }

public listSourceUnits(sourceId: string, revision?: number): SourceUnitRecord[] {
    const ctx=this.session();
    if (ctx.db && !ctx.isFallback) {
      let query = "SELECT * FROM source_units WHERE source_id = ?";
      const params: any[] = [sourceId];
      if (revision !== undefined) {
        query += " AND revision = ?";
        params.push(revision);
      }
      query += " ORDER BY order_index ASC";
      return (ctx.db.prepare(query).all(...params) as unknown as SourceUnitRecord[]) ?? [];
    }
    return Array.from(ctx.memoryStore.source_units.values())
      .filter((u) => u.source_id === sourceId && (revision === undefined || u.revision === revision))
      .sort((a, b) => a.order_index - b.order_index);
  }

public batchUpsertSourceUnits(units: SourceUnitRecord[]): void {
    const ctx=this.session();
    if (ctx.db && !ctx.isFallback) {
      ctx.db.exec("BEGIN TRANSACTION;");
      try {
        for (const u of units) {
          this.upsertSourceUnit(u);
        }
        ctx.db.exec("COMMIT;");
      } catch (err) {
        ctx.db.exec("ROLLBACK;");
        throw err;
      }
    } else {
      for (const u of units) {
        this.upsertSourceUnit(u);
      }
    }
  }

public upsertSourceBlock(block: SourceBlockRecord): void {
    const ctx=this.session();
    const now = block.created_at || new Date().toISOString();
    const clean: SourceBlockRecord = {
      ...block,
      is_dialogue: block.is_dialogue ? 1 : 0,
      speaker_candidate: block.speaker_candidate ?? null,
      chunk_group_id: block.chunk_group_id ?? null,
      created_at: now,
    };

    if (ctx.db && !ctx.isFallback) {
      ctx.db
        .prepare(`
          INSERT INTO source_blocks (
            id, source_id, unit_id, series_id, revision, block_index,
            char_start, char_end, content, is_dialogue,
            speaker_candidate, chunk_group_id, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            revision = excluded.revision,
            char_start = excluded.char_start,
            char_end = excluded.char_end,
            content = excluded.content,
            is_dialogue = excluded.is_dialogue,
            speaker_candidate = excluded.speaker_candidate,
            chunk_group_id = excluded.chunk_group_id
        `)
        .run(
          sqlInput(clean.id),
          sqlInput(clean.source_id),
          sqlInput(clean.unit_id),
          sqlInput(clean.series_id),
          sqlInput(clean.revision),
          sqlInput(clean.block_index),
          sqlInput(clean.char_start),
          sqlInput(clean.char_end),
          sqlInput(clean.content),
          sqlInput(clean.is_dialogue ? 1 : 0),
          sqlInput(clean.speaker_candidate),
          sqlInput(clean.chunk_group_id),
          sqlInput(clean.created_at)
        );
    } else {
      ctx.memoryStore.source_blocks.set(clean.id, clean);
    }
  }

public listSourceBlocks(unitId: string): SourceBlockRecord[] {
    const ctx=this.session();
    if (ctx.db && !ctx.isFallback) {
      return (
        (ctx.db
          .prepare("SELECT * FROM source_blocks WHERE unit_id = ? ORDER BY block_index ASC")
          .all(unitId) as unknown as SourceBlockRecord[]) ?? []
      );
    }
    return Array.from(ctx.memoryStore.source_blocks.values())
      .filter((b) => b.unit_id === unitId)
      .sort((a, b) => a.block_index - b.block_index);
  }

public batchUpsertSourceBlocks(blocks: SourceBlockRecord[]): void {
    const ctx=this.session();
    if (ctx.db && !ctx.isFallback) {
      ctx.db.exec("BEGIN TRANSACTION;");
      try {
        for (const b of blocks) {
          this.upsertSourceBlock(b);
        }
        ctx.db.exec("COMMIT;");
      } catch (err) {
        ctx.db.exec("ROLLBACK;");
        throw err;
      }
    } else {
      for (const b of blocks) {
        this.upsertSourceBlock(b);
      }
    }
  }

public recordStoryBeat(beat: StoryBeatRecord): StoryBeatRecord {
    const ctx=this.session();
    this.upsertStoryBeat(beat);
    return beat;
  }

public upsertStoryBeat(beat: StoryBeatRecord): void {
    const ctx=this.session();
    const now = beat.created_at || new Date().toISOString();
    const clean: StoryBeatRecord = {
      ...beat,
      source_unit_id: beat.source_unit_id ?? null,
      participating_characters_json: beat.participating_characters_json || "[]",
      location_id: beat.location_id ?? null,
      story_time: beat.story_time ?? null,
      is_flashback: beat.is_flashback ? 1 : 0,
      preconditions_json: beat.preconditions_json ?? "{}",
      post_state_changes_json: beat.post_state_changes_json ?? "{}",
      source_citations_json: beat.source_citations_json ?? "[]",
      source_span_start: beat.source_span_start ?? null,
      source_span_end: beat.source_span_end ?? null,
      is_mandatory: beat.is_mandatory ? 1 : 0,
      created_at: now,
    };

    if (ctx.db && !ctx.isFallback) {
      ctx.db
        .prepare(`
          INSERT INTO story_beats (
            id, source_id, source_unit_id, series_id, beat_order,
            name, description, participating_characters_json, location_id,
            story_time, is_flashback, preconditions_json, post_state_changes_json,
            source_citations_json, source_span_start, source_span_end, is_mandatory, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            beat_order = excluded.beat_order,
            name = excluded.name,
            description = excluded.description,
            participating_characters_json = excluded.participating_characters_json,
            location_id = excluded.location_id,
            story_time = excluded.story_time,
            is_flashback = excluded.is_flashback,
            preconditions_json = excluded.preconditions_json,
            post_state_changes_json = excluded.post_state_changes_json,
            source_citations_json = excluded.source_citations_json,
            source_span_start = excluded.source_span_start,
            source_span_end = excluded.source_span_end,
            is_mandatory = excluded.is_mandatory
        `)
        .run(
          sqlInput(clean.id),
          sqlInput(clean.source_id),
          sqlInput(clean.source_unit_id),
          sqlInput(clean.series_id),
          sqlInput(clean.beat_order),
          sqlInput(clean.name),
          sqlInput(clean.description),
          sqlInput(clean.participating_characters_json),
          sqlInput(clean.location_id),
          sqlInput(clean.story_time),
          sqlInput(clean.is_flashback ? 1 : 0),
          sqlInput(clean.preconditions_json),
          sqlInput(clean.post_state_changes_json),
          sqlInput(clean.source_citations_json),
          sqlInput(clean.source_span_start ?? null),
          sqlInput(clean.source_span_end ?? null),
          sqlInput(clean.is_mandatory ? 1 : 0),
          sqlInput(clean.created_at)
        );
    } else {
      ctx.memoryStore.story_beats.set(clean.id, clean);
    }
  }

public getStoryBeat(id: string): StoryBeatRecord | null {
    const ctx=this.session();
    if (ctx.db && !ctx.isFallback) {
      const row = ctx.db.prepare("SELECT * FROM story_beats WHERE id = ?").get(id);
      return (row as unknown as StoryBeatRecord) ?? null;
    }
    return ctx.memoryStore.story_beats.get(id) ?? null;
  }

public listStoryBeats(seriesId: string, sourceId?: string): StoryBeatRecord[] {
    const ctx=this.session();
    if (ctx.db && !ctx.isFallback) {
      let query = "SELECT * FROM story_beats WHERE series_id = ?";
      const params: any[] = [seriesId];
      if (sourceId) {
        query += " AND source_id = ?";
        params.push(sourceId);
      }
      query += " ORDER BY beat_order ASC";
      return (ctx.db.prepare(query).all(...params) as unknown as StoryBeatRecord[]) ?? [];
    }
    return Array.from(ctx.memoryStore.story_beats.values())
      .filter((b) => b.series_id === seriesId && (!sourceId || b.source_id === sourceId))
      .sort((a, b) => a.beat_order - b.beat_order);
  }

public batchUpsertStoryBeats(beats: StoryBeatRecord[]): void {
    const ctx=this.session();
    if (ctx.db && !ctx.isFallback) {
      ctx.db.exec("BEGIN TRANSACTION;");
      try {
        for (const b of beats) {
          this.upsertStoryBeat(b);
        }
        ctx.db.exec("COMMIT;");
      } catch (err) {
        ctx.db.exec("ROLLBACK;");
        throw err;
      }
    } else {
      for (const b of beats) {
        this.upsertStoryBeat(b);
      }
    }
  }

public upsertStoryThread(thread: StoryThreadRecord): void {
    const ctx=this.session();
    const now = thread.created_at || new Date().toISOString();
    const clean: StoryThreadRecord = {
      ...thread,
      setup_beat_id: thread.setup_beat_id ?? null,
      payoff_beat_id: thread.payoff_beat_id ?? null,
      dependencies_json: thread.dependencies_json ?? "[]",
      created_at: now,
    };

    if (ctx.db && !ctx.isFallback) {
      ctx.db
        .prepare(`
          INSERT INTO story_threads (
            id, series_id, name, thread_type, description,
            setup_beat_id, payoff_beat_id, status, dependencies_json, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            name = excluded.name,
            thread_type = excluded.thread_type,
            description = excluded.description,
            setup_beat_id = excluded.setup_beat_id,
            payoff_beat_id = excluded.payoff_beat_id,
            status = excluded.status,
            dependencies_json = excluded.dependencies_json
        `)
        .run(
          sqlInput(clean.id),
          sqlInput(clean.series_id),
          sqlInput(clean.name),
          sqlInput(clean.thread_type),
          sqlInput(clean.description),
          sqlInput(clean.setup_beat_id),
          sqlInput(clean.payoff_beat_id),
          sqlInput(clean.status),
          sqlInput(clean.dependencies_json),
          sqlInput(clean.created_at)
        );
    } else {
      ctx.memoryStore.story_threads.set(clean.id, clean);
    }
  }

public getStoryThread(id: string): StoryThreadRecord | null {
    const ctx=this.session();
    if (ctx.db && !ctx.isFallback) {
      const row = ctx.db.prepare("SELECT * FROM story_threads WHERE id = ?").get(id);
      return (row as unknown as StoryThreadRecord) ?? null;
    }
    return ctx.memoryStore.story_threads.get(id) ?? null;
  }

public listStoryThreads(seriesId: string, status?: string): StoryThreadRecord[] {
    const ctx=this.session();
    if (ctx.db && !ctx.isFallback) {
      let query = "SELECT * FROM story_threads WHERE series_id = ?";
      const params: any[] = [seriesId];
      if (status) {
        query += " AND status = ?";
        params.push(status);
      }
      return (ctx.db.prepare(query).all(...params) as unknown as StoryThreadRecord[]) ?? [];
    }
    return Array.from(ctx.memoryStore.story_threads.values()).filter(
      (t) => t.series_id === seriesId && (!status || t.status === status)
    );
  }

public recordKnowledgeState(
    record: Omit<KnowledgeStateRecord, "id" | "created_at">
  ): KnowledgeStateRecord {
    const ctx=this.session();
    const now = new Date().toISOString();
    const clean: KnowledgeStateRecord = {
      ...record,
      entity_id: record.entity_id ?? null,
      revealed_at_episode: record.revealed_at_episode ?? null,
      revealed_at_beat_id: record.revealed_at_beat_id ?? null,
      is_flashback: record.is_flashback ? 1 : 0,
      notes: record.notes ?? null,
      created_at: now,
    };

    if (ctx.db && !ctx.isFallback) {
      const res = ctx.db
        .prepare(`
          INSERT INTO knowledge_states (
            series_id, fact_key, fact_type, entity_id,
            revealed_at_episode, revealed_at_beat_id, is_flashback, notes, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `)
        .run(
          sqlInput(clean.series_id),
          sqlInput(clean.fact_key),
          sqlInput(clean.fact_type),
          sqlInput(clean.entity_id),
          sqlInput(clean.revealed_at_episode),
          sqlInput(clean.revealed_at_beat_id),
          sqlInput(clean.is_flashback ? 1 : 0),
          sqlInput(clean.notes),
          sqlInput(clean.created_at)
        );
      clean.id = Number(res?.lastInsertRowid);
    } else {
      clean.id = ctx.memoryStore.knowledge_states.length + 1;
      ctx.memoryStore.knowledge_states.push(clean);
    }
    return clean;
  }

public listKnowledgeStates(
    seriesId: string,
    entityId?: string,
    factType?: string
  ): KnowledgeStateRecord[] {
    const ctx=this.session();
    if (ctx.db && !ctx.isFallback) {
      let query = "SELECT * FROM knowledge_states WHERE series_id = ?";
      const params: any[] = [seriesId];
      if (entityId) {
        query += " AND entity_id = ?";
        params.push(entityId);
      }
      if (factType) {
        query += " AND fact_type = ?";
        params.push(factType);
      }
      query += " ORDER BY id ASC";
      return (ctx.db.prepare(query).all(...params) as unknown as KnowledgeStateRecord[]) ?? [];
    }
    return ctx.memoryStore.knowledge_states.filter(
      (k) =>
        k.series_id === seriesId &&
        (!entityId || k.entity_id === entityId) &&
        (!factType || k.fact_type === factType)
    );
  }

public upsertSeriesPlan(plan: SeriesPlanRecord): void {
    const ctx=this.session();
    const now = new Date().toISOString();
    const raw = plan as any;
    const clean: SeriesPlanRecord = {
      ...plan,
      id: raw.id,
      series_id: raw.series_id ?? raw.seriesId,
      source_id: raw.source_id ?? raw.sourceId,
      revision: raw.revision ?? 1,
      target_episodes: raw.target_episodes ?? raw.targetEpisodes ?? 1,
      target_duration_per_episode_sec:
        raw.target_duration_per_episode_sec ?? raw.targetDurationPerEpisodeSec ?? 120,
      pacing_preset: raw.pacing_preset ?? raw.pacingPreset ?? "standard",
      status: raw.status ?? "draft",
      warnings_json: raw.warnings_json ?? raw.warningsJson ?? "[]",
      summary_json: raw.summary_json ?? raw.summaryJson ?? "{}",
      created_at: raw.created_at || now,
      updated_at: now,
    };

    if (ctx.db && !ctx.isFallback) {
      ctx.db
        .prepare(`
          INSERT INTO series_plans (
            id, series_id, source_id, revision, target_episodes,
            target_duration_per_episode_sec, pacing_preset, status,
            warnings_json, summary_json, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            revision = excluded.revision,
            target_episodes = excluded.target_episodes,
            target_duration_per_episode_sec = excluded.target_duration_per_episode_sec,
            pacing_preset = excluded.pacing_preset,
            status = excluded.status,
            warnings_json = excluded.warnings_json,
            summary_json = excluded.summary_json,
            updated_at = excluded.updated_at
        `)
        .run(
          sqlInput(clean.id),
          sqlInput(clean.series_id),
          sqlInput(clean.source_id),
          sqlInput(clean.revision),
          sqlInput(clean.target_episodes),
          sqlInput(clean.target_duration_per_episode_sec),
          sqlInput(clean.pacing_preset),
          sqlInput(clean.status),
          sqlInput(clean.warnings_json),
          sqlInput(clean.summary_json),
          sqlInput(clean.created_at),
          sqlInput(clean.updated_at)
        );
    } else {
      ctx.memoryStore.series_plans.set(clean.id, clean);
    }
  }

public getSeriesPlan(id: string): SeriesPlanRecord | null {
    const ctx=this.session();
    if (ctx.db && !ctx.isFallback) {
      const row = ctx.db.prepare("SELECT * FROM series_plans WHERE id = ?").get(id);
      return (row as unknown as SeriesPlanRecord) ?? null;
    }
    return ctx.memoryStore.series_plans.get(id) ?? null;
  }

public listSeriesPlans(seriesId: string): SeriesPlanRecord[] {
    const ctx=this.session();
    if (ctx.db && !ctx.isFallback) {
      return (
        (ctx.db
          .prepare("SELECT * FROM series_plans WHERE series_id = ? ORDER BY revision DESC, updated_at DESC")
          .all(seriesId) as unknown as SeriesPlanRecord[]) ?? []
      );
    }
    return Array.from(ctx.memoryStore.series_plans.values())
      .filter((p) => p.series_id === seriesId)
      .sort((a, b) => b.revision - a.revision);
  }

public getActiveSeriesPlan(seriesId: string): SeriesPlanRecord | null {
    const ctx=this.session();
    if (ctx.db && !ctx.isFallback) {
      const row = ctx.db
        .prepare(
          "SELECT * FROM series_plans WHERE series_id = ? AND status IN ('active', 'approved') ORDER BY revision DESC LIMIT 1"
        )
        .get(seriesId);
      if (row) return row as unknown as SeriesPlanRecord;
      const latest = ctx.db
        .prepare("SELECT * FROM series_plans WHERE series_id = ? ORDER BY revision DESC LIMIT 1")
        .get(seriesId);
      return (latest as unknown as SeriesPlanRecord) ?? null;
    }
    const matching = Array.from(ctx.memoryStore.series_plans.values())
      .filter((p) => p.series_id === seriesId && ["active", "approved"].includes(p.status))
      .sort((a, b) => b.revision - a.revision);
    if (matching.length > 0) return matching[0];
    const all = Array.from(ctx.memoryStore.series_plans.values())
      .filter((p) => p.series_id === seriesId)
      .sort((a, b) => b.revision - a.revision);
    return all[0] ?? null;
  }

public approveSeriesPlan(planId: string): SeriesPlanRecord | null {
    const ctx=this.session();
    return this.setSeriesPlanStatus(planId, "approved");
  }

public activateSeriesPlan(planId: string): SeriesPlanRecord | null {
    const ctx=this.session();
    return this.setSeriesPlanStatus(planId, "active");
  }

public setSeriesPlanStatus(
    planId: string,
    status: "draft" | "approved" | "active" | "stale" | "archived"
  ): SeriesPlanRecord | null {
    const ctx=this.session();
    const plan = this.getSeriesPlan(planId);
    if (!plan) return null;
    const now = new Date().toISOString();
    if (ctx.db && !ctx.isFallback) {
      if (status === "active") {
        ctx.db
          .prepare(
            "UPDATE series_plans SET status = 'approved', updated_at = ? WHERE series_id = ? AND status = 'active'"
          )
          .run(now, plan.series_id);
      }
      ctx.db
        .prepare("UPDATE series_plans SET status = ?, updated_at = ? WHERE id = ?")
        .run(status, now, planId);
    } else {
      if (status === "active") {
        for (const p of ctx.memoryStore.series_plans.values()) {
          if (p.series_id === plan.series_id && p.status === "active") {
            p.status = "approved";
            p.updated_at = now;
          }
        }
      }
      plan.status = status;
      plan.updated_at = now;
    }
    return this.getSeriesPlan(planId);
  }

public upsertPlannedEpisode(ep: PlannedEpisodeRecord): void {
    const ctx=this.session();
    const now = ep.created_at || new Date().toISOString();
    const raw = ep as any;
    const planId = raw.plan_id ?? raw.planId;
    const inferredSeriesId = raw.series_id ?? raw.seriesId ?? (planId ? this.getSeriesPlan(planId)?.series_id : null) ?? "";

    // Fix: an empty series_id causes a silent DB corruption (episodes stored
    // without a series association). Throw early so callers fix their input.
    if (!inferredSeriesId) {
      throw new Error(
        `[BIBLE] upsertPlannedEpisode: series_id is required but could not be resolved for episode '${raw.id ?? "(unknown)"}'. ` +
          `Pass series_id explicitly or ensure the parent plan '${planId ?? "(unknown)"}' exists in the Bible first.`
      );
    }
    const clean: PlannedEpisodeRecord = {
      ...ep,
      id: raw.id,
      plan_id: planId,
      series_id: inferredSeriesId,
      episode_number: raw.episode_number ?? raw.episodeNumber,
      title: raw.title,
      logline: raw.logline,
      goal: ep.goal ?? null,
      opening: ep.opening ?? null,
      development: ep.development ?? null,
      climax: ep.climax ?? null,
      ending: ep.ending ?? null,
      target_duration_sec: raw.target_duration_sec ?? raw.targetDurationSec ?? 120,
      state_in_json: raw.state_in_json ?? raw.stateInJson ?? "{}",
      planned_state_out_json: raw.planned_state_out_json ?? raw.plannedStateOutJson ?? "{}",
      dependencies_json: raw.dependencies_json ?? raw.dependenciesJson ?? "[]",
      estimated_scenes: raw.estimated_scenes ?? raw.estimatedScenes ?? 0,
      estimated_shots: raw.estimated_shots ?? raw.estimatedShots ?? 0,
      created_at: now,
    };

    if (ctx.db && !ctx.isFallback) {
      ctx.db
        .prepare(`
          INSERT INTO planned_episodes (
            id, plan_id, series_id, episode_number, title, logline,
            goal, opening, development, climax, ending, target_duration_sec,
            state_in_json, planned_state_out_json, dependencies_json,
            estimated_scenes, estimated_shots, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            title = excluded.title,
            logline = excluded.logline,
            goal = excluded.goal,
            opening = excluded.opening,
            development = excluded.development,
            climax = excluded.climax,
            ending = excluded.ending,
            target_duration_sec = excluded.target_duration_sec,
            state_in_json = excluded.state_in_json,
            planned_state_out_json = excluded.planned_state_out_json,
            dependencies_json = excluded.dependencies_json,
            estimated_scenes = excluded.estimated_scenes,
            estimated_shots = excluded.estimated_shots
        `)
        .run(
          sqlInput(clean.id),
          sqlInput(clean.plan_id),
          sqlInput(clean.series_id),
          sqlInput(clean.episode_number),
          sqlInput(clean.title),
          sqlInput(clean.logline),
          sqlInput(clean.goal),
          sqlInput(clean.opening),
          sqlInput(clean.development),
          sqlInput(clean.climax),
          sqlInput(clean.ending),
          sqlInput(clean.target_duration_sec),
          sqlInput(clean.state_in_json),
          sqlInput(clean.planned_state_out_json),
          sqlInput(clean.dependencies_json),
          sqlInput(clean.estimated_scenes),
          sqlInput(clean.estimated_shots),
          sqlInput(clean.created_at)
        );
    } else {
      ctx.memoryStore.planned_episodes.set(clean.id, clean);
    }
  }

public getPlannedEpisode(planIdOrId: string, episodeNumber?: number): PlannedEpisodeRecord | null {
    const ctx=this.session();
    if (ctx.db && !ctx.isFallback) {
      if (episodeNumber !== undefined) {
        const row = ctx.db
          .prepare("SELECT * FROM planned_episodes WHERE plan_id = ? AND episode_number = ?")
          .get(planIdOrId, episodeNumber);
        return (row as unknown as PlannedEpisodeRecord) ?? null;
      } else {
        const row = ctx.db
          .prepare("SELECT * FROM planned_episodes WHERE id = ?")
          .get(planIdOrId);
        return (row as unknown as PlannedEpisodeRecord) ?? null;
      }
    }
    if (episodeNumber !== undefined) {
      return (
        Array.from(ctx.memoryStore.planned_episodes.values()).find(
          (e) => e.plan_id === planIdOrId && e.episode_number === episodeNumber
        ) ?? null
      );
    }
    return ctx.memoryStore.planned_episodes.get(planIdOrId) ?? null;
  }

public listPlannedEpisodes(planId: string): PlannedEpisodeRecord[] {
    const ctx=this.session();
    if (ctx.db && !ctx.isFallback) {
      return (
        (ctx.db
          .prepare("SELECT * FROM planned_episodes WHERE plan_id = ? ORDER BY episode_number ASC")
          .all(planId) as unknown as PlannedEpisodeRecord[]) ?? []
      );
    }
    return Array.from(ctx.memoryStore.planned_episodes.values())
      .filter((e) => e.plan_id === planId)
      .sort((a, b) => a.episode_number - b.episode_number);
  }

public batchUpsertPlannedEpisodes(episodes: PlannedEpisodeRecord[]): void {
    const ctx=this.session();
    if (ctx.db && !ctx.isFallback) {
      ctx.db.exec("BEGIN TRANSACTION;");
      try {
        for (const ep of episodes) {
          this.upsertPlannedEpisode(ep);
        }
        ctx.db.exec("COMMIT;");
      } catch (err) {
        ctx.db.exec("ROLLBACK;");
        throw err;
      }
    } else {
      for (const ep of episodes) {
        this.upsertPlannedEpisode(ep);
      }
    }
  }

public upsertCoverageLedger(cov: CoverageLedgerRecord): void {
    const ctx=this.session();
    const now = cov.created_at || new Date().toISOString();
    const raw = cov as any;
    const clean: CoverageLedgerRecord = {
      ...cov,
      id: raw.id,
      plan_id: raw.plan_id ?? raw.planId,
      series_id: raw.series_id ?? raw.seriesId,
      source_id: raw.source_id ?? raw.sourceId ?? "source_unknown",
      source_unit_id: raw.source_unit_id ?? raw.sourceUnitId ?? "unit_unknown",
      source_block_id: raw.source_block_id ?? raw.sourceBlockId ?? null,
      episode_number: raw.episode_number ?? raw.episodeNumber ?? null,
      scene_number: raw.scene_number ?? raw.sceneNumber ?? null,
      adaptation_decision: raw.adaptation_decision ?? raw.adaptationDecision ?? "kept",
      rationale: cov.rationale ?? null,
      mandatory_beat_id: raw.mandatory_beat_id ?? raw.mandatoryBeatId ?? null,
      beat_id: raw.beat_id ?? raw.beatId ?? null,
      scene_id: raw.scene_id ?? raw.sceneId ?? null,
      shot_id: raw.shot_id ?? raw.shotId ?? null,
      stage: raw.stage ?? "allocated_to_episode",
      created_at: now,
    };

    if (ctx.db && !ctx.isFallback) {
      ctx.db
        .prepare(`
          INSERT INTO coverage_ledgers (
            id, plan_id, series_id, source_id, source_unit_id, source_block_id,
            episode_number, scene_number, adaptation_decision, rationale,
            mandatory_beat_id, beat_id, scene_id, shot_id, stage, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            episode_number = excluded.episode_number,
            scene_number = excluded.scene_number,
            adaptation_decision = excluded.adaptation_decision,
            rationale = excluded.rationale,
            mandatory_beat_id = excluded.mandatory_beat_id,
            beat_id = excluded.beat_id,
            scene_id = excluded.scene_id,
            shot_id = excluded.shot_id,
            stage = excluded.stage
        `)
        .run(
          sqlInput(clean.id),
          sqlInput(clean.plan_id),
          sqlInput(clean.series_id),
          sqlInput(clean.source_id),
          sqlInput(clean.source_unit_id),
          sqlInput(clean.source_block_id),
          sqlInput(clean.episode_number),
          sqlInput(clean.scene_number),
          sqlInput(clean.adaptation_decision),
          sqlInput(clean.rationale),
          sqlInput(clean.mandatory_beat_id),
          sqlInput(clean.beat_id ?? null),
          sqlInput(clean.scene_id ?? null),
          sqlInput(clean.shot_id ?? null),
          sqlInput(clean.stage ?? "allocated_to_episode"),
          sqlInput(clean.created_at)
        );
    } else {
      ctx.memoryStore.coverage_ledgers.set(clean.id, clean);
    }
  }

public listCoverageLedgers(planOrSeriesId: string): CoverageLedgerRecord[] {
    const ctx=this.session();
    if (ctx.db && !ctx.isFallback) {
      return (
        (ctx.db
          .prepare(
            "SELECT * FROM coverage_ledgers WHERE plan_id = ? OR series_id = ? ORDER BY source_unit_id ASC, episode_number ASC"
          )
          .all(planOrSeriesId, planOrSeriesId) as unknown as CoverageLedgerRecord[]) ?? []
      );
    }
    return Array.from(ctx.memoryStore.coverage_ledgers.values()).filter(
      (c) => c.plan_id === planOrSeriesId || c.series_id === planOrSeriesId
    );
  }

public batchUpsertCoverageLedgers(ledgers: CoverageLedgerRecord[]): void {
    const ctx=this.session();
    if (ctx.db && !ctx.isFallback) {
      ctx.db.exec("BEGIN TRANSACTION;");
      try {
        for (const l of ledgers) {
          this.upsertCoverageLedger(l);
        }
        ctx.db.exec("COMMIT;");
      } catch (err) {
        ctx.db.exec("ROLLBACK;");
        throw err;
      }
    } else {
      for (const l of ledgers) {
        this.upsertCoverageLedger(l);
      }
    }
  }

public enqueueReviewItem(
    item: AnalysisReviewItemRecord | Omit<AnalysisReviewItemRecord, "created_at">
  ): AnalysisReviewItemRecord {
    const ctx=this.session();
    const now = (item as any).created_at || new Date().toISOString();
    const clean: AnalysisReviewItemRecord = {
      ...item,
      source_id: item.source_id ?? null,
      confidence_score: item.confidence_score ?? 1.0,
      reasons_json: item.reasons_json || "[]",
      status: item.status || "pending",
      reviewed_at: item.reviewed_at ?? null,
      review_notes: item.review_notes ?? null,
      created_at: now,
    };

    if (ctx.db && !ctx.isFallback) {
      ctx.db
        .prepare(`
          INSERT INTO analysis_review_queue (
            id, type, series_id, source_id, data_json,
            confidence_score, reasons_json, status, reviewed_at, review_notes, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            type = excluded.type,
            source_id = excluded.source_id,
            data_json = excluded.data_json,
            confidence_score = excluded.confidence_score,
            reasons_json = excluded.reasons_json,
            status = excluded.status,
            reviewed_at = excluded.reviewed_at,
            review_notes = excluded.review_notes
        `)
        .run(
          sqlInput(clean.id),
          sqlInput(clean.type),
          sqlInput(clean.series_id),
          sqlInput(clean.source_id),
          sqlInput(clean.data_json),
          sqlInput(clean.confidence_score),
          sqlInput(clean.reasons_json),
          sqlInput(clean.status),
          sqlInput(clean.reviewed_at),
          sqlInput(clean.review_notes),
          sqlInput(clean.created_at)
        );
    } else {
      ctx.memoryStore.analysis_review_queue.set(clean.id, clean);
    }
    return clean;
  }

public getReviewItem(id: string): AnalysisReviewItemRecord | null {
    const ctx=this.session();
    if (ctx.db && !ctx.isFallback) {
      const row = ctx.db.prepare("SELECT * FROM analysis_review_queue WHERE id = ?").get(id);
      return (row as unknown as AnalysisReviewItemRecord) ?? null;
    }
    return ctx.memoryStore.analysis_review_queue.get(id) ?? null;
  }

public listReviewItems(seriesId?: string, status?: string): AnalysisReviewItemRecord[] {
    const ctx=this.session();
    if (ctx.db && !ctx.isFallback) {
      let query = "SELECT * FROM analysis_review_queue";
      const conditions: string[] = [];
      const params: any[] = [];
      if (seriesId) {
        conditions.push("series_id = ?");
        params.push(seriesId);
      }
      if (status) {
        conditions.push("status = ?");
        params.push(status);
      }
      if (conditions.length > 0) {
        query += " WHERE " + conditions.join(" AND ");
      }
      query += " ORDER BY created_at DESC";
      return (ctx.db.prepare(query).all(...params) as unknown as AnalysisReviewItemRecord[]) ?? [];
    }
    return Array.from(ctx.memoryStore.analysis_review_queue.values())
      .filter(
        (r) => (!seriesId || r.series_id === seriesId) && (!status || r.status === status)
      )
      .sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""));
  }

public getPendingReviewItems(seriesId?: string): AnalysisReviewItemRecord[] {
    const ctx=this.session();
    return this.listReviewItems(seriesId, "pending");
  }

public approveReviewItem(id: string, reviewNotes?: string): boolean {
    const ctx=this.session();
    const item = this.getReviewItem(id);
    if (!item) return false;
    const now = new Date().toISOString();
    if (ctx.db && !ctx.isFallback) {
      const res = ctx.db
        .prepare(`
          UPDATE analysis_review_queue
          SET status = 'approved', reviewed_at = ?, review_notes = COALESCE(?, review_notes)
          WHERE id = ?
        `)
        .run(now, reviewNotes ?? null, id);
      return (res?.changes || 0) > 0;
    } else {
      item.status = "approved";
      item.reviewed_at = now;
      if (reviewNotes) item.review_notes = reviewNotes;
      return true;
    }
  }

public rejectReviewItem(id: string, reviewNotes?: string): boolean {
    const ctx=this.session();
    const item = this.getReviewItem(id);
    if (!item) return false;
    const now = new Date().toISOString();
    if (ctx.db && !ctx.isFallback) {
      const res = ctx.db
        .prepare(`
          UPDATE analysis_review_queue
          SET status = 'rejected', reviewed_at = ?, review_notes = COALESCE(?, review_notes)
          WHERE id = ?
        `)
        .run(now, reviewNotes ?? null, id);
      return (res?.changes || 0) > 0;
    } else {
      item.status = "rejected";
      item.reviewed_at = now;
      if (reviewNotes) item.review_notes = reviewNotes;
      return true;
    }
  }

public plantChekhovGun(gun: ChekhovGunRecord): ChekhovGunRecord {
    const ctx=this.session();
    const now = gun.created_at || new Date().toISOString();
    const lastActive = gun.last_active_episode ?? gun.planted_at_episode;
    const clean: ChekhovGunRecord = {
      ...gun,
      type: gun.type ?? "prop",
      description: gun.description ?? "",
      planted_in_beat_id: gun.planted_in_beat_id ?? null,
      payoff_status: gun.payoff_status || "planted",
      payoff_episode: gun.payoff_episode ?? null,
      payoff_beat_id: gun.payoff_beat_id ?? null,
      dormant_episodes_count: gun.dormant_episodes_count ?? 0,
      last_active_episode: lastActive,
      created_at: now,
    };

    if (ctx.db && !ctx.isFallback) {
      ctx.db
        .prepare(`
          INSERT INTO chekhov_guns (
            id, series_id, name, type, description, planted_at_episode,
            planted_in_beat_id, payoff_status, payoff_episode, payoff_beat_id,
            dormant_episodes_count, last_active_episode, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            name = excluded.name,
            type = excluded.type,
            description = excluded.description,
            planted_at_episode = excluded.planted_at_episode,
            planted_in_beat_id = excluded.planted_in_beat_id,
            payoff_status = excluded.payoff_status,
            payoff_episode = excluded.payoff_episode,
            payoff_beat_id = excluded.payoff_beat_id,
            dormant_episodes_count = excluded.dormant_episodes_count,
            last_active_episode = excluded.last_active_episode
        `)
        .run(
          sqlInput(clean.id),
          sqlInput(clean.series_id),
          sqlInput(clean.name),
          sqlInput(clean.type),
          sqlInput(clean.description),
          sqlInput(clean.planted_at_episode),
          sqlInput(clean.planted_in_beat_id),
          sqlInput(clean.payoff_status),
          sqlInput(clean.payoff_episode),
          sqlInput(clean.payoff_beat_id),
          sqlInput(clean.dormant_episodes_count),
          sqlInput(clean.last_active_episode),
          sqlInput(clean.created_at)
        );
    } else {
      ctx.memoryStore.chekhov_guns.set(clean.id, clean);
    }
    return clean;
  }

public updateChekhovGunActivity(
    id: string,
    episodeNumber: number,
    status?: "planted" | "active"
  ): boolean {
    const ctx=this.session();
    const gun = this.getChekhovGun(id);
    if (!gun) return false;

    const newStatus = status || gun.payoff_status;
    if (ctx.db && !ctx.isFallback) {
      const res = ctx.db
        .prepare(`
          UPDATE chekhov_guns
          SET last_active_episode = ?, payoff_status = ?
          WHERE id = ?
        `)
        .run(episodeNumber, newStatus, id);
      return (res?.changes || 0) > 0;
    } else {
      gun.last_active_episode = episodeNumber;
      gun.payoff_status = newStatus;
      return true;
    }
  }

public resolveChekhovGun(
    id: string,
    episodeNumber: number,
    beatId?: string,
    status: "resolved" | "abandoned" = "resolved"
  ): boolean {
    const ctx=this.session();
    const gun = this.getChekhovGun(id);
    if (!gun) return false;

    if (ctx.db && !ctx.isFallback) {
      const res = ctx.db
        .prepare(`
          UPDATE chekhov_guns
          SET payoff_status = ?, payoff_episode = ?, payoff_beat_id = ?, last_active_episode = ?
          WHERE id = ?
        `)
        .run(status, episodeNumber, beatId ?? null, episodeNumber, id);
      return (res?.changes || 0) > 0;
    } else {
      gun.payoff_status = status;
      gun.payoff_episode = episodeNumber;
      gun.payoff_beat_id = beatId ?? null;
      gun.last_active_episode = episodeNumber;
      return true;
    }
  }

public getChekhovGun(id: string): ChekhovGunRecord | null {
    const ctx=this.session();
    if (ctx.db && !ctx.isFallback) {
      const row = ctx.db.prepare("SELECT * FROM chekhov_guns WHERE id = ?").get(id);
      return (row as unknown as ChekhovGunRecord) ?? null;
    }
    return ctx.memoryStore.chekhov_guns.get(id) ?? null;
  }

public listChekhovGuns(seriesId: string, status?: string): ChekhovGunRecord[] {
    const ctx=this.session();
    if (ctx.db && !ctx.isFallback) {
      let query = "SELECT * FROM chekhov_guns WHERE series_id = ?";
      const params: any[] = [seriesId];
      if (status) {
        query += " AND payoff_status = ?";
        params.push(status);
      }
      query += " ORDER BY planted_at_episode ASC";
      return (ctx.db.prepare(query).all(...params) as unknown as ChekhovGunRecord[]) ?? [];
    }
    return Array.from(ctx.memoryStore.chekhov_guns.values())
      .filter((g) => g.series_id === seriesId && (!status || g.payoff_status === status))
      .sort((a, b) => a.planted_at_episode - b.planted_at_episode);
  }

public listActiveChekhovGuns(seriesId: string, currentEpisode: number): ChekhovGunRecord[] {
    const ctx=this.session();
    const guns = this.listChekhovGuns(seriesId);
    return guns
      .filter((g) => {
        if (g.planted_at_episode > currentEpisode) {
          return false;
        }
        if (g.payoff_status === "planted" || g.payoff_status === "active") {
          return true;
        }
        if (g.payoff_status === "resolved") {
          // If resolved in a future episode relative to currentEpisode, it was still active at currentEpisode
          return typeof g.payoff_episode === "number" && g.payoff_episode > currentEpisode;
        }
        return false;
      })
      .map((g) => {
        const lastActive =
          typeof g.last_active_episode === "number" && g.last_active_episode >= g.planted_at_episode
            ? g.last_active_episode
            : g.planted_at_episode;
        return {
          ...g,
          dormant_episodes_count: Math.max(0, currentEpisode - lastActive),
        };
      });
  }
}
