import { existsSync, readFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  ContinuityAuditor,
  type ContinuityAuditResult,
  type StoryBiblePayload,
} from "./continuity-auditor.js";

export interface CharacterRecord {
  id: string;
  name: string;
  role: "protagonist" | "antagonist" | "supporting";
  visual_summary: string;
  personality_traits: string[];
  voice_profile_id?: string;
  voice_embedding_path?: string;
  status: "alive" | "injured" | "deceased" | "missing";
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
  character_status_updates?: Array<{ id: string; status: CharacterRecord["status"]; notes?: string }>;
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
    characters: Map<string, CharacterRecord>;
    knowledge: CharacterKnowledgeRecord[];
    world_state: Map<string, { value: unknown; episode: number }>;
    episodes: Map<number, EpisodeSummaryRecord>;
    api_logs: ApiUsageRecord[];
  };

  constructor(dbPath: string = "story_bible.db") {
    this.dbPath = dbPath;
    this.memoryStore = {
      characters: new Map(),
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
      // Dynamic require or import of node:sqlite
      const sqliteModule = (globalThis as any).process?.getBuiltinModule?.("node:sqlite") ||
        eval('import("node:sqlite")');

      // Check if DatabaseSync is available
      const { DatabaseSync } = require("node:sqlite");
      if (DatabaseSync) {
        this.db = new DatabaseSync(this.dbPath);
        this.applySchemaSql();
        return;
      }
    } catch {
      // Graceful fallback to persistent JSON / memory store
      this.isFallback = true;
    }
  }

  private applySchemaSql() {
    const schemaSql = `
      CREATE TABLE IF NOT EXISTS characters (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        role TEXT NOT NULL,
        visual_summary TEXT NOT NULL,
        personality_traits TEXT NOT NULL,
        voice_profile_id TEXT,
        voice_embedding_path TEXT,
        status TEXT NOT NULL DEFAULT 'alive'
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
  }

  // ── Character Operations ──────────────────────────────────────────────────

  public upsertCharacter(char: CharacterRecord): void {
    if (this.db && !this.isFallback) {
      const stmt = this.db.prepare(`
        INSERT INTO characters (id, name, role, visual_summary, personality_traits, voice_profile_id, voice_embedding_path, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          name = excluded.name,
          role = excluded.role,
          visual_summary = excluded.visual_summary,
          personality_traits = excluded.personality_traits,
          voice_profile_id = excluded.voice_profile_id,
          voice_embedding_path = excluded.voice_embedding_path,
          status = excluded.status
      `);
      stmt.run(
        char.id,
        char.name,
        char.role,
        char.visual_summary,
        JSON.stringify(char.personality_traits),
        char.voice_profile_id ?? null,
        char.voice_embedding_path ?? null,
        char.status
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

  public updateCharacterStatus(id: string, status: CharacterRecord["status"]): void {
    if (this.db && !this.isFallback) {
      const stmt = this.db.prepare("UPDATE characters SET status = ? WHERE id = ?");
      stmt.run(status, id);
    } else {
      const char = this.memoryStore.characters.get(id);
      if (char) char.status = status;
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

  /**
   * Applies approved delta changes to the Story Bible after episode completion.
   */
  public applyNarrativeDelta(episodeNumber: number, delta: NarrativeDelta): void {
    // 1. Update character statuses
    if (delta.character_status_updates) {
      for (const update of delta.character_status_updates) {
        this.updateCharacterStatus(update.id, update.status);
      }
    }

    // 2. Add new character knowledge
    if (delta.new_knowledge) {
      for (const k of delta.new_knowledge) {
        this.addKnowledge(k.character_id, k.fact_key, episodeNumber, k.notes);
      }
    }

    // 3. Update world state
    if (delta.world_state_updates) {
      for (const [key, val] of Object.entries(delta.world_state_updates)) {
        this.setWorldState(key, val, episodeNumber);
      }
    }
  }

  // ── Context Prompt Generation & Negative Constraints ─────────────────────

  /**
   * Generates a concise context injection prompt for LLM script generators
   * to ensure narrative coherence before writing a new episode.
   */
  public generateContextPrompt(episodeNumber: number, activeCharacterIds: string[] = []): string {
    const allChars = this.listCharacters();
    const relevantChars = activeCharacterIds.length > 0
      ? allChars.filter((c) => activeCharacterIds.includes(c.id))
      : allChars;

    const charLines = relevantChars.map((c) => {
      const knowledge = this.getCharacterKnowledge(c.id, episodeNumber - 1).map((k) => k.fact_key).join(", ");
      return `- [${c.name} (${c.role}, status: ${c.status})]: ${c.visual_summary} | Tính cách: ${c.personality_traits.join(", ")} | Đã biết: ${knowledge || "chưa có bí mật đáng chú ý"}`;
    });

    const worldState = this.getAllWorldState();
    const worldLines = Object.entries(worldState).map(
      ([k, v]) => `- ${k}: ${typeof v === "object" ? JSON.stringify(v) : v}`
    );

    const negativeConstraints = this.getNegativeConstraints(episodeNumber);

    return `
### STORY BIBLE CONTEXT (Tập ${episodeNumber})
Các nhân vật tham gia:
${charLines.join("\n") || "(Chưa có nhân vật nào trong bible)"}

Trạng thái thế giới hiện tại:
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

    // 2. Secret knowledge checks
    for (const c of allChars) {
      const known = this.getCharacterKnowledge(c.id, episodeNumber - 1).map((k) => k.fact_key);
      if (!known.includes("knows_killer_identity")) {
        constraints.push(`${c.name} CHƯA BIẾT danh tính kẻ sát nhân ở thời điểm này. Không được để nhân vật hành động như thể đã biết.`);
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
      for (const [epNum, summary] of this.memoryStore.episodes.entries()) {
        if (epNum < episodeNumber) {
          episode_summaries.push(summary);
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
   * Runs the Continuity Auditor on a draft script against the Story Bible state.
   */
  public async auditDraftScript(
    episodeNumber: number,
    draftScript: string,
    auditor: ContinuityAuditor = new ContinuityAuditor()
  ): Promise<ContinuityAuditResult> {
    const payload = this.exportBiblePayload(episodeNumber);
    return auditor.auditScript(episodeNumber, payload, draftScript);
  }
}

