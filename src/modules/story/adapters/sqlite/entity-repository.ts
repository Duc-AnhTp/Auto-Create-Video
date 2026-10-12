import {log} from '../../../../platform/observability/logger.js';
import { sqlInput } from "../../../../platform/sqlite/values.js";
import { type SeriesMetadataRecord, type CharacterRecord, type CharacterWardrobeRecord, type LocationRecord, type KeyPropRecord, type CharacterKnowledgeRecord, type EpisodeSummaryRecord } from "../../../../contracts/story.js";




import type { DatabaseSession } from "../../../../platform/sqlite/session.js";
import type { EntityRepositoryStore } from "../../ports/entity-repository-store.js";
export class EntityRepository {
constructor(private session:()=>DatabaseSession, private history:Pick<EntityRepositoryStore,"listStateEvents">){}
public upsertSeriesMetadata(meta: SeriesMetadataRecord): void {
const ctx=this.session();

    if (ctx.db && !ctx.isFallback) {
      const stmt = ctx.db.prepare(`
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
        meta.visual_style ?? (meta as any).visualStyle ?? "Cinematic 35mm",
        meta.negative_prompt ?? (meta as any).negativePrompt ?? null,
        meta.aspect_ratio ?? (meta as any).aspectRatio ?? "9:16",
        meta.fps ?? 30,
        meta.created_at ?? (meta as any).createdAt ?? new Date().toISOString()
      );
    } else {
      ctx.memoryStore.series = meta;
    }
  }

public getSeriesMetadata(id?: string): SeriesMetadataRecord | null {
const ctx=this.session();

    if (ctx.db && !ctx.isFallback) {
      let query = "SELECT * FROM series_metadata";
      const params: any[] = [];
      if (id) {
        query += " WHERE id = ?";
        params.push(id);
      } else {
        query += " LIMIT 1";
      }
      const row = ctx.db.prepare(query).get(...params);
      return row ? (row as unknown as SeriesMetadataRecord) : null;
    }
    if (id && ctx.memoryStore.series && ctx.memoryStore.series.id !== id) {
      return null;
    }
    return ctx.memoryStore.series;
  }

public upsertCharacter(char: CharacterRecord): void {
const ctx=this.session();

    if (ctx.db && !ctx.isFallback) {
      const stmt = ctx.db.prepare(`
        INSERT INTO characters (
          id, name, role, visual_summary, personality_traits,
          voice_profile_id, voice_embedding_path, status,
          face_reference_image, character_sheet_path, current_wardrobe_id, distinguishing_marks,
          series_id, aliases_json, relationship_graph_json, face_embedding_json
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
          distinguishing_marks = excluded.distinguishing_marks,
          series_id = coalesce(excluded.series_id, characters.series_id),
          aliases_json = coalesce(excluded.aliases_json, characters.aliases_json),
          relationship_graph_json = coalesce(excluded.relationship_graph_json, characters.relationship_graph_json),
          face_embedding_json = coalesce(excluded.face_embedding_json, characters.face_embedding_json)
      `);
      stmt.run(
        char.id,
        char.name,
        char.role ?? "supporting",
        char.visual_summary || (char as any).visualSummary || (char as any).archetype || char.name,
        JSON.stringify(char.personality_traits ?? []),
        char.voice_profile_id ?? null,
        char.voice_embedding_path ?? null,
        char.status ?? "alive",
        char.face_reference_image ?? null,
        char.character_sheet_path ?? null,
        char.current_wardrobe_id ?? null,
        char.distinguishing_marks ?? null,
        char.series_id ?? null,
        char.aliases_json ?? null,
        char.relationship_graph_json ?? null,
        char.face_embedding_json ?? null
      );
    } else {
      ctx.memoryStore.characters.set(char.id, char);
    }
  }

public getCharacter(id: string, seriesId?: string): CharacterRecord | null {
const ctx=this.session();

    if (ctx.db && !ctx.isFallback) {
      let query = "SELECT * FROM characters WHERE id = ?";
      const params: any[] = [id];
      if (seriesId) {
        query += " AND (series_id = ? OR series_id = 'default-series' OR series_id IS NULL) ORDER BY CASE WHEN series_id = ? THEN 0 ELSE 1 END LIMIT 1";
        params.push(seriesId, seriesId);
      }
      const stmt = ctx.db.prepare(query);
      const row = stmt.get(...params);
      if (!row) return null;
      let parsedTraits: string[] = [];
      if (typeof row.personality_traits === "string" && row.personality_traits.trim().length > 0) {
        try {
          parsedTraits = JSON.parse(row.personality_traits);
        } catch {
          parsedTraits = [];
        }
      } else if (Array.isArray(row.personality_traits)) {
        parsedTraits = row.personality_traits;
      }

      return {
        ...row,
        personality_traits: parsedTraits,
      } as CharacterRecord;
    }
    const char = ctx.memoryStore.characters.get(id);
    if (!char) return null;
    if (seriesId && char.series_id && char.series_id !== seriesId && char.series_id !== "default-series") return null;
    return char;
  }

public listCharacters(seriesId?: string): CharacterRecord[] {
const ctx=this.session();

    const parseTraits = (traits: any): string[] => {
      if (typeof traits === "string" && traits.trim().length > 0) {
        try {
          const parsed = JSON.parse(traits);
          return Array.isArray(parsed) ? parsed : [];
        } catch {
          return [];
        }
      }
      return Array.isArray(traits) ? traits : [];
    };

    if (ctx.db && !ctx.isFallback) {
      if (seriesId) {
        try {
          const stmt = ctx.db.prepare(
            "SELECT * FROM characters WHERE (series_id = ? OR series_id IS NULL OR series_id = 'default-series') ORDER BY role ASC, name ASC"
          );
          const rows = stmt.all(seriesId);
          return rows.map((r: any) => ({
            ...r,
            personality_traits: parseTraits(r.personality_traits),
          }));
        } catch (caughtError) { log.warn("[entity-repository] "+String(caughtError)); }
      }
      const stmt = ctx.db.prepare("SELECT * FROM characters ORDER BY role ASC, name ASC");
      const rows = stmt.all();
      return rows.map((r: any) => ({
        ...r,
        personality_traits: parseTraits(r.personality_traits),
      }));
    }
    const all = Array.from(ctx.memoryStore.characters.values());
    if (seriesId) {
      return all.filter((c) => !c.series_id || c.series_id === seriesId || c.series_id === "default-series");
    }
    return all;
  }

public updateCharacterStatus(
    id: string,
    status: CharacterRecord["status"],
    distinguishingMarks?: string
  ): void {
const ctx=this.session();

    if (ctx.db && !ctx.isFallback) {
      if (distinguishingMarks !== undefined) {
        const stmt = ctx.db.prepare("UPDATE characters SET status = ?, distinguishing_marks = ? WHERE id = ?");
        stmt.run(sqlInput(status), sqlInput(distinguishingMarks), sqlInput(id));
      } else {
        const stmt = ctx.db.prepare("UPDATE characters SET status = ? WHERE id = ?");
        stmt.run(sqlInput(status), sqlInput(id));
      }
    } else {
      const char = ctx.memoryStore.characters.get(id);
      if (char) {
        char.status = status;
        if (distinguishingMarks !== undefined) {
          char.distinguishing_marks = distinguishingMarks;
        }
      }
    }
  }

public upsertWardrobe(wardrobe: CharacterWardrobeRecord): void {
const ctx=this.session();

    if (ctx.db && !ctx.isFallback) {
      const stmt = ctx.db.prepare(`
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
      ctx.memoryStore.wardrobes.set(wardrobe.id, wardrobe);
    }
  }

public getWardrobe(id: string): CharacterWardrobeRecord | null {
const ctx=this.session();

    if (ctx.db && !ctx.isFallback) {
      const row = ctx.db.prepare("SELECT * FROM character_wardrobes WHERE id = ?").get(id);
      if (!row) return null;
      return {
        ...(row as unknown as CharacterWardrobeRecord),
        is_default: Boolean(row.is_default),
      };
    }
    return ctx.memoryStore.wardrobes.get(id) ?? null;
  }

public listWardrobesForCharacter(characterId: string): CharacterWardrobeRecord[] {
const ctx=this.session();

    if (ctx.db && !ctx.isFallback) {
      const rows = ctx.db.prepare("SELECT * FROM character_wardrobes WHERE character_id = ?").all(characterId);
      return rows.map((r: any) => ({
        ...r,
        is_default: Boolean(r.is_default),
      }));
    }
    return Array.from(ctx.memoryStore.wardrobes.values()).filter((w) => w.character_id === characterId);
  }

public getCharacterWardrobe(characterId: string): CharacterWardrobeRecord | null {
    const list = this.listWardrobesForCharacter(characterId);
    return list.find((w) => w.is_default) || list[0] || null;
  }

public setCharacterActiveWardrobe(characterId: string, wardrobeId: string): void {
const ctx=this.session();

    if (ctx.db && !ctx.isFallback) {
      ctx.db.prepare("UPDATE characters SET current_wardrobe_id = ? WHERE id = ?").run(wardrobeId, characterId);
    } else {
      const char = ctx.memoryStore.characters.get(characterId);
      if (char) char.current_wardrobe_id = wardrobeId;
    }
  }

public upsertLocation(loc: LocationRecord): void {
const ctx=this.session();

    if (ctx.db && !ctx.isFallback) {
      const stmt = ctx.db.prepare(`
        INSERT INTO locations (id, name, visual_summary, atmospheric_rules, reference_image_path, lighting_mood, series_id)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          name = excluded.name,
          visual_summary = excluded.visual_summary,
          atmospheric_rules = excluded.atmospheric_rules,
          reference_image_path = excluded.reference_image_path,
          lighting_mood = excluded.lighting_mood,
          series_id = COALESCE(excluded.series_id, locations.series_id)
      `);
      stmt.run(
        loc.id,
        loc.name,
        loc.visual_summary || (loc as any).visualSummary || loc.name,
        loc.atmospheric_rules ?? null,
        loc.reference_image_path ?? null,
        loc.lighting_mood ?? null,
        (loc as any).series_id ?? null
      );
    } else {
      ctx.memoryStore.locations.set(loc.id, loc);
    }
  }

public getLocation(id: string, seriesId?: string): LocationRecord | null {
const ctx=this.session();

    if (ctx.db && !ctx.isFallback) {
      let query = "SELECT * FROM locations WHERE id = ?";
      const params: any[] = [id];
      if (seriesId) {
        query += " AND (series_id = ? OR series_id = 'default-series' OR series_id IS NULL) ORDER BY CASE WHEN series_id = ? THEN 0 ELSE 1 END LIMIT 1";
        params.push(seriesId, seriesId);
      }
      const row = ctx.db.prepare(query).get(...params);
      return row ? (row as unknown as LocationRecord) : null;
    }
    const loc = ctx.memoryStore.locations.get(id) ?? null;
    if (!loc) return null;
    if (seriesId && loc.series_id && loc.series_id !== seriesId && loc.series_id !== "default-series") return null;
    return loc;
  }

public listLocations(seriesId?: string): LocationRecord[] {
const ctx=this.session();

    if (ctx.db && !ctx.isFallback) {
      if (seriesId) {
        try {
          return ctx.db
            .prepare("SELECT * FROM locations WHERE (series_id = ? OR series_id IS NULL) ORDER BY name ASC")
            .all(seriesId) as unknown as LocationRecord[];
        } catch (caughtError) { log.warn("[entity-repository] "+String(caughtError)); }
      }
      return ctx.db.prepare("SELECT * FROM locations ORDER BY name ASC").all() as unknown as LocationRecord[];
    }
    const all = Array.from(ctx.memoryStore.locations.values());
    if (seriesId) {
      return all.filter((l) => !(l as any).series_id || (l as any).series_id === seriesId);
    }
    return all;
  }

public upsertKeyProp(prop: KeyPropRecord): void {
const ctx=this.session();

    if (ctx.db && !ctx.isFallback) {
      const stmt = ctx.db.prepare(`
        INSERT INTO key_props (id, name, visual_summary, current_holder_id, reference_image_path, status, series_id)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          name = excluded.name,
          visual_summary = excluded.visual_summary,
          current_holder_id = excluded.current_holder_id,
          reference_image_path = excluded.reference_image_path,
          status = excluded.status,
          series_id = COALESCE(excluded.series_id, key_props.series_id)
      `);
      stmt.run(
        prop.id,
        prop.name,
        prop.visual_summary || (prop as any).visualSummary || prop.name,
        prop.current_holder_id ?? null,
        prop.reference_image_path ?? null,
        prop.status ?? "intact",
        (prop as any).series_id ?? null
      );
    } else {
      ctx.memoryStore.props.set(prop.id, prop);
    }
  }

public upsertProp(prop: KeyPropRecord): void {
    this.upsertKeyProp(prop);
  }

public getProp(id: string): KeyPropRecord | null {
    return this.getKeyProp(id);
  }

public getPropTransfers(propId: string): Array<{
    prop_id: string;
    from_holder_id?: string | null;
    to_holder_id?: string | null;
    episode_number: number;
    created_at: string;
  }> {
const ctx=this.session();

    if (ctx.db && !ctx.isFallback) {
      const rows = ctx.db
        .prepare(
          `SELECT * FROM state_events WHERE entity_type = 'prop' AND entity_id = ? AND event_type = 'prop_transfer' ORDER BY id ASC`
        )
        .all(propId) as any[];
      return rows.map((r) => {
        let fromHolder = null;
        let toHolder = null;
        try {
          if (r.from_state_json) fromHolder = JSON.parse(r.from_state_json).current_holder_id;
          if (r.to_state_json) toHolder = JSON.parse(r.to_state_json).current_holder_id;
        } catch (caughtError) { log.warn("[entity-repository] "+String(caughtError)); }
        return {
          prop_id: propId,
          from_holder_id: fromHolder,
          to_holder_id: toHolder,
          episode_number: r.episode_number,
          created_at: r.created_at,
        };
      });
    }
    const events = ctx.memoryStore.state_events.filter(
      (e) => e.entity_type === "prop" && e.entity_id === propId && e.event_type === "prop_transfer"
    );
    return events.map((e) => {
      let fromHolder = null;
      let toHolder = null;
      try {
        if (e.from_state_json) fromHolder = JSON.parse(e.from_state_json).current_holder_id;
        if (e.to_state_json) toHolder = JSON.parse(e.to_state_json).current_holder_id;
      } catch (caughtError) { log.warn("[entity-repository] "+String(caughtError)); }
      return {
        prop_id: propId,
        from_holder_id: fromHolder,
        to_holder_id: toHolder,
        episode_number: e.episode_number,
        created_at: e.created_at || new Date().toISOString(),
      };
    });
  }

public getKeyProp(id: string, seriesId?: string): KeyPropRecord | null {
const ctx=this.session();

    if (ctx.db && !ctx.isFallback) {
      let query = "SELECT * FROM key_props WHERE id = ?";
      const params: any[] = [id];
      if (seriesId) {
        query += " AND (series_id = ? OR series_id = 'default-series' OR series_id IS NULL) ORDER BY CASE WHEN series_id = ? THEN 0 ELSE 1 END LIMIT 1";
        params.push(seriesId, seriesId);
      }
      const row = ctx.db.prepare(query).get(...params);
      return row ? (row as unknown as KeyPropRecord) : null;
    }
    const prop = ctx.memoryStore.props.get(id) ?? null;
    if (!prop) return null;
    if (seriesId && prop.series_id && prop.series_id !== seriesId && prop.series_id !== "default-series") return null;
    return prop;
  }

public listKeyProps(seriesId?: string): KeyPropRecord[] {
const ctx=this.session();

    if (ctx.db && !ctx.isFallback) {
      if (seriesId) {
        try {
          return ctx.db
            .prepare("SELECT * FROM key_props WHERE (series_id = ? OR series_id IS NULL) ORDER BY name ASC")
            .all(seriesId) as unknown as KeyPropRecord[];
        } catch (caughtError) { log.warn("[entity-repository] "+String(caughtError)); }
      }
      return ctx.db.prepare("SELECT * FROM key_props ORDER BY name ASC").all() as unknown as KeyPropRecord[];
    }
    const all = Array.from(ctx.memoryStore.props.values());
    if (seriesId) {
      return all.filter((p) => !p.series_id || p.series_id === seriesId);
    }
    return all;
  }

public transferKeyProp(propId: string, newHolderId?: string, status?: KeyPropRecord["status"]): void {
const ctx=this.session();

    if (ctx.db && !ctx.isFallback) {
      if (status && newHolderId !== undefined) {
        ctx.db.prepare("UPDATE key_props SET current_holder_id = ?, status = ? WHERE id = ?").run(newHolderId ?? null, status, propId);
      } else if (status && newHolderId === undefined) {
        ctx.db.prepare("UPDATE key_props SET status = ? WHERE id = ?").run(status, propId);
      } else {
        ctx.db.prepare("UPDATE key_props SET current_holder_id = ? WHERE id = ?").run(newHolderId ?? null, propId);
      }
    } else {
      const p = ctx.memoryStore.props.get(propId);
      if (p) {
        if (newHolderId !== undefined) p.current_holder_id = newHolderId;
        if (status) p.status = status;
      }
    }
  }

public addKnowledge(characterId: string, factKey: string, revealedInEpisode: number, notes?: string): void {
const ctx=this.session();

    if (ctx.db && !ctx.isFallback) {
      const stmt = ctx.db.prepare(`
        INSERT INTO character_knowledge (character_id, fact_key, revealed_in_episode, notes)
        VALUES (?, ?, ?, ?)
      `);
      stmt.run(characterId, factKey, revealedInEpisode, notes ?? null);
    } else {
      ctx.memoryStore.knowledge.push({
        character_id: characterId,
        fact_key: factKey,
        revealed_in_episode: revealedInEpisode,
        notes,
      });
    }
  }

public getCharacterKnowledge(characterId: string, upToEpisode?: number): CharacterKnowledgeRecord[] {
const ctx=this.session();

    if (ctx.db && !ctx.isFallback) {
      let query = "SELECT * FROM character_knowledge WHERE character_id = ?";
      const params: any[] = [characterId];
      if (upToEpisode !== undefined) {
        query += " AND revealed_in_episode <= ?";
        params.push(upToEpisode);
      }
      query += " ORDER BY revealed_in_episode ASC";
      return ctx.db.prepare(query).all(...params) as unknown as CharacterKnowledgeRecord[];
    }
    return ctx.memoryStore.knowledge.filter(
      (k) => k.character_id === characterId && (upToEpisode === undefined || k.revealed_in_episode <= upToEpisode)
    );
  }

public setWorldState(key: string, value: unknown, episodeNumber: number, seriesId?: string): void {
const ctx=this.session();

    const sId = seriesId || this.getSeriesMetadata()?.id || "default-series";
    if (ctx.db && !ctx.isFallback) {
      try {
        const stmt = ctx.db.prepare(`
          INSERT INTO world_state (key, value_json, updated_at_episode, series_id)
          VALUES (?, ?, ?, ?)
          ON CONFLICT(series_id, key) DO UPDATE SET
            value_json = excluded.value_json,
            updated_at_episode = excluded.updated_at_episode
        `);
        stmt.run(key, JSON.stringify(value ?? null), episodeNumber, sId);
      } catch {
        try {
          const stmt = ctx.db.prepare(`
            INSERT INTO world_state (key, value_json, updated_at_episode, series_id)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(key) DO UPDATE SET
              value_json = excluded.value_json,
              updated_at_episode = excluded.updated_at_episode,
              series_id = excluded.series_id
          `);
          stmt.run(key, JSON.stringify(value ?? null), episodeNumber, sId);
        } catch {
          const stmt = ctx.db.prepare(`
            INSERT INTO world_state (key, value_json, updated_at_episode)
            VALUES (?, ?, ?)
            ON CONFLICT(key) DO UPDATE SET
              value_json = excluded.value_json,
              updated_at_episode = excluded.updated_at_episode
          `);
          stmt.run(key, JSON.stringify(value ?? null), episodeNumber);
        }
      }
    } else {
      ctx.memoryStore.world_state.set(`${sId}::${key}`, { value, episode: episodeNumber, seriesId: sId });
      if (!sId || sId === "default-series") {
        ctx.memoryStore.world_state.set(key, { value, episode: episodeNumber, seriesId: sId });
      }
    }
  }

public getWorldState(key: string, seriesId?: string): unknown | null {
const ctx=this.session();

    const sId = seriesId || this.getSeriesMetadata()?.id;
    if (ctx.db && !ctx.isFallback) {
      if (sId) {
        try {
          const row = ctx.db.prepare(
            "SELECT value_json FROM world_state WHERE key = ? AND (series_id = ? OR series_id = 'default-series' OR series_id IS NULL) ORDER BY CASE WHEN series_id = ? THEN 0 ELSE 1 END LIMIT 1"
          ).get(key, sId, sId) as any;
          if (row) {
            try {
              return JSON.parse(row.value_json);
            } catch {
              return row.value_json;
            }
          }
        } catch (caughtError) { log.warn("[entity-repository] "+String(caughtError)); }
      }
      const row = ctx.db.prepare("SELECT value_json FROM world_state WHERE key = ?").get(key) as any;
      if (row) {
        try {
          return JSON.parse(row.value_json);
        } catch {
          return row.value_json;
        }
      }
      return null;
    }
    if (sId) {
      const scoped = ctx.memoryStore.world_state.get(`${sId}::${key}`);
      if (scoped) return scoped.value ?? null;
      const def = ctx.memoryStore.world_state.get(`default-series::${key}`);
      if (def) return def.value ?? null;
      return null;
    }
    const mem = ctx.memoryStore.world_state.get(key);
    if (!mem) return null;
    if (mem.seriesId && mem.seriesId !== "default-series") return null;
    return mem.value ?? null;
  }

public getWorldStateForEpisode(seriesId:string,episodeNumber:number):Record<string,unknown> {
const ctx=this.session();

    const state={...this.getAllWorldState(seriesId)},events=this.history.listStateEvents({seriesId,entityType:"world"}).filter(event=>event.episode_number>episodeNumber).reverse();
    const restored=new Set<string>();
    for(const event of events){restored.add(event.entity_id);if(event.from_state_json){try{state[event.entity_id]=JSON.parse(event.from_state_json).value;}catch{delete state[event.entity_id];}}else delete state[event.entity_id];}
    if(ctx.db&&!ctx.isFallback){const future=ctx.db.prepare("SELECT key FROM world_state WHERE (series_id=? OR series_id IS NULL OR series_id='default-series') AND updated_at_episode>?").all(seriesId,episodeNumber) as {key:string}[];for(const row of future)if(!restored.has(row.key))delete state[row.key];}
    else for(const [key,value] of ctx.memoryStore.world_state)if(value.seriesId===seriesId&&value.episode>episodeNumber&&!restored.has(key.split("::").at(-1)!))delete state[key.split("::").at(-1)!];
    return state;
  }

public getAllWorldState(seriesId?: string): Record<string, unknown> {
const ctx=this.session();

    const sId = seriesId || this.getSeriesMetadata()?.id;
    const result: Record<string, unknown> = {};
    if (ctx.db && !ctx.isFallback) {
      if (sId) {
        try {
          const rows = ctx.db.prepare(
            "SELECT key, value_json FROM world_state WHERE series_id = ? OR series_id = 'default-series' OR series_id IS NULL ORDER BY CASE WHEN series_id = ? THEN 1 ELSE 0 END ASC"
          ).all(sId, sId) as any[];
          for (const r of rows) {
            try {
              result[r.key] = JSON.parse(r.value_json);
            } catch {
              result[r.key] = r.value_json;
            }
          }
          return result;
        } catch (caughtError) { log.warn("[entity-repository] "+String(caughtError)); }
      }
      const rows = ctx.db.prepare("SELECT key, value_json FROM world_state").all() as any[];
      for (const r of rows) {
        try {
          result[r.key] = JSON.parse(r.value_json);
        } catch {
          result[r.key] = r.value_json;
        }
      }
      return result;
    }
    // Populate default-series / null first, then override with sId
    for (const [k, v] of ctx.memoryStore.world_state.entries()) {
      const kSeries = k.includes("::") ? k.split("::")[0] : v.seriesId;
      const kName = k.includes("::") ? k.split("::")[1] : k;
      if (!sId || kSeries === "default-series" || !kSeries) {
        result[kName] = v.value;
      }
    }
    if (sId) {
      for (const [k, v] of ctx.memoryStore.world_state.entries()) {
        const kSeries = k.includes("::") ? k.split("::")[0] : v.seriesId;
        const kName = k.includes("::") ? k.split("::")[1] : k;
        if (kSeries === sId) {
          result[kName] = v.value;
        }
      }
    }
    return result;
  }

public recordEpisodeSummary(record: EpisodeSummaryRecord): void {
const ctx=this.session();

    const seriesId = record.series_id || this.getSeriesMetadata()?.id || "default-series";
    if (ctx.db && !ctx.isFallback) {
      const stmt = ctx.db.prepare(`
        INSERT INTO episode_summaries (episode_number, series_id, title, logline, major_events_json, delta_changes_json, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(series_id, episode_number) DO UPDATE SET
          title = excluded.title,
          logline = excluded.logline,
          major_events_json = excluded.major_events_json,
          delta_changes_json = excluded.delta_changes_json,
          created_at = excluded.created_at
      `);
      stmt.run(
        record.episode_number,
        seriesId,
        record.title,
        record.logline ?? null,
        JSON.stringify(record.major_events ?? []),
        JSON.stringify(record.delta_changes ?? {}),
        record.created_at ?? new Date().toISOString()
      );
    } else {
      const rec = { ...record, series_id: seriesId };
      const key = `${seriesId}:${record.episode_number}`;
      ctx.memoryStore.episodes.set(key as any, rec);
    }
  }

public getEpisodeSummary(episodeNumber: number, seriesId?: string): EpisodeSummaryRecord | null {
const ctx=this.session();

    const sId = seriesId || this.getSeriesMetadata()?.id;
    if (ctx.db && !ctx.isFallback) {
      let row: any;
      if (sId) {
        row = ctx.db
          .prepare(
            "SELECT * FROM episode_summaries WHERE (series_id = ? OR series_id IS NULL) AND episode_number = ? ORDER BY CASE WHEN series_id = ? THEN 0 ELSE 1 END ASC LIMIT 1"
          )
          .get(sId, episodeNumber, sId);
      } else {
        row = ctx.db.prepare("SELECT * FROM episode_summaries WHERE episode_number = ?").get(episodeNumber);
      }
      if (!row) return null;
      return {
        series_id: row.series_id ?? sId,
        episode_number: row.episode_number,
        title: row.title,
        logline: row.logline,
        major_events: JSON.parse(row.major_events_json),
        delta_changes: JSON.parse(row.delta_changes_json),
        created_at: row.created_at,
      };
    }
    if (sId) {
      const key = `${sId}:${episodeNumber}`;
      if (ctx.memoryStore.episodes.has(key as any)) {
        return ctx.memoryStore.episodes.get(key as any) ?? null;
      }
    }
    return (
      Array.from(ctx.memoryStore.episodes.values()).find(
        (e) => e.episode_number === episodeNumber && (!sId || !e.series_id || e.series_id === sId)
      ) ?? null
    );
  }

public listEpisodeSummaries(seriesId?: string): EpisodeSummaryRecord[] {
const ctx=this.session();

    const sId = seriesId || this.getSeriesMetadata()?.id;
    if (ctx.db && !ctx.isFallback) {
      let rows: any[];
      if (sId) {
        rows = ctx.db
          .prepare("SELECT * FROM episode_summaries WHERE series_id = ? OR series_id IS NULL ORDER BY episode_number ASC")
          .all(sId);
      } else {
        rows = ctx.db.prepare("SELECT * FROM episode_summaries ORDER BY episode_number ASC").all();
      }
      return rows.map((r: any) => ({
        series_id: r.series_id ?? sId,
        episode_number: r.episode_number,
        title: r.title,
        logline: r.logline,
        major_events: JSON.parse(r.major_events_json),
        delta_changes: JSON.parse(r.delta_changes_json),
        created_at: r.created_at,
      }));
    }
    return Array.from(ctx.memoryStore.episodes.values())
      .filter((e) => !sId || !e.series_id || e.series_id === sId)
      .sort((a, b) => a.episode_number - b.episode_number);
  }
}
