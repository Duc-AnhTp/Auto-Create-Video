import type {DatabaseSession} from './session.js';
import { WorkflowError } from "../workflow-error.js";
import { createRequire } from "node:module";
import { FatalSqliteError } from "../../contracts/story.js";
const nodeRequire=createRequire(import.meta.url);

export class MigrationRepository {
  constructor(private session:()=>DatabaseSession,private migrateProduction:(context:DatabaseSession,versions:Set<number>)=>void){}
public runMigrations(): void {
    const ctx=this.session();
    if (ctx.isFallback) {
      const now = new Date().toISOString();
      if (!ctx.memoryStore.migrations.some((m) => m.version === 1)) {
        ctx.memoryStore.migrations.push({ version: 1, name: "initial_schema", applied_at: now });
      }
      if (!ctx.memoryStore.migrations.some((m) => m.version === 2)) {
        ctx.memoryStore.migrations.push({
          version: 2,
          name: "versioned_canon_state_manager",
          applied_at: now,
        });
      }
      if (!ctx.memoryStore.migrations.some((m) => m.version === 3)) {
        ctx.memoryStore.migrations.push({
          version: 3,
          name: "versioned_reference_assets_and_storyboards",
          applied_at: now,
        });
      }
      if (!ctx.memoryStore.migrations.some((m) => m.version === 4)) {
        ctx.memoryStore.migrations.push({
          version: 4,
          name: "resilient_job_orchestration_and_ledger",
          applied_at: now,
        });
      }
      if (!ctx.memoryStore.migrations.some((m) => m.version === 5)) {
        ctx.memoryStore.migrations.push({
          version: 5,
          name: "preflight_dedup_and_unique_take_index",
          applied_at: now,
        });
      }
      if (!ctx.memoryStore.migrations.some((m) => m.version === 6)) {
        ctx.memoryStore.migrations.push({
          version: 6,
          name: "novel_ingestion_and_series_planning",
          applied_at: now,
        });
      }
      if (!ctx.memoryStore.migrations.some((m) => m.version === 7)) {
        ctx.memoryStore.migrations.push({
          version: 7,
          name: "chekhov_guns_and_long_novel_continuity",
          applied_at: now,
        });
      }
      if (!ctx.memoryStore.migrations.some((m) => m.version === 8)) {
        ctx.memoryStore.migrations.push({
          version: 8,
          name: "immutable_source_revisions",
          applied_at: now,
        });
      }
      if (!ctx.memoryStore.migrations.some((m) => m.version === 9)) {
        ctx.memoryStore.migrations.push({
          version: 9,
          name: "persistent_llm_token_usage_telemetry",
          applied_at: now,
        });
      }
      for (const [version, name] of [[10,"reference_provenance_and_artifacts"],[11,"durable_provider_attempt_groups"],[12,"canonical_revision_semantic_indexes"],[13,"invoice_receipts_and_legacy_usage_ownership"]] as const) {
        if (!ctx.memoryStore.migrations.some(m => m.version === version)) ctx.memoryStore.migrations.push({version,name,applied_at:now});
      }
      return;
    }
    if (!ctx.db) return;

    ctx.db.exec("BEGIN IMMEDIATE;");
    try {
      ctx.db.exec(`
        CREATE TABLE IF NOT EXISTS canon_migrations (
          version INTEGER PRIMARY KEY,
          name TEXT NOT NULL,
          applied_at TEXT NOT NULL
        );
      `);

      const appliedRows = ctx.db.prepare("SELECT version FROM canon_migrations").all() as { version: number }[];
      const appliedVersions = new Set(appliedRows.map((r) => r.version));

      if (!appliedVersions.has(1)) {
        ctx.db.prepare("INSERT INTO canon_migrations (version, name, applied_at) VALUES (?, ?, ?)").run(
          1,
          "initial_schema",
          new Date().toISOString()
        );
      }

      if (!appliedVersions.has(2)) {
        ctx.db.prepare("INSERT INTO canon_migrations (version, name, applied_at) VALUES (?, ?, ?)").run(
          2,
          "versioned_canon_state_manager",
          new Date().toISOString()
        );
      }

      if (!appliedVersions.has(3)) {
        ctx.db.prepare("INSERT INTO canon_migrations (version, name, applied_at) VALUES (?, ?, ?)").run(
          3,
          "versioned_reference_assets_and_storyboards",
          new Date().toISOString()
        );
      }

      if (!appliedVersions.has(4)) {
        ctx.db.prepare("INSERT INTO canon_migrations (version, name, applied_at) VALUES (?, ?, ?)").run(
          4,
          "resilient_job_orchestration_and_ledger",
          new Date().toISOString()
        );
      }

      if (!appliedVersions.has(5)) {
        // Step 1: Create shot_takes_legacy_archive table for deduplicated takes
        ctx.db.exec(`
          CREATE TABLE IF NOT EXISTS shot_takes_legacy_archive (
            id TEXT PRIMARY KEY,
            series_id TEXT NOT NULL,
            episode_number INTEGER NOT NULL,
            shot_id TEXT NOT NULL,
            take_number INTEGER NOT NULL,
            provider TEXT NOT NULL,
            prompt TEXT NOT NULL,
            seed INTEGER,
            local_path TEXT NOT NULL,
            duration_sec REAL NOT NULL,
            qa_status TEXT NOT NULL,
            qa_score REAL,
            qa_notes TEXT,
            is_approved INTEGER NOT NULL,
            cost_usd REAL NOT NULL,
            created_at TEXT NOT NULL,
            qa_report_json TEXT,
            storyboard_keyframe_id TEXT,
            used_references_json TEXT,
            archived_at TEXT NOT NULL,
            archival_reason TEXT NOT NULL
          );
        `);

        // Step 2: Preflight deduplication for shot_takes to guarantee unique constraint safety
        {
          const dupGroups = ctx.db
            .prepare(`
              SELECT series_id, episode_number, shot_id, take_number, COUNT(*) as cnt
              FROM shot_takes
              GROUP BY series_id, episode_number, shot_id, take_number
              HAVING cnt > 1
            `)
            .all() as Array<{ series_id: string; episode_number: number; shot_id: string; take_number: number; cnt: number }>;

          for (const grp of dupGroups) {
            const rows = ctx.db
              .prepare(`
                SELECT * FROM shot_takes
                WHERE series_id = ? AND episode_number = ? AND shot_id = ? AND take_number = ?
                ORDER BY is_approved DESC, created_at DESC, id DESC
              `)
              .all(grp.series_id, grp.episode_number, grp.shot_id, grp.take_number) as any[];

            const maxRow = ctx.db
              .prepare(`
                SELECT MAX(take_number) as max_take
                FROM shot_takes
                WHERE series_id = ? AND episode_number = ? AND shot_id = ?
              `)
              .get(grp.series_id, grp.episode_number, grp.shot_id) as { max_take: number } | undefined;

            let nextTakeNum = ((maxRow?.max_take ?? grp.take_number) || grp.take_number) + 1;

            // Keep index 0 at original take_number; renumber remaining duplicates and archive
            for (let i = 1; i < rows.length; i++) {
              const dupRow = rows[i];
              ctx.db.prepare(`
                  INSERT OR REPLACE INTO shot_takes_legacy_archive (
                    id, series_id, episode_number, shot_id, take_number, provider, prompt, seed,
                    local_path, duration_sec, qa_status, qa_score, qa_notes, is_approved, cost_usd,
                    created_at, qa_report_json, storyboard_keyframe_id, used_references_json,
                    archived_at, archival_reason
                  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                `).run(
                  dupRow.id,
                  dupRow.series_id,
                  dupRow.episode_number,
                  dupRow.shot_id,
                  dupRow.take_number,
                  dupRow.provider,
                  dupRow.prompt,
                  dupRow.seed ?? null,
                  dupRow.local_path,
                  dupRow.duration_sec,
                  dupRow.qa_status,
                  dupRow.qa_score ?? null,
                  dupRow.qa_notes ?? null,
                  dupRow.is_approved ? 1 : 0,
                  dupRow.cost_usd,
                  dupRow.created_at,
                  dupRow.qa_report_json ?? null,
                  dupRow.storyboard_keyframe_id ?? null,
                  dupRow.used_references_json ?? null,
                  new Date().toISOString(),
                  `duplicate_renumbered_from_take_${dupRow.take_number}`
                );

              ctx.db.prepare("UPDATE shot_takes SET take_number = ? WHERE id = ?").run(nextTakeNum, dupRow.id);
              nextTakeNum++;
            }
          }
        }

        // Step 3: Migrate episode_lifecycle to composite PK (series_id, episode_number) if legacy single-column PK
        {
          const tableInfo = ctx.db.prepare("PRAGMA table_info(episode_lifecycle)").all() as Array<{ name: string; pk: number }>;
          const pkCols = tableInfo.filter((c) => c.pk > 0);
          const hasCompositePk = pkCols.length >= 2 && pkCols.some((c) => c.name === "series_id") && pkCols.some((c) => c.name === "episode_number");

          if (!hasCompositePk && tableInfo.length > 0) {
            ctx.db.exec(`
              CREATE TABLE IF NOT EXISTS episode_lifecycle_v5 (
                series_id TEXT NOT NULL,
                episode_number INTEGER NOT NULL,
                status TEXT NOT NULL DEFAULT 'draft',
                snapshot_id TEXT,
                needs_review INTEGER NOT NULL DEFAULT 0,
                review_notes TEXT,
                storyboard_approved_at TEXT,
                updated_at TEXT NOT NULL,
                PRIMARY KEY (series_id, episode_number),
                FOREIGN KEY (snapshot_id) REFERENCES canon_snapshots (id)
              );
              INSERT OR IGNORE INTO episode_lifecycle_v5 (series_id, episode_number, status, snapshot_id, needs_review, review_notes, storyboard_approved_at, updated_at)
              SELECT series_id, episode_number, status, snapshot_id, needs_review, review_notes, storyboard_approved_at, updated_at FROM episode_lifecycle;
              DROP TABLE episode_lifecycle;
              ALTER TABLE episode_lifecycle_v5 RENAME TO episode_lifecycle;
              CREATE INDEX IF NOT EXISTS idx_lifecycle_status ON episode_lifecycle (series_id, status);
            `);
          }
        }

        // Step 4: Safely create unique identity index on shot_takes
        ctx.db.exec("CREATE UNIQUE INDEX IF NOT EXISTS uq_shot_takes_identity ON shot_takes (series_id, episode_number, shot_id, take_number);");

        ctx.db.prepare("INSERT INTO canon_migrations (version, name, applied_at) VALUES (?, ?, ?)").run(
          5,
          "preflight_dedup_and_unique_take_index",
          new Date().toISOString()
        );
      }

      if (!appliedVersions.has(6)) {
        this.applyV6Migration();
        ctx.db.prepare("INSERT INTO canon_migrations (version, name, applied_at) VALUES (?, ?, ?)").run(
          6,
          "novel_ingestion_and_series_planning",
          new Date().toISOString()
        );
      }

      if (!appliedVersions.has(7)) {
        this.applyV7Migration();
        ctx.db.prepare("INSERT INTO canon_migrations (version, name, applied_at) VALUES (?, ?, ?)").run(
          7,
          "chekhov_guns_and_long_novel_continuity",
          new Date().toISOString()
        );
      }

      if (!appliedVersions.has(8)) {
        this.applyV8Migration();
        ctx.db.prepare("INSERT INTO canon_migrations (version, name, applied_at) VALUES (?, ?, ?)").run(
          8,
          "immutable_source_revisions",
          new Date().toISOString()
        );
      }
      if (!appliedVersions.has(9)) {
        ctx.db.prepare("INSERT INTO canon_migrations (version, name, applied_at) VALUES (?, ?, ?)").run(
          9,
          "persistent_llm_token_usage_telemetry",
          new Date().toISOString()
        );
      }
      this.migrateProduction(ctx,appliedVersions);
      if (!appliedVersions.has(13)) {
        ctx.db.exec(`CREATE TABLE IF NOT EXISTS provider_invoice_receipts(id TEXT PRIMARY KEY,attempt_id TEXT NOT NULL,payload TEXT NOT NULL);
          CREATE TABLE IF NOT EXISTS legacy_usage_ownership(log_id INTEGER PRIMARY KEY,candidates TEXT NOT NULL,status TEXT NOT NULL);`);
        for (const row of ctx.db.prepare("SELECT id,shot_id,episode_number FROM api_usage_logs WHERE series_id IS NULL").all()) {
          const owners = ctx.db.prepare("SELECT DISTINCT series_id FROM provider_jobs WHERE shot_id=? AND episode_number=?").all(row.shot_id ?? null,row.episode_number ?? null).map(value=>String(value.series_id));
          if (owners.length === 1) ctx.db.prepare("UPDATE api_usage_logs SET series_id=? WHERE id=?").run(owners[0],row.id);
          ctx.db.prepare("INSERT OR IGNORE INTO legacy_usage_ownership VALUES(?,?,?)").run(row.id,JSON.stringify(owners),owners.length===1?'resolved':'needs_review');
        }
        ctx.db.prepare("INSERT INTO canon_migrations VALUES(?,?,?)").run(13,'invoice_receipts_and_legacy_usage_ownership',new Date().toISOString());
      }
      for (const [version,name] of [[10,"reference_provenance_and_artifacts"],[11,"durable_provider_attempt_groups"],[12,"canonical_revision_semantic_indexes"]] as const) {
        if (!appliedVersions.has(version)) ctx.db.prepare("INSERT INTO canon_migrations VALUES(?,?,?)").run(version,name,new Date().toISOString());
      }
      const canonicalTables = ctx.db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as {name:string}[];
      for (const {name} of canonicalTables) {
        if (!/^(characters|locations|key_props|world_|relationships|canon_|episode_|story_|source_|novel_|planned_|character_|prop_states|location_states|state_events|timeline_branches|branch_snapshots|applied_commits|series_metadata|series_plans|knowledge_states|coverage_ledgers|chekhov_guns|reference_assets|production_references)/.test(name) || name === "canon_migrations") continue;
        for (const action of ["INSERT","UPDATE","DELETE"]) {
          const safeName = name.replace(/"/g, '""');
          ctx.db.exec(`CREATE TRIGGER IF NOT EXISTS "revision_${safeName}_${action}" AFTER ${action} ON "${safeName}" BEGIN UPDATE canonical_revision SET revision=revision+1 WHERE id=1; END;`);
        }
      }
      ctx.db.exec("COMMIT;");
    } catch (error) {
      try { ctx.db.exec("ROLLBACK;"); } catch { /* Preserve the original migration error. */ }
      throw new FatalSqliteError(`Story Bible migration failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

public applyV6Migration(): void {
    const ctx=this.session();
    if (!ctx.db) return;
    ctx.db.exec(`
      CREATE TABLE IF NOT EXISTS source_works (
        id TEXT PRIMARY KEY,
        series_id TEXT NOT NULL,
        title TEXT NOT NULL,
        author TEXT,
        source_type TEXT NOT NULL DEFAULT 'prose',
        current_revision INTEGER NOT NULL DEFAULT 1,
        content_hash TEXT NOT NULL,
        raw_text TEXT NOT NULL,
        normalized_text TEXT NOT NULL,
        normalization_rules_json TEXT NOT NULL DEFAULT '{}',
        metadata_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_source_works_series ON source_works (series_id);

      CREATE TABLE IF NOT EXISTS source_revisions (
        id TEXT PRIMARY KEY,
        source_id TEXT NOT NULL,
        series_id TEXT NOT NULL,
        revision INTEGER NOT NULL,
        content_hash TEXT NOT NULL,
        raw_text TEXT NOT NULL,
        normalized_text TEXT NOT NULL,
        normalization_rules_json TEXT NOT NULL DEFAULT '{}',
        metadata_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        FOREIGN KEY (source_id) REFERENCES source_works (id) ON DELETE CASCADE
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_source_revisions_unique ON source_revisions (source_id, revision);
      CREATE INDEX IF NOT EXISTS idx_source_revisions_series ON source_revisions (series_id, source_id);

      CREATE TABLE IF NOT EXISTS source_units (
        id TEXT PRIMARY KEY,
        source_id TEXT NOT NULL,
        series_id TEXT NOT NULL,
        revision INTEGER NOT NULL DEFAULT 1,
        unit_type TEXT NOT NULL DEFAULT 'chapter',
        unit_number INTEGER NOT NULL,
        title TEXT NOT NULL,
        order_index INTEGER NOT NULL,
        char_start INTEGER NOT NULL,
        char_end INTEGER NOT NULL,
        raw_text TEXT NOT NULL,
        summary TEXT,
        token_count_estimate INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        FOREIGN KEY (source_id) REFERENCES source_works (id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_source_units_lookup ON source_units (source_id, revision, order_index);
      CREATE INDEX IF NOT EXISTS idx_source_units_series ON source_units (series_id, source_id);

      CREATE TABLE IF NOT EXISTS source_blocks (
        id TEXT PRIMARY KEY,
        source_id TEXT NOT NULL,
        unit_id TEXT NOT NULL,
        series_id TEXT NOT NULL,
        revision INTEGER NOT NULL DEFAULT 1,
        block_index INTEGER NOT NULL,
        char_start INTEGER NOT NULL,
        char_end INTEGER NOT NULL,
        content TEXT NOT NULL,
        is_dialogue INTEGER NOT NULL DEFAULT 0,
        speaker_candidate TEXT,
        chunk_group_id TEXT,
        created_at TEXT NOT NULL,
        FOREIGN KEY (unit_id) REFERENCES source_units (id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_source_blocks_lookup ON source_blocks (unit_id, block_index);
      CREATE INDEX IF NOT EXISTS idx_source_blocks_series ON source_blocks (series_id, source_id);

      CREATE TABLE IF NOT EXISTS story_beats (
        id TEXT PRIMARY KEY,
        source_id TEXT NOT NULL,
        source_unit_id TEXT,
        series_id TEXT NOT NULL,
        beat_order INTEGER NOT NULL,
        name TEXT NOT NULL,
        description TEXT NOT NULL,
        participating_characters_json TEXT NOT NULL DEFAULT '[]',
        location_id TEXT,
        story_time TEXT,
        is_flashback INTEGER NOT NULL DEFAULT 0,
        preconditions_json TEXT NOT NULL DEFAULT '{}',
        post_state_changes_json TEXT NOT NULL DEFAULT '{}',
        source_citations_json TEXT NOT NULL DEFAULT '[]',
        source_span_start INTEGER,
        source_span_end INTEGER,
        is_mandatory INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_story_beats_lookup ON story_beats (series_id, source_id, beat_order);
      CREATE INDEX IF NOT EXISTS idx_story_beats_unit ON story_beats (source_unit_id, beat_order);

      CREATE TABLE IF NOT EXISTS story_threads (
        id TEXT PRIMARY KEY,
        series_id TEXT NOT NULL,
        name TEXT NOT NULL,
        thread_type TEXT NOT NULL DEFAULT 'main',
        description TEXT NOT NULL,
        setup_beat_id TEXT,
        payoff_beat_id TEXT,
        status TEXT NOT NULL DEFAULT 'open',
        dependencies_json TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_story_threads_lookup ON story_threads (series_id, status);

      CREATE TABLE IF NOT EXISTS knowledge_states (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        series_id TEXT NOT NULL,
        fact_key TEXT NOT NULL,
        fact_type TEXT NOT NULL,
        entity_id TEXT,
        revealed_at_episode INTEGER,
        revealed_at_beat_id TEXT,
        is_flashback INTEGER NOT NULL DEFAULT 0,
        notes TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_knowledge_states_lookup ON knowledge_states (series_id, fact_type, entity_id);

      CREATE TABLE IF NOT EXISTS series_plans (
        id TEXT PRIMARY KEY,
        series_id TEXT NOT NULL,
        source_id TEXT NOT NULL,
        revision INTEGER NOT NULL DEFAULT 1,
        target_episodes INTEGER NOT NULL,
        target_duration_per_episode_sec REAL NOT NULL,
        pacing_preset TEXT NOT NULL DEFAULT 'standard',
        status TEXT NOT NULL DEFAULT 'draft',
        warnings_json TEXT NOT NULL DEFAULT '[]',
        summary_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_series_plans_lookup ON series_plans (series_id, source_id, status);

      CREATE TABLE IF NOT EXISTS planned_episodes (
        id TEXT PRIMARY KEY,
        plan_id TEXT NOT NULL,
        series_id TEXT NOT NULL,
        episode_number INTEGER NOT NULL,
        title TEXT NOT NULL,
        logline TEXT NOT NULL,
        goal TEXT,
        opening TEXT,
        development TEXT,
        climax TEXT,
        ending TEXT,
        target_duration_sec REAL NOT NULL,
        state_in_json TEXT NOT NULL DEFAULT '{}',
        planned_state_out_json TEXT NOT NULL DEFAULT '{}',
        dependencies_json TEXT NOT NULL DEFAULT '[]',
        estimated_scenes INTEGER NOT NULL DEFAULT 0,
        estimated_shots INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        FOREIGN KEY (plan_id) REFERENCES series_plans (id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_planned_episodes_lookup ON planned_episodes (plan_id, episode_number);
      CREATE INDEX IF NOT EXISTS idx_planned_episodes_series ON planned_episodes (series_id, episode_number);

      CREATE TABLE IF NOT EXISTS coverage_ledgers (
        id TEXT PRIMARY KEY,
        plan_id TEXT NOT NULL,
        series_id TEXT NOT NULL,
        source_id TEXT NOT NULL,
        source_unit_id TEXT NOT NULL,
        source_block_id TEXT,
        episode_number INTEGER,
        scene_number INTEGER,
        adaptation_decision TEXT NOT NULL DEFAULT 'kept',
        rationale TEXT,
        mandatory_beat_id TEXT,
        beat_id TEXT,
        scene_id TEXT,
        shot_id TEXT,
        stage TEXT DEFAULT 'allocated_to_episode',
        created_at TEXT NOT NULL,
        FOREIGN KEY (plan_id) REFERENCES series_plans (id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_coverage_ledgers_lookup ON coverage_ledgers (plan_id, source_unit_id, episode_number);
      CREATE INDEX IF NOT EXISTS idx_coverage_ledgers_series ON coverage_ledgers (series_id, source_id);

      -- Novel Analysis Review Queue (PR3)
      CREATE TABLE IF NOT EXISTS analysis_review_queue (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        series_id TEXT NOT NULL,
        source_id TEXT,
        data_json TEXT NOT NULL,
        confidence_score REAL NOT NULL DEFAULT 1.0,
        reasons_json TEXT NOT NULL DEFAULT '[]',
        status TEXT NOT NULL DEFAULT 'pending',
        reviewed_at TEXT,
        review_notes TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_analysis_review_lookup ON analysis_review_queue (series_id, status);
    `);

    // Safe column additions if tables already existed
    this.addColumnIfMissing("ALTER TABLE story_beats ADD COLUMN source_span_start INTEGER;");
    this.addColumnIfMissing("ALTER TABLE story_beats ADD COLUMN source_span_end INTEGER;");
    this.addColumnIfMissing("ALTER TABLE coverage_ledgers ADD COLUMN beat_id TEXT;");
    this.addColumnIfMissing("ALTER TABLE coverage_ledgers ADD COLUMN scene_id TEXT;");
    this.addColumnIfMissing("ALTER TABLE coverage_ledgers ADD COLUMN shot_id TEXT;");
    this.addColumnIfMissing("ALTER TABLE coverage_ledgers ADD COLUMN stage TEXT DEFAULT 'allocated_to_episode';");
  }

  public addColumnIfMissing(sql: string): void {
    const ctx = this.session();
    if (!ctx.db) {
      if (!ctx.isFallback) throw new WorkflowError("SQLITE_CONNECTION_REQUIRED", "SQLITE_CONNECTION_REQUIRED", "failed");
      return;
    }
    try {
      ctx.db.exec(sql);
    } catch (error) {
      if (!(error instanceof Error) || !/duplicate column name/i.test(error.message)) throw error;
    }
  }

public applyV7Migration(): void {
    const ctx=this.session();
    if (!ctx.db) return;
    ctx.db.exec(`
      CREATE TABLE IF NOT EXISTS chekhov_guns (
        id TEXT PRIMARY KEY,
        series_id TEXT NOT NULL,
        name TEXT NOT NULL,
        type TEXT NOT NULL,
        description TEXT NOT NULL,
        planted_at_episode INTEGER NOT NULL,
        planted_in_beat_id TEXT,
        payoff_status TEXT NOT NULL DEFAULT 'planted',
        payoff_episode INTEGER,
        payoff_beat_id TEXT,
        dormant_episodes_count INTEGER DEFAULT 0,
        last_active_episode INTEGER,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_chekhov_guns_lookup ON chekhov_guns (series_id, payoff_status);
    `);
    this.addColumnIfMissing("ALTER TABLE chekhov_guns ADD COLUMN last_active_episode INTEGER;");
  }

public applyV8Migration(): void {
    const ctx=this.session();
    if (!ctx.db) return;
    ctx.db.exec(`
      CREATE TABLE IF NOT EXISTS source_revisions (
        id TEXT PRIMARY KEY,
        source_id TEXT NOT NULL,
        series_id TEXT NOT NULL,
        revision INTEGER NOT NULL,
        content_hash TEXT NOT NULL,
        raw_text TEXT NOT NULL,
        normalized_text TEXT NOT NULL,
        normalization_rules_json TEXT NOT NULL DEFAULT '{}',
        metadata_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        FOREIGN KEY (source_id) REFERENCES source_works (id) ON DELETE CASCADE
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_source_revisions_unique ON source_revisions (source_id, revision);
      CREATE INDEX IF NOT EXISTS idx_source_revisions_series ON source_revisions (series_id, source_id);
    `);
  }

  public applySchemaSql() {
    const ctx = this.session();
    if (!ctx.db) {
      if (!ctx.isFallback) throw new WorkflowError("SQLITE_CONNECTION_REQUIRED", "SQLITE_CONNECTION_REQUIRED", "failed");
      return;
    }
    const schemaSql = `
      CREATE TABLE IF NOT EXISTS series_metadata (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        genre TEXT,
        visual_style TEXT NOT NULL,
        negative_prompt TEXT,
        aspect_ratio TEXT NOT NULL DEFAULT '9:16',
        fps INTEGER NOT NULL DEFAULT 30,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS characters (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        role TEXT NOT NULL,
        visual_summary TEXT NOT NULL,
        personality_traits TEXT NOT NULL,
        voice_profile_id TEXT,
        voice_embedding_path TEXT,
        status TEXT NOT NULL DEFAULT 'alive',
        face_reference_image TEXT,
        character_sheet_path TEXT,
        current_wardrobe_id TEXT,
        distinguishing_marks TEXT
      );
      CREATE TABLE IF NOT EXISTS character_wardrobes (
        id TEXT PRIMARY KEY,
        character_id TEXT NOT NULL,
        outfit_name TEXT NOT NULL,
        visual_description TEXT NOT NULL,
        reference_image_path TEXT,
        is_default INTEGER NOT NULL DEFAULT 0,
        FOREIGN KEY (character_id) REFERENCES characters (id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS locations (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        visual_summary TEXT NOT NULL,
        atmospheric_rules TEXT,
        reference_image_path TEXT,
        lighting_mood TEXT,
        series_id TEXT
      );
      CREATE TABLE IF NOT EXISTS key_props (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        visual_summary TEXT NOT NULL,
        current_holder_id TEXT,
        reference_image_path TEXT,
        status TEXT NOT NULL DEFAULT 'intact',
        series_id TEXT
      );
      CREATE TABLE IF NOT EXISTS character_knowledge (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        character_id TEXT NOT NULL,
        fact_key TEXT NOT NULL,
        revealed_in_episode INTEGER NOT NULL,
        notes TEXT
      );
      CREATE TABLE IF NOT EXISTS world_state (
        key TEXT NOT NULL,
        value_json TEXT NOT NULL,
        updated_at_episode INTEGER NOT NULL,
        series_id TEXT NOT NULL DEFAULT 'default-series',
        PRIMARY KEY (series_id, key)
      );
      CREATE TABLE IF NOT EXISTS episode_summaries (
        episode_number INTEGER NOT NULL,
        series_id TEXT NOT NULL DEFAULT 'default-series',
        title TEXT NOT NULL,
        logline TEXT NOT NULL,
        major_events_json TEXT NOT NULL,
        delta_changes_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (series_id, episode_number)
      );
      CREATE TABLE IF NOT EXISTS api_usage_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        series_id TEXT,
        episode_number INTEGER,
        shot_id TEXT,
        provider TEXT NOT NULL,
        type TEXT NOT NULL,
        units REAL NOT NULL,
        cost_usd REAL NOT NULL,
        timestamp TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS shot_takes (
        id TEXT PRIMARY KEY,
        series_id TEXT NOT NULL,
        episode_number INTEGER NOT NULL,
        shot_id TEXT NOT NULL,
        take_number INTEGER NOT NULL DEFAULT 1,
        provider TEXT NOT NULL,
        prompt TEXT NOT NULL,
        seed INTEGER,
        local_path TEXT NOT NULL,
        duration_sec REAL NOT NULL,
        qa_status TEXT NOT NULL DEFAULT 'PASS',
        qa_score REAL,
        qa_notes TEXT,
        is_approved INTEGER NOT NULL DEFAULT 0,
        cost_usd REAL NOT NULL DEFAULT 0.0,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_shot_takes_lookup ON shot_takes (series_id, episode_number, shot_id);

      -- V2: Versioned Canon State Manager Tables
      CREATE TABLE IF NOT EXISTS canon_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS character_states (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        character_id TEXT NOT NULL,
        episode_number INTEGER NOT NULL,
        scene_id TEXT,
        status TEXT NOT NULL DEFAULT 'alive',
        current_wardrobe_id TEXT,
        distinguishing_marks TEXT,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (character_id) REFERENCES characters (id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_character_states_lookup ON character_states (character_id, episode_number);

      CREATE TABLE IF NOT EXISTS prop_states (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        prop_id TEXT NOT NULL,
        episode_number INTEGER NOT NULL,
        scene_id TEXT,
        current_holder_id TEXT,
        status TEXT NOT NULL DEFAULT 'intact',
        updated_at TEXT NOT NULL,
        FOREIGN KEY (prop_id) REFERENCES key_props (id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_prop_states_lookup ON prop_states (prop_id, episode_number);

      CREATE TABLE IF NOT EXISTS location_states (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        location_id TEXT NOT NULL,
        episode_number INTEGER NOT NULL,
        scene_id TEXT,
        atmospheric_rules TEXT,
        lighting_mood TEXT,
        status TEXT NOT NULL DEFAULT 'accessible',
        updated_at TEXT NOT NULL,
        FOREIGN KEY (location_id) REFERENCES locations (id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_location_states_lookup ON location_states (location_id, episode_number);

      CREATE TABLE IF NOT EXISTS state_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        series_id TEXT NOT NULL,
        episode_number INTEGER NOT NULL,
        scene_id TEXT,
        entity_type TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        event_type TEXT NOT NULL,
        from_state_json TEXT,
        to_state_json TEXT NOT NULL,
        story_time TEXT,
        confirmation_source TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_state_events_lookup ON state_events (series_id, episode_number, entity_type, entity_id);

      CREATE TABLE IF NOT EXISTS canon_snapshots (
        id TEXT PRIMARY KEY,
        series_id TEXT NOT NULL,
        episode_number INTEGER NOT NULL,
        snapshot_version INTEGER NOT NULL DEFAULT 1,
        state_hash TEXT NOT NULL,
        snapshot_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_canon_snapshots_lookup ON canon_snapshots (series_id, episode_number);

      CREATE TABLE IF NOT EXISTS episode_lifecycle (
        series_id TEXT NOT NULL,
        episode_number INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'draft',
        snapshot_id TEXT,
        needs_review INTEGER NOT NULL DEFAULT 0,
        review_notes TEXT,
        storyboard_approved_at TEXT,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (series_id, episode_number),
        FOREIGN KEY (snapshot_id) REFERENCES canon_snapshots (id)
      );
      CREATE INDEX IF NOT EXISTS idx_lifecycle_status ON episode_lifecycle (series_id, status);

      CREATE TABLE IF NOT EXISTS applied_commits (
        commit_id TEXT PRIMARY KEY,
        episode_number INTEGER NOT NULL,
        summary_title TEXT NOT NULL,
        applied_at TEXT NOT NULL
      );

      -- V3: Versioned Reference Assets & Storyboard Keyframes
      CREATE TABLE IF NOT EXISTS reference_assets (
        id TEXT PRIMARY KEY,
        series_id TEXT NOT NULL,
        entity_type TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        asset_kind TEXT NOT NULL,
        image_path TEXT NOT NULL,
        version INTEGER NOT NULL DEFAULT 1,
        is_active INTEGER NOT NULL DEFAULT 1,
        description TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_reference_assets_lookup ON reference_assets (series_id, entity_type, entity_id, is_active);

      CREATE TABLE IF NOT EXISTS storyboard_keyframes (
        id TEXT PRIMARY KEY,
        series_id TEXT NOT NULL,
        episode_number INTEGER NOT NULL,
        shot_id TEXT NOT NULL,
        version INTEGER NOT NULL DEFAULT 1,
        composition_layout TEXT NOT NULL,
        camera_framing TEXT NOT NULL,
        image_path TEXT NOT NULL,
        is_approved INTEGER NOT NULL DEFAULT 0,
        used_references_json TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_storyboard_lookup ON storyboard_keyframes (series_id, episode_number, shot_id);

      -- V4: Resilient Provider Jobs & Ledger
      CREATE TABLE IF NOT EXISTS provider_jobs (
        id TEXT PRIMARY KEY,
        series_id TEXT NOT NULL,
        episode_number INTEGER NOT NULL,
        shot_id TEXT NOT NULL,
        provider TEXT NOT NULL,
        model_name TEXT,
        provider_job_id TEXT,
        idempotency_key TEXT,
        spec_hash TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'queued',
        attempt_count INTEGER NOT NULL DEFAULT 1,
        max_attempts INTEGER NOT NULL DEFAULT 3,
        cost_category TEXT NOT NULL DEFAULT 'estimated',
        estimated_cost_usd REAL NOT NULL DEFAULT 0.0,
        reserved_cost_usd REAL NOT NULL DEFAULT 0.0,
        confirmed_cost_usd REAL NOT NULL DEFAULT 0.0,
        uncertain_cost_usd REAL NOT NULL DEFAULT 0.0,
        output_url TEXT,
        output_local_path TEXT,
        error_code TEXT,
        error_message TEXT,
        is_retryable INTEGER NOT NULL DEFAULT 1,
        worker_id TEXT,
        lock_expires_at TEXT,
        metadata_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        completed_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_provider_jobs_lookup ON provider_jobs (series_id, episode_number, shot_id, status);
      CREATE INDEX IF NOT EXISTS idx_provider_jobs_spec ON provider_jobs (spec_hash, status);
      CREATE INDEX IF NOT EXISTS idx_provider_remote_id ON provider_jobs (provider, provider_job_id);

      CREATE TABLE IF NOT EXISTS series_budgets (
        series_id TEXT PRIMARY KEY,
        max_budget_usd REAL NOT NULL DEFAULT 25.0,
        warning_threshold_ratio REAL NOT NULL DEFAULT 0.85,
        is_hard_capped INTEGER NOT NULL DEFAULT 1,
        notes TEXT,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS provider_rate_cards (
        id TEXT PRIMARY KEY,
        provider TEXT NOT NULL,
        model_name TEXT NOT NULL,
        rate_per_sec_usd REAL NOT NULL,
        rate_per_unit_usd REAL,
        unit_type TEXT NOT NULL DEFAULT 'second',
        currency TEXT NOT NULL DEFAULT 'USD',
        effective_date TEXT NOT NULL,
        source_doc_url TEXT,
        notes TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_rate_cards_lookup ON provider_rate_cards (provider, model_name, effective_date);

      -- V9: Persistent LLM token usage telemetry (never stores prompt text or credentials)
      CREATE TABLE IF NOT EXISTS llm_token_usage (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        series_id TEXT NOT NULL,
        provider TEXT NOT NULL,
        model TEXT NOT NULL,
        input_tokens INTEGER NOT NULL,
        output_tokens INTEGER NOT NULL,
        cached_tokens INTEGER NOT NULL DEFAULT 0,
        cache_creation_tokens INTEGER NOT NULL DEFAULT 0,
        estimated_savings_usd REAL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_llm_token_usage_series ON llm_token_usage (series_id, created_at);

      CREATE TABLE IF NOT EXISTS timeline_branches (
        id TEXT PRIMARY KEY,
        series_id TEXT NOT NULL,
        name TEXT NOT NULL,
        description TEXT,
        parent_branch_id TEXT,
        forked_from_snapshot_id TEXT,
        forked_at_episode INTEGER NOT NULL DEFAULT 1,
        is_canonical INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        FOREIGN KEY (forked_from_snapshot_id) REFERENCES canon_snapshots (id)
      );
      CREATE INDEX IF NOT EXISTS idx_timeline_branches_lookup ON timeline_branches (series_id, is_canonical);
      CREATE TABLE IF NOT EXISTS branch_snapshots (
        branch_id TEXT NOT NULL,
        episode_number INTEGER NOT NULL,
        snapshot_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (branch_id, episode_number),
        FOREIGN KEY (branch_id) REFERENCES timeline_branches (id),
        FOREIGN KEY (snapshot_id) REFERENCES canon_snapshots (id)
      );
      CREATE INDEX IF NOT EXISTS idx_branch_snapshots_lookup ON branch_snapshots (branch_id, episode_number);
    `;
    ctx.db.exec(schemaSql);

    // Upgrade legacy tables, ignoring only duplicate-column errors.
    const columnsToEnsure = [
      { name: "face_reference_image", type: "TEXT" },
      { name: "character_sheet_path", type: "TEXT" },
      { name: "current_wardrobe_id", type: "TEXT" },
      { name: "distinguishing_marks", type: "TEXT" },
      { name: "series_id", type: "TEXT" },
      { name: "aliases_json", type: "TEXT" },
      { name: "relationship_graph_json", type: "TEXT" },
      { name: "face_embedding_json", type: "TEXT" },
    ];
    for (const col of columnsToEnsure) {
      this.addColumnIfMissing(`ALTER TABLE characters ADD COLUMN ${col.name} ${col.type};`);
    }

    const shotTakeColumns = [
      { name: "qa_report_json", type: "TEXT" },
      { name: "storyboard_keyframe_id", type: "TEXT" },
      { name: "used_references_json", type: "TEXT" },
    ];
    for (const col of shotTakeColumns) {
      this.addColumnIfMissing(`ALTER TABLE shot_takes ADD COLUMN ${col.name} ${col.type};`);
    }

    this.addColumnIfMissing("ALTER TABLE episode_lifecycle ADD COLUMN storyboard_approved_at TEXT;");
    this.addColumnIfMissing("ALTER TABLE episode_summaries ADD COLUMN series_id TEXT;");
    this.addColumnIfMissing("ALTER TABLE locations ADD COLUMN series_id TEXT;");
    this.addColumnIfMissing("ALTER TABLE key_props ADD COLUMN series_id TEXT;");
    this.addColumnIfMissing("ALTER TABLE world_state ADD COLUMN series_id TEXT;");

    const wsTableInfo = ctx.db.prepare("PRAGMA table_info(world_state);").all() as Array<{ name: string; pk: number }>;
    const wsPkCols = wsTableInfo.filter((c) => c.pk > 0);
    if (wsPkCols.length > 0 && wsPkCols.length < 2) {
      ctx.db.exec(`
        CREATE TABLE IF NOT EXISTS world_state_temp_mig (
          key TEXT NOT NULL,
          value_json TEXT NOT NULL,
          updated_at_episode INTEGER NOT NULL,
          series_id TEXT NOT NULL DEFAULT 'default-series',
          PRIMARY KEY (series_id, key)
        );
        INSERT OR IGNORE INTO world_state_temp_mig
          SELECT key, value_json, updated_at_episode, COALESCE(series_id, 'default-series')
          FROM world_state;
        DROP TABLE world_state;
        ALTER TABLE world_state_temp_mig RENAME TO world_state;
      `);
    }

    const episodeSummaryInfo = ctx.db.prepare("PRAGMA table_info(episode_summaries);").all() as Array<{ name: string; pk: number }>;
    const episodeSummaryPk = episodeSummaryInfo.filter((c) => c.pk > 0);
    if (episodeSummaryPk.length > 0 && episodeSummaryPk.length < 2) {
      ctx.db.exec(`
        CREATE TABLE IF NOT EXISTS episode_summaries_temp_mig (
          episode_number INTEGER NOT NULL,
          series_id TEXT NOT NULL DEFAULT 'default-series',
          title TEXT NOT NULL,
          logline TEXT NOT NULL,
          major_events_json TEXT NOT NULL,
          delta_changes_json TEXT NOT NULL,
          created_at TEXT NOT NULL,
          PRIMARY KEY (series_id, episode_number)
        );
        INSERT OR IGNORE INTO episode_summaries_temp_mig
          SELECT episode_number, COALESCE(series_id, 'default-series'), title, logline, major_events_json, delta_changes_json, created_at
          FROM episode_summaries;
        DROP TABLE episode_summaries;
        ALTER TABLE episode_summaries_temp_mig RENAME TO episode_summaries;
      `);
    }

    ctx.db.exec("CREATE UNIQUE INDEX IF NOT EXISTS uq_episode_summaries_identity ON episode_summaries (series_id, episode_number);");
    this.addColumnIfMissing("ALTER TABLE api_usage_logs ADD COLUMN series_id TEXT;");
    this.applyV6Migration();
    this.applyV7Migration();
    this.applyV8Migration();
  }
}
