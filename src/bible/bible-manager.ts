import { existsSync, readFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";
import {
  ContinuityAuditor,
  type ContinuityAuditResult,
  type StoryBiblePayload,
} from "./continuity-auditor.js";

const nodeRequire = createRequire(import.meta.url);

export interface SeriesMetadataRecord {
  id: string;
  title: string;
  genre?: string;
  visual_style: string;
  negative_prompt?: string;
  aspect_ratio: "9:16" | "16:9";
  fps: number;
  created_at: string;
}

export interface CharacterRecord {
  id: string;
  name: string;
  role: "protagonist" | "antagonist" | "supporting";
  visual_summary: string;
  personality_traits: string[];
  voice_profile_id?: string;
  voice_embedding_path?: string;
  status: "alive" | "injured" | "deceased" | "missing";
  face_reference_image?: string;
  character_sheet_path?: string;
  current_wardrobe_id?: string;
  distinguishing_marks?: string;
}

export interface CharacterWardrobeRecord {
  id: string;
  character_id: string;
  outfit_name: string;
  visual_description: string;
  reference_image_path?: string;
  is_default: boolean;
}

export interface LocationRecord {
  id: string;
  name: string;
  visual_summary: string;
  atmospheric_rules?: string;
  reference_image_path?: string;
  lighting_mood?: string;
}

export interface KeyPropRecord {
  id: string;
  name: string;
  visual_summary: string;
  current_holder_id?: string;
  reference_image_path?: string;
  status: "intact" | "damaged" | "lost" | "destroyed";
}

export interface CharacterKnowledgeRecord {
  character_id: string;
  fact_key: string;
  revealed_in_episode: number;
  notes?: string;
}

export interface EpisodeSummaryRecord {
  episode_number: number;
  title: string;
  logline: string;
  major_events: string[];
  delta_changes: Record<string, unknown>;
  created_at: string;
}

export interface ApiUsageRecord {
  episode_number?: number;
  shot_id?: string;
  provider: string;
  type: "llm" | "video" | "tts";
  units: number;
  cost_usd: number;
  timestamp: string;
}

export interface NarrativeDelta {
  character_status_updates?: Array<{
    id: string;
    status: CharacterRecord["status"];
    notes?: string;
    distinguishing_marks?: string;
  }>;
  character_wardrobe_updates?: Array<{
    character_id: string;
    wardrobe_id: string;
  }>;
  prop_holder_updates?: Array<{
    prop_id: string;
    new_holder_id: string;
    status?: KeyPropRecord["status"];
  }>;
  new_knowledge?: Array<{ character_id: string; fact_key: string; notes?: string }>;
  world_state_updates?: Record<string, unknown>;
  major_events?: string[];
}

/**
 * Story Bible Manager for Episodic AI Series.
 * Implements Phase I of the multi-layer context retention architecture.
 */
export class BibleManager {
  private db: any = null;
  private dbPath: string;
  private isFallback = false;
  private memoryStore: {
    series: SeriesMetadataRecord | null;
    characters: Map<string, CharacterRecord>;
    wardrobes: Map<string, CharacterWardrobeRecord>;
    locations: Map<string, LocationRecord>;
    props: Map<string, KeyPropRecord>;
    knowledge: CharacterKnowledgeRecord[];
    world_state: Map<string, { value: unknown; episode: number }>;
    episodes: Map<number, EpisodeSummaryRecord>;
    api_logs: ApiUsageRecord[];
  };

  constructor(dbPath: string = "story_bible.db") {
    this.dbPath = dbPath;
    this.memoryStore = {
      series: null,
      characters: new Map(),
      wardrobes: new Map(),
      locations: new Map(),
      props: new Map(),
      knowledge: [],
      world_state: new Map(),
      episodes: new Map(),
      api_logs: [],
    };
    this.initDb();
  }

  private initDb() {
    const dir = dirname(this.dbPath);
    if (dir && dir !== "." && !existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    try {
      let DatabaseSync: any;
      const builtin = (process as any).getBuiltinModule?.("node:sqlite");
      if (builtin?.DatabaseSync) {
        DatabaseSync = builtin.DatabaseSync;
      } else {
        const sqlite = nodeRequire("node:sqlite");
        DatabaseSync = sqlite?.DatabaseSync;
      }

      if (DatabaseSync) {
        this.db = new DatabaseSync(this.dbPath);
        this.applySchemaSql();
        return;
      }
      this.isFallback = true;
    } catch {
      // Graceful fallback to persistent JSON / memory store
      this.isFallback = true;
    }
  }

  private applySchemaSql() {
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
        lighting_mood TEXT
      );
      CREATE TABLE IF NOT EXISTS key_props (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        visual_summary TEXT NOT NULL,
        current_holder_id TEXT,
        reference_image_path TEXT,
        status TEXT NOT NULL DEFAULT 'intact'
      );
      CREATE TABLE IF NOT EXISTS character_knowledge (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        character_id TEXT NOT NULL,
        fact_key TEXT NOT NULL,
        revealed_in_episode INTEGER NOT NULL,
        notes TEXT
      );
      CREATE TABLE IF NOT EXISTS world_state (
        key TEXT PRIMARY KEY,
        value_json TEXT NOT NULL,
        updated_at_episode INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS episode_summaries (
        episode_number INTEGER PRIMARY KEY,
        title TEXT NOT NULL,
        logline TEXT NOT NULL,
        major_events_json TEXT NOT NULL,
        delta_changes_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS api_usage_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        episode_number INTEGER,
        shot_id TEXT,
        provider TEXT NOT NULL,
        type TEXT NOT NULL,
        units REAL NOT NULL,
        cost_usd REAL NOT NULL,
        timestamp TEXT NOT NULL
      );
    `;
    this.db.exec(schemaSql);

    // Run safe column migrations on characters table if it was created previously
    const columnsToEnsure = [
      { name: "face_reference_image", type: "TEXT" },
      { name: "character_sheet_path", type: "TEXT" },
      { name: "current_wardrobe_id", type: "TEXT" },
      { name: "distinguishing_marks", type: "TEXT" },
    ];
    for (const col of columnsToEnsure) {
      try {
        this.db.exec(`ALTER TABLE characters ADD COLUMN ${col.name} ${col.type};`);
      } catch {
        // Column already exists or table freshly created
      }
    }
  }

  // ── Series Metadata Operations ────────────────────────────────────────────

  public upsertSeriesMetadata(meta: SeriesMetadataRecord): void {
    if (this.db && !this.isFallback) {
      const stmt = this.db.prepare(`
        INSERT INTO series_metadata (id, title, genre, visual_style, negative_prompt, aspect_ratio, fps, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          title = excluded.title,
          genre = excluded.genre,
          visual_style = excluded.visual_style,
          negative_prompt = excluded.negative_prompt,
          aspect_ratio = excluded.aspect_ratio,
          fps = excluded.fps
      `);
      stmt.run(
        meta.id,
        meta.title,
        meta.genre ?? null,
        meta.visual_style,
        meta.negative_prompt ?? null,
        meta.aspect_ratio,
        meta.fps,
        meta.created_at
      );
    } else {
      this.memoryStore.series = meta;
    }
  }

  public getSeriesMetadata(id?: string): SeriesMetadataRecord | null {
    if (this.db && !this.isFallback) {
      let query = "SELECT * FROM series_metadata";
      const params: any[] = [];
      if (id) {
        query += " WHERE id = ?";
        params.push(id);
      } else {
        query += " LIMIT 1";
      }
      const row = this.db.prepare(query).get(...params);
      return row ? (row as SeriesMetadataRecord) : null;
    }
    return this.memoryStore.series;
  }

  // ── Character Operations ──────────────────────────────────────────────────

  public upsertCharacter(char: CharacterRecord): void {
    if (this.db && !this.isFallback) {
      const stmt = this.db.prepare(`
        INSERT INTO characters (
          id, name, role, visual_summary, personality_traits,
          voice_profile_id, voice_embedding_path, status,
          face_reference_image, character_sheet_path, current_wardrobe_id, distinguishing_marks
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          name = excluded.name,
          role = excluded.role,
          visual_summary = excluded.visual_summary,
          personality_traits = excluded.personality_traits,
          voice_profile_id = excluded.voice_profile_id,
          voice_embedding_path = excluded.voice_embedding_path,
          status = excluded.status,
          face_reference_image = excluded.face_reference_image,
          character_sheet_path = excluded.character_sheet_path,
          current_wardrobe_id = excluded.current_wardrobe_id,
          distinguishing_marks = excluded.distinguishing_marks
      `);
      stmt.run(
        char.id,
        char.name,
        char.role,
        char.visual_summary,
        JSON.stringify(char.personality_traits),
        char.voice_profile_id ?? null,
        char.voice_embedding_path ?? null,
        char.status,
        char.face_reference_image ?? null,
        char.character_sheet_path ?? null,
        char.current_wardrobe_id ?? null,
        char.distinguishing_marks ?? null
      );
    } else {
      this.memoryStore.characters.set(char.id, char);
    }
  }

  public getCharacter(id: string): CharacterRecord | null {
    if (this.db && !this.isFallback) {
      const stmt = this.db.prepare("SELECT * FROM characters WHERE id = ?");
      const row = stmt.get(id);
      if (!row) return null;
      return {
        ...row,
        personality_traits: JSON.parse(row.personality_traits),
      } as CharacterRecord;
    }
    return this.memoryStore.characters.get(id) ?? null;
  }

  public listCharacters(): CharacterRecord[] {
    if (this.db && !this.isFallback) {
      const stmt = this.db.prepare("SELECT * FROM characters ORDER BY role ASC, name ASC");
      const rows = stmt.all();
      return rows.map((r: any) => ({
        ...r,
        personality_traits: JSON.parse(r.personality_traits),
      }));
    }
    return Array.from(this.memoryStore.characters.values());
  }

  public updateCharacterStatus(
    id: string,
    status: CharacterRecord["status"],
    distinguishingMarks?: string
  ): void {
    if (this.db && !this.isFallback) {
      if (distinguishingMarks !== undefined) {
        const stmt = this.db.prepare("UPDATE characters SET status = ?, distinguishing_marks = ? WHERE id = ?");
        stmt.run(status, distinguishingMarks, id);
      } else {
        const stmt = this.db.prepare("UPDATE characters SET status = ? WHERE id = ?");
        stmt.run(status, id);
      }
    } else {
      const char = this.memoryStore.characters.get(id);
      if (char) {
        char.status = status;
        if (distinguishingMarks !== undefined) {
          char.distinguishing_marks = distinguishingMarks;
        }
      }
    }
  }

  // ── Wardrobe Operations ───────────────────────────────────────────────────

  public upsertWardrobe(wardrobe: CharacterWardrobeRecord): void {
    if (this.db && !this.isFallback) {
      const stmt = this.db.prepare(`
        INSERT INTO character_wardrobes (id, character_id, outfit_name, visual_description, reference_image_path, is_default)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          outfit_name = excluded.outfit_name,
          visual_description = excluded.visual_description,
          reference_image_path = excluded.reference_image_path,
          is_default = excluded.is_default
      `);
      stmt.run(
        wardrobe.id,
        wardrobe.character_id,
        wardrobe.outfit_name,
        wardrobe.visual_description,
        wardrobe.reference_image_path ?? null,
        wardrobe.is_default ? 1 : 0
      );
    } else {
      this.memoryStore.wardrobes.set(wardrobe.id, wardrobe);
    }
  }

  public getWardrobe(id: string): CharacterWardrobeRecord | null {
    if (this.db && !this.isFallback) {
      const row = this.db.prepare("SELECT * FROM character_wardrobes WHERE id = ?").get(id);
      if (!row) return null;
      return {
        ...row,
        is_default: Boolean(row.is_default),
      };
    }
    return this.memoryStore.wardrobes.get(id) ?? null;
  }

  public listWardrobesForCharacter(characterId: string): CharacterWardrobeRecord[] {
    if (this.db && !this.isFallback) {
      const rows = this.db.prepare("SELECT * FROM character_wardrobes WHERE character_id = ?").all(characterId);
      return rows.map((r: any) => ({
        ...r,
        is_default: Boolean(r.is_default),
      }));
    }
    return Array.from(this.memoryStore.wardrobes.values()).filter((w) => w.character_id === characterId);
  }

  public setCharacterActiveWardrobe(characterId: string, wardrobeId: string): void {
    if (this.db && !this.isFallback) {
      this.db.prepare("UPDATE characters SET current_wardrobe_id = ? WHERE id = ?").run(wardrobeId, characterId);
    } else {
      const char = this.memoryStore.characters.get(characterId);
      if (char) char.current_wardrobe_id = wardrobeId;
    }
  }

  // ── Location Operations ───────────────────────────────────────────────────

  public upsertLocation(loc: LocationRecord): void {
    if (this.db && !this.isFallback) {
      const stmt = this.db.prepare(`
        INSERT INTO locations (id, name, visual_summary, atmospheric_rules, reference_image_path, lighting_mood)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          name = excluded.name,
          visual_summary = excluded.visual_summary,
          atmospheric_rules = excluded.atmospheric_rules,
          reference_image_path = excluded.reference_image_path,
          lighting_mood = excluded.lighting_mood
      `);
      stmt.run(
        loc.id,
        loc.name,
        loc.visual_summary,
        loc.atmospheric_rules ?? null,
        loc.reference_image_path ?? null,
        loc.lighting_mood ?? null
      );
    } else {
      this.memoryStore.locations.set(loc.id, loc);
    }
  }

  public getLocation(id: string): LocationRecord | null {
    if (this.db && !this.isFallback) {
      const row = this.db.prepare("SELECT * FROM locations WHERE id = ?").get(id);
      return row ? (row as LocationRecord) : null;
    }
    return this.memoryStore.locations.get(id) ?? null;
  }

  public listLocations(): LocationRecord[] {
    if (this.db && !this.isFallback) {
      return this.db.prepare("SELECT * FROM locations ORDER BY name ASC").all() as LocationRecord[];
    }
    return Array.from(this.memoryStore.locations.values());
  }

  // ── Key Prop Operations ───────────────────────────────────────────────────

  public upsertKeyProp(prop: KeyPropRecord): void {
    if (this.db && !this.isFallback) {
      const stmt = this.db.prepare(`
        INSERT INTO key_props (id, name, visual_summary, current_holder_id, reference_image_path, status)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          name = excluded.name,
          visual_summary = excluded.visual_summary,
          current_holder_id = excluded.current_holder_id,
          reference_image_path = excluded.reference_image_path,
          status = excluded.status
      `);
      stmt.run(
        prop.id,
        prop.name,
        prop.visual_summary,
        prop.current_holder_id ?? null,
        prop.reference_image_path ?? null,
        prop.status
      );
    } else {
      this.memoryStore.props.set(prop.id, prop);
    }
  }

  public getKeyProp(id: string): KeyPropRecord | null {
    if (this.db && !this.isFallback) {
      const row = this.db.prepare("SELECT * FROM key_props WHERE id = ?").get(id);
      return row ? (row as KeyPropRecord) : null;
    }
    return this.memoryStore.props.get(id) ?? null;
  }

  public listKeyProps(): KeyPropRecord[] {
    if (this.db && !this.isFallback) {
      return this.db.prepare("SELECT * FROM key_props ORDER BY name ASC").all() as KeyPropRecord[];
    }
    return Array.from(this.memoryStore.props.values());
  }

  public transferKeyProp(propId: string, newHolderId: string, status?: KeyPropRecord["status"]): void {
    if (this.db && !this.isFallback) {
      if (status) {
        this.db.prepare("UPDATE key_props SET current_holder_id = ?, status = ? WHERE id = ?").run(newHolderId, status, propId);
      } else {
        this.db.prepare("UPDATE key_props SET current_holder_id = ? WHERE id = ?").run(newHolderId, propId);
      }
    } else {
      const p = this.memoryStore.props.get(propId);
      if (p) {
        p.current_holder_id = newHolderId;
        if (status) p.status = status;
      }
    }
  }

  // ── Character Knowledge Operations ────────────────────────────────────────

  public addKnowledge(characterId: string, factKey: string, revealedInEpisode: number, notes?: string): void {
    if (this.db && !this.isFallback) {
      const stmt = this.db.prepare(`
        INSERT INTO character_knowledge (character_id, fact_key, revealed_in_episode, notes)
        VALUES (?, ?, ?, ?)
      `);
      stmt.run(characterId, factKey, revealedInEpisode, notes ?? null);
    } else {
      this.memoryStore.knowledge.push({
        character_id: characterId,
        fact_key: factKey,
        revealed_in_episode: revealedInEpisode,
        notes,
      });
    }
  }

  public getCharacterKnowledge(characterId: string, upToEpisode?: number): CharacterKnowledgeRecord[] {
    if (this.db && !this.isFallback) {
      let query = "SELECT * FROM character_knowledge WHERE character_id = ?";
      const params: any[] = [characterId];
      if (upToEpisode !== undefined) {
        query += " AND revealed_in_episode <= ?";
        params.push(upToEpisode);
      }
      query += " ORDER BY revealed_in_episode ASC";
      return this.db.prepare(query).all(...params) as CharacterKnowledgeRecord[];
    }
    return this.memoryStore.knowledge.filter(
      (k) => k.character_id === characterId && (upToEpisode === undefined || k.revealed_in_episode <= upToEpisode)
    );
  }

  // ── World State Operations ────────────────────────────────────────────────

  public setWorldState(key: string, value: unknown, episodeNumber: number): void {
    if (this.db && !this.isFallback) {
      const stmt = this.db.prepare(`
        INSERT INTO world_state (key, value_json, updated_at_episode)
        VALUES (?, ?, ?)
        ON CONFLICT(key) DO UPDATE SET
          value_json = excluded.value_json,
          updated_at_episode = excluded.updated_at_episode
      `);
      stmt.run(key, JSON.stringify(value), episodeNumber);
    } else {
      this.memoryStore.world_state.set(key, { value, episode: episodeNumber });
    }
  }

  public getWorldState(key: string): unknown | null {
    if (this.db && !this.isFallback) {
      const row = this.db.prepare("SELECT value_json FROM world_state WHERE key = ?").get(key);
      return row ? JSON.parse(row.value_json) : null;
    }
    return this.memoryStore.world_state.get(key)?.value ?? null;
  }

  public getAllWorldState(): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    if (this.db && !this.isFallback) {
      const rows = this.db.prepare("SELECT key, value_json FROM world_state").all();
      for (const r of rows) {
        result[r.key] = JSON.parse(r.value_json);
      }
      return result;
    }
    for (const [k, v] of this.memoryStore.world_state.entries()) {
      result[k] = v.value;
    }
    return result;
  }

  // ── Episode Summaries & Delta Ingestion ───────────────────────────────────

  public recordEpisodeSummary(record: EpisodeSummaryRecord): void {
    if (this.db && !this.isFallback) {
      const stmt = this.db.prepare(`
        INSERT INTO episode_summaries (episode_number, title, logline, major_events_json, delta_changes_json, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(episode_number) DO UPDATE SET
          title = excluded.title,
          logline = excluded.logline,
          major_events_json = excluded.major_events_json,
          delta_changes_json = excluded.delta_changes_json,
          created_at = excluded.created_at
      `);
      stmt.run(
        record.episode_number,
        record.title,
        record.logline,
        JSON.stringify(record.major_events),
        JSON.stringify(record.delta_changes),
        record.created_at
      );
    } else {
      this.memoryStore.episodes.set(record.episode_number, record);
    }
  }

  public getEpisodeSummary(episodeNumber: number): EpisodeSummaryRecord | null {
    if (this.db && !this.isFallback) {
      const row = this.db.prepare("SELECT * FROM episode_summaries WHERE episode_number = ?").get(episodeNumber);
      if (!row) return null;
      return {
        episode_number: row.episode_number,
        title: row.title,
        logline: row.logline,
        major_events: JSON.parse(row.major_events_json),
        delta_changes: JSON.parse(row.delta_changes_json),
        created_at: row.created_at,
      };
    }
    return this.memoryStore.episodes.get(episodeNumber) ?? null;
  }

  public listEpisodeSummaries(): EpisodeSummaryRecord[] {
    if (this.db && !this.isFallback) {
      const rows = this.db.prepare("SELECT * FROM episode_summaries ORDER BY episode_number ASC").all();
      return rows.map((r: any) => ({
        episode_number: r.episode_number,
        title: r.title,
        logline: r.logline,
        major_events: JSON.parse(r.major_events_json),
        delta_changes: JSON.parse(r.delta_changes_json),
        created_at: r.created_at,
      }));
    }
    return Array.from(this.memoryStore.episodes.values()).sort((a, b) => a.episode_number - b.episode_number);
  }

  /**
   * Applies approved delta changes to the Story Bible after episode completion.
   */
  public applyNarrativeDelta(episodeNumber: number, delta: NarrativeDelta): void {
    // 1. Update character statuses & distinguishing marks
    if (delta.character_status_updates) {
      for (const update of delta.character_status_updates) {
        this.updateCharacterStatus(update.id, update.status, update.distinguishing_marks);
      }
    }

    // 2. Update character wardrobes
    if (delta.character_wardrobe_updates) {
      for (const w of delta.character_wardrobe_updates) {
        this.setCharacterActiveWardrobe(w.character_id, w.wardrobe_id);
      }
    }

    // 3. Update key prop holders / status
    if (delta.prop_holder_updates) {
      for (const p of delta.prop_holder_updates) {
        this.transferKeyProp(p.prop_id, p.new_holder_id, p.status);
      }
    }

    // 4. Add new character knowledge
    if (delta.new_knowledge) {
      for (const k of delta.new_knowledge) {
        this.addKnowledge(k.character_id, k.fact_key, episodeNumber, k.notes);
      }
    }

    // 5. Update world state
    if (delta.world_state_updates) {
      for (const [key, val] of Object.entries(delta.world_state_updates)) {
        this.setWorldState(key, val, episodeNumber);
      }
    }
  }

  // ── Context Prompt Generation & Negative Constraints ─────────────────────

  /**
   * Generates a concise context injection prompt for LLM script generators
   * to ensure narrative and visual coherence before writing or normalizing a new episode.
   */
  public generateContextPrompt(episodeNumber: number, activeCharacterIds: string[] = []): string {
    const series = this.getSeriesMetadata();
    const allChars = this.listCharacters();
    const relevantChars = activeCharacterIds.length > 0
      ? allChars.filter((c) => activeCharacterIds.includes(c.id))
      : allChars;

    const charLines = relevantChars.map((c) => {
      const knowledge = this.getCharacterKnowledge(c.id, episodeNumber - 1).map((k) => k.fact_key).join(", ");
      const activeWardrobe = c.current_wardrobe_id ? this.getWardrobe(c.current_wardrobe_id) : null;
      const wardrobeDesc = activeWardrobe ? `Trang phục hiện tại: [${activeWardrobe.outfit_name}] ${activeWardrobe.visual_description}` : "Trang phục mặc định";
      const marksDesc = c.distinguishing_marks ? ` | Dấu hiệu nhận dạng: ${c.distinguishing_marks}` : "";
      return `- [${c.name} (${c.role}, status: ${c.status})]: ${c.visual_summary}${marksDesc} | ${wardrobeDesc} | Tính cách: ${c.personality_traits.join(", ")} | Đã biết: ${knowledge || "chưa có bí mật đáng chú ý"}`;
    });

    const locations = this.listLocations().map(
      (l) => `- [${l.name} (${l.id})]: ${l.visual_summary}${l.atmospheric_rules ? ` (Khí quyển: ${l.atmospheric_rules})` : ""}`
    );

    const keyProps = this.listKeyProps().map((p) => {
      const holder = p.current_holder_id ? (this.getCharacter(p.current_holder_id)?.name ?? p.current_holder_id) : "chưa rõ";
      return `- [${p.name} (${p.id})]: ${p.visual_summary} (Hiện do ${holder} nắm giữ, trạng thái: ${p.status})`;
    });

    const worldState = this.getAllWorldState();
    const worldLines = Object.entries(worldState).map(
      ([k, v]) => `- ${k}: ${typeof v === "object" ? JSON.stringify(v) : v}`
    );

    const negativeConstraints = this.getNegativeConstraints(episodeNumber);

    return `
### STORY BIBLE CONTEXT (Tập ${episodeNumber})
${series ? `PHONG CÁCH THỊ GIÁC TOÀN SERIES:\n- Phong cách: ${series.visual_style}\n- Tỉ lệ khung hình: ${series.aspect_ratio}\n` : ""}
CÁC NHÂN VẬT THAM GIA:
${charLines.join("\n") || "(Chưa có nhân vật nào trong bible)"}

BỐI CẢNH & ĐỊA ĐIỂM ĐÃ XÁC LẬP:
${locations.join("\n") || "(Chưa có địa điểm định sẵn)"}

ĐẠO CỤ ĐẶC BIỆT & VẬT PHẨM CANON:
${keyProps.join("\n") || "(Không có đạo cụ đặc biệt)"}

TRẠNG THÁI THẾ GIỚI HIỆN TẠI:
${worldLines.join("\n") || "(Thế giới ở trạng thái mặc định)"}

RÀNG BUỘC CỐT TRUYỆN PHỦ ĐỊNH (NGHIÊM CẤM VI PHẠM):
${negativeConstraints.map((c) => `❌ ${c}`).join("\n")}
`.trim();
  }

  /**
   * Returns a list of strict negative constraints that MUST NOT be violated.
   */
  public getNegativeConstraints(episodeNumber: number): string[] {
    const constraints: string[] = [];
    const allChars = this.listCharacters();

    // 1. Deceased or missing characters
    for (const c of allChars) {
      if (c.status === "deceased") {
        constraints.push(`Nhân vật ${c.name} (${c.id}) đã chết, NGHIÊM CẤM xuất hiện ở dòng thời gian hiện tại (chỉ được xuất hiện trong hồi tưởng/flashback nếu có ghi chú rõ).`);
      } else if (c.status === "missing") {
        constraints.push(`Nhân vật ${c.name} (${c.id}) đang mất tích, không thể xuất hiện trong các cuộc họp chung.`);
      }
    }

    // 2. Secret knowledge checks (only if secret facts are tracked in this story)
    let declaredSecretKeys: string[] = [];
    if (this.db && !this.isFallback) {
      try {
        const rows = this.db.prepare("SELECT DISTINCT fact_key FROM character_knowledge").all() as { fact_key: string }[];
        declaredSecretKeys = rows.map((r) => r.fact_key).filter((k) => k === "knows_killer_identity" || k.startsWith("secret:"));
      } catch {
        declaredSecretKeys = [];
      }
    } else {
      declaredSecretKeys = Array.from(
        new Set(
          this.memoryStore.knowledge
            .map((k) => k.fact_key)
            .filter((k) => k === "knows_killer_identity" || k.startsWith("secret:"))
        )
      );
    }

    if (declaredSecretKeys.length > 0) {
      for (const c of allChars) {
        const known = this.getCharacterKnowledge(c.id, episodeNumber - 1).map((k) => k.fact_key);
        for (const secretKey of declaredSecretKeys) {
          if (!known.includes(secretKey)) {
            const desc = secretKey === "knows_killer_identity"
              ? "danh tính kẻ sát nhân"
              : secretKey.replace(/^secret:/, "");
            constraints.push(`${c.name} CHƯA BIẾT ${desc} ở thời điểm này. Không được để nhân vật hành động như thể đã biết.`);
          }
        }
      }
    }

    // 3. Destroyed or lost key props
    const props = this.listKeyProps();
    for (const p of props) {
      if (p.status === "destroyed") {
        constraints.push(`Đạo cụ ${p.name} (${p.id}) đã bị phá hủy hoàn toàn, không thể sử dụng lại.`);
      } else if (p.status === "lost") {
        constraints.push(`Đạo cụ ${p.name} (${p.id}) đang thất lạc, nhân vật không thể tùy ý rút ra dùng.`);
      }
    }

    return constraints;
  }

  // ── Cost Tracking & Budget Guard ─────────────────────────────────────────

  public logApiUsage(record: ApiUsageRecord): void {
    if (this.db && !this.isFallback) {
      const stmt = this.db.prepare(`
        INSERT INTO api_usage_logs (episode_number, shot_id, provider, type, units, cost_usd, timestamp)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);
      stmt.run(
        record.episode_number ?? null,
        record.shot_id ?? null,
        record.provider,
        record.type,
        record.units,
        record.cost_usd,
        record.timestamp
      );
    } else {
      this.memoryStore.api_logs.push(record);
    }
  }

  public getEpisodeCost(episodeNumber: number): number {
    if (this.db && !this.isFallback) {
      const row = this.db.prepare(
        "SELECT SUM(cost_usd) as total_cost FROM api_usage_logs WHERE episode_number = ?"
      ).get(episodeNumber);
      return row?.total_cost ?? 0;
    }
    return this.memoryStore.api_logs
      .filter((l) => l.episode_number === episodeNumber)
      .reduce((sum, l) => sum + l.cost_usd, 0);
  }

  // ── Continuity Auditor Integration ──────────────────────────────────────

  /**
   * Exports the consolidated Story Bible state prior to the target episode.
   */
  public exportBiblePayload(episodeNumber: number): StoryBiblePayload {
    const characters = this.listCharacters();
    const knowledge: CharacterKnowledgeRecord[] = [];
    for (const c of characters) {
      knowledge.push(...this.getCharacterKnowledge(c.id, episodeNumber - 1));
    }
    const world_state = this.getAllWorldState();
    const episode_summaries: EpisodeSummaryRecord[] = [];

    if (this.db && !this.isFallback) {
      const rows = this.db
        .prepare("SELECT * FROM episode_summaries WHERE episode_number < ? ORDER BY episode_number ASC")
        .all(episodeNumber);
      for (const r of rows) {
        episode_summaries.push({
          episode_number: r.episode_number,
          title: r.title,
          logline: r.logline,
          major_events: JSON.parse(r.major_events_json),
          delta_changes: JSON.parse(r.delta_changes_json),
          created_at: r.created_at,
        });
      }
    } else {
      for (const [ep, record] of this.memoryStore.episodes.entries()) {
        if (ep < episodeNumber) {
          episode_summaries.push(record);
        }
      }
      episode_summaries.sort((a, b) => a.episode_number - b.episode_number);
    }

    return {
      characters,
      character_knowledge: knowledge,
      world_state,
      episode_summaries,
    };
  }

  /**
   * Evaluates a draft script against the Story Bible using the ContinuityAuditor.
   */
  public async auditDraftScript(
    episodeNumber: number,
    draftScript: string,
    invoker?: (prompt: string) => Promise<string>
  ): Promise<ContinuityAuditResult> {
    const auditor = new ContinuityAuditor(invoker);
    const biblePayload = this.exportBiblePayload(episodeNumber);
    return auditor.auditScript(episodeNumber, biblePayload, draftScript);
  }

  /**
   * Commits an approved episode to the Story Bible:
   * 1. Records the episode summary & logline.
   * 2. Applies the narrative delta (status changes, newly revealed facts, world changes).
   */
  public commitEpisode(
    summary: EpisodeSummaryRecord,
    delta: NarrativeDelta
  ): void {
    this.recordEpisodeSummary(summary);
    this.applyNarrativeDelta(summary.episode_number, delta);
  }
}
