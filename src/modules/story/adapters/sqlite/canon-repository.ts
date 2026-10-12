import {log} from '../../../../platform/observability/logger.js';
import { sqlInput } from "../../../../platform/sqlite/values.js";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { DeltaValidationError,InvalidLifecycleTransitionError,UnauthorizedCanonCommitError,type CanonSnapshotRecord,type CharacterKnowledgeRecord,type CharacterRecord,type CharacterStateRecord,type CharacterWardrobeRecord,type EpisodeLifecycleRecord,type EpisodeLifecycleStatus,type EpisodeSummaryRecord,type KeyPropRecord,type LocationRecord,type LocationStateRecord,type NarrativeDelta,type PropStateRecord,type StateEventRecord } from "../../../../contracts/story.js";
import {
ContinuityAuditor,
type ContinuityAuditResult,
type LlmInvoker,
type StoryBiblePayload,
} from "../../application/continuity-auditor.js";
import type { DatabaseSession } from "../../../../platform/sqlite/session.js";
import type { CanonRepositoryStore } from "../../ports/canon-repository-store.js";
import type { TimelineBranchManager } from "./timeline-branch-manager.js";
export interface CanonRepositorySession extends DatabaseSession {entities: Pick<CanonRepositoryStore, "listCharacters" | "listKeyProps" | "getSeriesMetadata" | "getCharacter" | "updateCharacterStatus" | "setCharacterActiveWardrobe" | "getKeyProp" | "transferKeyProp" | "addKnowledge" | "recordKnowledgeState" | "getWorldState" | "setWorldState" | "getCharacterKnowledge" | "getWardrobe" | "listLocations" | "getWorldStateForEpisode" | "getAllWorldState" | "getLocation" | "recordEpisodeSummary" | "listWardrobesForCharacter" | "listEpisodeSummaries">;branches: TimelineBranchManager; branchCanon:Pick<CanonRepositoryStore,"getSnapshotForEpisode"|"getCanonSnapshot">;}
import {
type ForkBranchOptions,
type MultiverseBranchDiff,
type TimelineBranchRecord
} from "./timeline-branch-manager.js";
const nodeRequire=createRequire(import.meta.url);

export class CanonRepository {
  constructor(private session:()=>CanonRepositorySession){}
  private recordsForEpisode<T extends {id:string}>(records:T[],entityType:"character"|"prop",seriesId:string,episode:number):T[]{
    const historical=new Map(records.map(record=>[record.id,{...record}]));
    const future=this.listStateEvents({seriesId,entityType}).filter(event=>event.episode_number>episode).sort((a,b)=>b.episode_number-a.episode_number||Number(b.id??0)-Number(a.id??0));
    for(const event of future){const record=historical.get(event.entity_id);if(!record)continue;if(!event.from_state_json){historical.delete(event.entity_id);continue;}try{Object.assign(record,JSON.parse(event.from_state_json));}catch{historical.delete(event.entity_id);}}
    return [...historical.values()];
  }
  public listCharactersForEpisode(seriesId:string,episode:number):CharacterRecord[]{return this.recordsForEpisode(this.session().entities.listCharacters(seriesId),"character",seriesId,episode);}
  public listKeyPropsForEpisode(seriesId:string,episode:number):KeyPropRecord[]{return this.recordsForEpisode(this.session().entities.listKeyProps(seriesId),"prop",seriesId,episode);}
public applyNarrativeDelta(
    episodeNumber: number,
    delta: NarrativeDelta,
    options?: {
      seriesId?: string;
      confirmationSource?: StateEventRecord["confirmation_source"];
      storyTime?: string;
      sceneId?: string | null;
    }
  ): void {
    const ctx=this.session();
    const seriesId = options?.seriesId || ctx.entities.getSeriesMetadata()?.id || "default-series";
    const confirmationSource = options?.confirmationSource ?? "pipeline_commit";
    const storyTime = options?.storyTime ?? `Episode ${episodeNumber}`;
    const sceneId = options?.sceneId ?? null;
    const now = new Date().toISOString();

    const d = delta as any;
    // 1. Update character statuses & distinguishing marks
    const charUpdates = d.characterStatusUpdates || d.character_status_updates;
    if (charUpdates && Array.isArray(charUpdates)) {
      for (const update of charUpdates) {
        const id = update.id || update.characterId || update.character_id;
        const status = update.status;
        const marks = update.distinguishingMarks ?? update.distinguishing_marks;

        const prevChar = ctx.entities.getCharacter(id);
        if (prevChar && prevChar.status === "deceased" && status && status !== "deceased") {
          continue;
        }
        const fromState = prevChar
          ? JSON.stringify({ status: prevChar.status, distinguishing_marks: prevChar.distinguishing_marks })
          : null;
        const toState = JSON.stringify({ status, distinguishing_marks: marks ?? prevChar?.distinguishing_marks });

        ctx.entities.updateCharacterStatus(id, status, marks);

        this.setCharacterState({
          character_id: id,
          episode_number: episodeNumber,
          scene_id: sceneId,
          status,
          distinguishing_marks: marks,
          updated_at: now,
        });

        this.recordStateEvent({
          series_id: seriesId,
          episode_number: episodeNumber,
          scene_id: sceneId,
          entity_type: "character",
          entity_id: id,
          event_type: "status_change",
          from_state_json: fromState,
          to_state_json: toState,
          story_time: storyTime,
          confirmation_source: confirmationSource,
          created_at: now,
        });
      }
    }

    // 2. Update character wardrobes
    const wardrobeUpdates = d.wardrobeUpdates || d.character_wardrobe_updates;
    if (wardrobeUpdates && Array.isArray(wardrobeUpdates)) {
      for (const w of wardrobeUpdates) {
        const charId = w.characterId || w.character_id;
        const wardrobeId = w.wardrobeId || w.wardrobe_id;

        const prevChar = ctx.entities.getCharacter(charId);
        const fromState = prevChar ? JSON.stringify({ current_wardrobe_id: prevChar.current_wardrobe_id }) : null;
        const toState = JSON.stringify({ current_wardrobe_id: wardrobeId });

        ctx.entities.setCharacterActiveWardrobe(charId, wardrobeId);

        this.recordStateEvent({
          series_id: seriesId,
          episode_number: episodeNumber,
          scene_id: sceneId,
          entity_type: "character",
          entity_id: charId,
          event_type: "wardrobe_change",
          from_state_json: fromState,
          to_state_json: toState,
          story_time: storyTime,
          confirmation_source: confirmationSource,
          created_at: now,
        });
      }
    }

    // 3. Update key prop holders / status
    const propUpdates = d.propUpdates || d.prop_transfers || d.prop_holder_updates;
    if (propUpdates && Array.isArray(propUpdates)) {
      for (const p of propUpdates) {
        const propId = p.propId || p.prop_id;
        const newHolderId = p.newHolderId || p.new_holder_id || p.to_holder_id || p.toHolderId;
        const newStatus = p.status as KeyPropRecord["status"] | undefined;

        const prevProp = ctx.entities.getKeyProp(propId);
        const fromState = prevProp
          ? JSON.stringify({ current_holder_id: prevProp.current_holder_id, status: prevProp.status })
          : null;
        const toState = JSON.stringify({
          current_holder_id: newHolderId ?? prevProp?.current_holder_id,
          status: newStatus ?? prevProp?.status ?? "intact",
        });

        ctx.entities.transferKeyProp(propId, newHolderId, newStatus);

        this.setPropState({
          prop_id: propId,
          episode_number: episodeNumber,
          scene_id: sceneId,
          current_holder_id: newHolderId,
          status: newStatus ?? prevProp?.status ?? "intact",
          updated_at: now,
        });

        this.recordStateEvent({
          series_id: seriesId,
          episode_number: episodeNumber,
          scene_id: sceneId,
          entity_type: "prop",
          entity_id: propId,
          event_type: "prop_transfer",
          from_state_json: fromState,
          to_state_json: toState,
          story_time: storyTime,
          confirmation_source: confirmationSource,
          created_at: now,
        });
      }
    }

    // 4. Add new character knowledge
    const knowledgeUpdates = d.newKnowledge || d.new_knowledge;
    if (knowledgeUpdates && Array.isArray(knowledgeUpdates)) {
      for (const k of knowledgeUpdates) {
        const charId = k.characterId || k.character_id;
        const factKey = k.factKey || k.fact_key;
        ctx.entities.addKnowledge(charId, factKey, episodeNumber, k.notes);

        try {
          ctx.entities.recordKnowledgeState({
            series_id: seriesId,
            fact_key: factKey,
            fact_type: k.factType || k.fact_type || "secret",
            entity_id: charId,
            revealed_at_episode: episodeNumber,
            notes: k.notes,
          });
        } catch (caughtError) { log.warn("[canon-repository] "+String(caughtError)); }

        this.recordStateEvent({
          series_id: seriesId,
          episode_number: episodeNumber,
          scene_id: sceneId,
          entity_type: "character",
          entity_id: charId,
          event_type: "knowledge_revealed",
          from_state_json: null,
          to_state_json: JSON.stringify({ fact_key: factKey, notes: k.notes }),
          story_time: storyTime,
          confirmation_source: confirmationSource,
          created_at: now,
        });
      }
    }

    // 5. Update world state
    const worldUpdates = d.worldStateUpdates || d.world_state_updates;
    if (worldUpdates) {
      for (const [key, val] of Object.entries(worldUpdates)) {
        const prevVal = ctx.entities.getWorldState(key, seriesId);
        ctx.entities.setWorldState(key, val, episodeNumber, seriesId);

        this.recordStateEvent({
          series_id: seriesId,
          episode_number: episodeNumber,
          scene_id: sceneId,
          entity_type: "world",
          entity_id: key,
          event_type: "world_state",
          from_state_json: prevVal !== null ? JSON.stringify({ value: prevVal }) : null,
          to_state_json: JSON.stringify({ value: val ?? null }),
          story_time: storyTime,
          confirmation_source: confirmationSource,
          created_at: now,
        });
      }
    }
  }

public generateContextPrompt(
    episodeNumber: number,
    activeCharacterIds: string[] = [],
    seriesId?: string
  ): string {
    const ctx=this.session();
    const series = ctx.entities.getSeriesMetadata(seriesId);
    const allChars = seriesId?this.listCharactersForEpisode(seriesId,episodeNumber-1):ctx.entities.listCharacters(seriesId);
    const relevantChars = activeCharacterIds.length > 0
      ? allChars.filter((c) => activeCharacterIds.includes(c.id))
      : allChars;

    const charLines = relevantChars.map((c) => {
      const knowledge = ctx.entities.getCharacterKnowledge(c.id, episodeNumber - 1).map((k) => k.fact_key).join(", ");
      const activeWardrobe = c.current_wardrobe_id ? ctx.entities.getWardrobe(c.current_wardrobe_id) : null;
      const wardrobeDesc = activeWardrobe ? `Trang phục hiện tại: [${activeWardrobe.outfit_name}] ${activeWardrobe.visual_description}` : "Trang phục mặc định";
      const marksDesc = c.distinguishing_marks ? ` | Dấu hiệu nhận dạng: ${c.distinguishing_marks}` : "";
      return `- [${c.name} (${c.role}, status: ${c.status})]: ${c.visual_summary}${marksDesc} | ${wardrobeDesc} | Tính cách: ${(c.personality_traits || []).join(", ")} | Đã biết: ${knowledge || "chưa có bí mật đáng chú ý"}`;
    });

    const locations = ctx.entities.listLocations(seriesId).map(
      (l) => `- [${l.name} (${l.id})]: ${l.visual_summary}${l.atmospheric_rules ? ` (Khí quyển: ${l.atmospheric_rules})` : ""}`
    );

    const keyProps = (seriesId?this.listKeyPropsForEpisode(seriesId,episodeNumber-1):ctx.entities.listKeyProps(seriesId)).map((p) => {
      const holder = p.current_holder_id ? (ctx.entities.getCharacter(p.current_holder_id, seriesId)?.name ?? p.current_holder_id) : "chưa rõ";
      return `- [${p.name} (${p.id})]: ${p.visual_summary} (Hiện do ${holder} nắm giữ, trạng thái: ${p.status})`;
    });

    const worldState = seriesId?ctx.entities.getWorldStateForEpisode(seriesId,episodeNumber-1):ctx.entities.getAllWorldState();
    const worldLines = Object.entries(worldState).map(
      ([k, v]) => `- ${k}: ${typeof v === "object" ? JSON.stringify(v) : v}`
    );

    const negativeConstraints = this.getNegativeConstraints(episodeNumber, seriesId);

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

public getNegativeConstraints(episodeNumber: number, seriesId?: string): string[] {
    const ctx=this.session();
    const constraints: string[] = [];
    const allChars = seriesId?this.listCharactersForEpisode(seriesId,episodeNumber-1):ctx.entities.listCharacters(seriesId);

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
    if (ctx.db && !ctx.isFallback) {
      try {
        let query = "SELECT DISTINCT ck.fact_key FROM character_knowledge ck";
        const params: any[] = [];
        if (seriesId) {
          query += " JOIN characters c ON ck.character_id = c.id WHERE (c.series_id = ? OR c.series_id IS NULL)";
          params.push(seriesId);
        }
        const rows = ctx.db.prepare(query).all(...params) as { fact_key: string }[];
        declaredSecretKeys = rows.map((r) => r.fact_key).filter((k) => k === "knows_killer_identity" || k.startsWith("secret:"));
      } catch {
        declaredSecretKeys = [];
      }
    } else {
      const allowedCharIds = new Set(allChars.map((c) => c.id));
      declaredSecretKeys = Array.from(
        new Set(
          ctx.memoryStore.knowledge
            .filter((k) => !seriesId || allowedCharIds.has(k.character_id))
            .map((k) => k.fact_key)
            .filter((k) => k === "knows_killer_identity" || k.startsWith("secret:"))
        )
      );
    }

    if (declaredSecretKeys.length > 0) {
      for (const c of allChars) {
        const known = ctx.entities.getCharacterKnowledge(c.id, episodeNumber - 1).map((k) => k.fact_key);
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
    const props = seriesId?this.listKeyPropsForEpisode(seriesId,episodeNumber-1):ctx.entities.listKeyProps(seriesId);
    for (const p of props) {
      if (p.status === "destroyed") {
        constraints.push(`Đạo cụ ${p.name} (${p.id}) đã bị phá hủy hoàn toàn, không thể sử dụng lại.`);
      } else if (p.status === "lost") {
        constraints.push(`Đạo cụ ${p.name} (${p.id}) đang thất lạc, nhân vật không thể tùy ý rút ra dùng.`);
      }
    }

    return constraints;
  }

public exportBiblePayload(episodeNumber: number, seriesId?: string): StoryBiblePayload {
    const ctx=this.session();
    const sId = seriesId || ctx.entities.getSeriesMetadata()?.id;
    const characters = sId?this.listCharactersForEpisode(sId,episodeNumber-1):ctx.entities.listCharacters();
    const knowledge: CharacterKnowledgeRecord[] = [];
    for (const c of characters) {
      knowledge.push(...ctx.entities.getCharacterKnowledge(c.id, episodeNumber - 1));
    }
    const world_state = sId?ctx.entities.getWorldStateForEpisode(sId,episodeNumber-1):ctx.entities.getAllWorldState();
    const episode_summaries: EpisodeSummaryRecord[] = [];

    if (ctx.db && !ctx.isFallback) {
      const rows = sId
        ? ctx.db
            .prepare(
              "SELECT * FROM episode_summaries WHERE (series_id = ? OR series_id IS NULL) AND episode_number < ? ORDER BY episode_number ASC"
            )
            .all(sId, episodeNumber)
        : ctx.db
            .prepare("SELECT * FROM episode_summaries WHERE episode_number < ? ORDER BY episode_number ASC")
            .all(episodeNumber);
      for (const r of rows as any[]) {
        episode_summaries.push({
          series_id: r.series_id ?? sId,
          episode_number: r.episode_number,
          title: r.title,
          logline: r.logline,
          major_events: JSON.parse(r.major_events_json),
          delta_changes: JSON.parse(r.delta_changes_json),
          created_at: r.created_at,
        });
      }
    } else {
      for (const record of ctx.memoryStore.episodes.values()) {
        if (record.episode_number < episodeNumber && (!sId || !record.series_id || record.series_id === sId)) {
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

public async auditDraftScript(
    episodeNumber: number,
    draftScript: string,
    invoker?: LlmInvoker | { llmInvoker?: LlmInvoker; promptTemplate?: string }
  ): Promise<ContinuityAuditResult> {
    const ctx=this.session();
    const auditor = new ContinuityAuditor(
      typeof invoker === "function" ? { llmInvoker: invoker } : invoker
    );
    const biblePayload = this.exportBiblePayload(episodeNumber);
    return auditor.auditScript(episodeNumber, biblePayload, draftScript);
  }

public validateNarrativeDelta(
    delta: NarrativeDelta,
    seriesId?: string
  ): { valid: boolean; errors: string[] } {
    const ctx=this.session();
    const errors: string[] = [];
    const d = delta as any;
    const targetSeriesId = seriesId || d.seriesId || d.series_id;

    // 1. Validate character status updates
    const charUpdates = d.characterStatusUpdates || d.character_status_updates;
    if (charUpdates && Array.isArray(charUpdates)) {
      for (const update of charUpdates) {
        const id = update.id || update.characterId || update.character_id;
        if (!id) {
          errors.push("Character status update missing character id.");
          continue;
        }
        const char = ctx.entities.getCharacter(id, targetSeriesId);
        if (!char) {
          errors.push(`Character status update refers to non-existent character '${id}'.`);
        } else {
          const newStatus = update.status || update.newStatus || update.new_status;
          if (char.status === "deceased" && newStatus && newStatus !== "deceased") {
            errors.push(`Anti-Resurrection gate: Cannot resurrect deceased character '${char.name || id}' to '${newStatus}'.`);
          }
        }
      }
    }

    // 2. Validate wardrobe updates
    const wardrobeUpdates = d.wardrobeUpdates || d.character_wardrobe_updates;
    if (wardrobeUpdates && Array.isArray(wardrobeUpdates)) {
      for (const w of wardrobeUpdates) {
        const charId = w.characterId || w.character_id;
        const wardrobeId = w.wardrobeId || w.wardrobe_id;
        const char = ctx.entities.getCharacter(charId, targetSeriesId);
        if (!char) {
          errors.push(`Wardrobe update refers to non-existent character '${charId}'.`);
        }
        const wardrobe = ctx.entities.getWardrobe(wardrobeId);
        if (!wardrobe) {
          errors.push(`Wardrobe update refers to non-existent wardrobe '${wardrobeId}'.`);
        } else if (wardrobe.character_id !== charId) {
          errors.push(`Wardrobe '${wardrobeId}' does not belong to character '${charId}'.`);
        }
      }
    }

    // 3. Validate prop updates / transfers
    const propUpdates = d.propUpdates || d.prop_transfers || d.prop_holder_updates;
    if (propUpdates && Array.isArray(propUpdates)) {
      for (const p of propUpdates) {
        const propId = p.propId || p.prop_id;
        const newHolderId = p.newHolderId || p.new_holder_id || p.to_holder_id || p.toHolderId;
        if (!propId) {
          errors.push("Prop update missing prop id.");
          continue;
        }
        const prop = ctx.entities.getKeyProp(propId, targetSeriesId);
        if (!prop) {
          errors.push(`Prop transfer refers to non-existent prop '${propId}'.`);
        }
        if (newHolderId) {
          const charHolder = ctx.entities.getCharacter(newHolderId, targetSeriesId);
          const locHolder = ctx.entities.getLocation(newHolderId, targetSeriesId);
          if (!charHolder && !locHolder) {
            errors.push(`New prop holder '${newHolderId}' does not exist as character or location.`);
          } else if (charHolder && charHolder.status === "deceased") {
            errors.push(`Cannot transfer prop '${propId}' to deceased character '${charHolder.name}' (${newHolderId}).`);
          }
        }
      }
    }

    // 4. Validate knowledge additions
    const knowledgeUpdates = d.newKnowledge || d.new_knowledge;
    if (knowledgeUpdates && Array.isArray(knowledgeUpdates)) {
      for (const k of knowledgeUpdates) {
        const charId = k.characterId || k.character_id;
        const char = ctx.entities.getCharacter(charId, targetSeriesId);
        if (!char) {
          errors.push(`Knowledge update refers to non-existent character '${charId}'.`);
        } else if (char.status === "deceased") {
          errors.push(`Cannot add new knowledge to deceased character '${char.name}' (${charId}).`);
        }
      }
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

public isCommitApplied(commitId: string): boolean {
    const ctx=this.session();
    if (ctx.db && !ctx.isFallback) {
      const row = ctx.db.prepare("SELECT commit_id FROM applied_commits WHERE commit_id = ?").get(commitId);
      return Boolean(row);
    }
    return ctx.memoryStore.applied_commits.has(commitId);
  }

public commitEpisode(
    summaryOrOptions:
      | EpisodeSummaryRecord
      | {
          episodeNumber?: number;
          episode_number?: number;
          title?: string;
          logline?: string;
          majorEvents?: string[];
          major_events?: string[];
          delta?: NarrativeDelta;
          delta_changes?: Record<string, unknown>;
          commitId?: string;
          seriesId?: string;
          force?: boolean;
          created_at?: string;
        },
    deltaArg?: NarrativeDelta,
    optionsArg?: {
      commitId?: string;
      seriesId?: string;
      confirmationSource?: StateEventRecord["confirmation_source"];
      storyTime?: string;
      force?: boolean;
    }
  ): { applied: boolean; commitId: string; reason?: string; episode_number: number; title: string } {
    const ctx=this.session();
    const raw: any = summaryOrOptions;
    const epNum = Number(raw.episode_number ?? raw.episodeNumber ?? 1);
    const title = String(raw.title || `Tập ${epNum}`);
    const logline = String(raw.logline || "");
    const majorEvents = raw.major_events || raw.majorEvents || [];

    const seriesId =
      optionsArg?.seriesId ||
      raw.seriesId ||
      raw.series_id ||
      ctx.entities.getSeriesMetadata()?.id ||
      "default-series";

    const summary: EpisodeSummaryRecord = {
      series_id: seriesId,
      episode_number: epNum,
      title,
      logline,
      major_events: majorEvents,
      created_at: raw.created_at || new Date().toISOString(),
    };

    const delta: NarrativeDelta = deltaArg || raw.delta || raw.delta_changes || {};
    const options = {
      commitId: optionsArg?.commitId || raw.commitId,
      seriesId,
      confirmationSource: optionsArg?.confirmationSource,
      storyTime: optionsArg?.storyTime,
      force: optionsArg?.force ?? raw.force,
    };

    // 1. Delta reference validation
    const validation = this.validateNarrativeDelta(delta, seriesId);
    if (!validation.valid) {
      throw new DeltaValidationError(
        `Narrative delta validation failed: ${validation.errors.join("; ")}`,
        validation.errors
      );
    }

    // 2. Commit idempotency check
    const commitId =
      options?.commitId ||
      createHash("sha256")
        .update(
          JSON.stringify({
            series_id: seriesId,
            episode_number: summary.episode_number,
            title: summary.title,
            logline: summary.logline,
            major_events: summary.major_events,
            delta,
          })
        )
        .digest("hex");

    if (this.isCommitApplied(commitId)) {
      return { applied: false, commitId, reason: "already_applied", episode_number: summary.episode_number, title: summary.title };
    }

    // 3. Lifecycle gate: draft/rendered/rejected/failed cannot mutate official canon
    const lifecycle = this.getEpisodeLifecycle(seriesId, summary.episode_number);
    if (!options?.force) {
      if (!lifecycle || lifecycle.status !== "approved") {
        throw new UnauthorizedCanonCommitError(
          `Cannot commit episode ${summary.episode_number} to canon because episode lifecycle status is not 'approved' (current: '${lifecycle?.status || "none"}').`
        );
      }
    }

    // 4. Atomic Transaction execution
    if (ctx.db && !ctx.isFallback) {
      ctx.db.exec("BEGIN IMMEDIATE TRANSACTION;");
      try {
        // Record applied commit for idempotency
        ctx.db
          .prepare(
            "INSERT INTO applied_commits (commit_id, episode_number, summary_title, applied_at) VALUES (?, ?, ?, ?)"
          )
          .run(commitId, summary.episode_number, summary.title, new Date().toISOString());

        // Record episode summary
        ctx.entities.recordEpisodeSummary(summary);

        // Apply delta and record state events
        this.applyNarrativeDelta(summary.episode_number, delta, {
          seriesId,
          confirmationSource: options?.confirmationSource ?? "pipeline_commit",
          storyTime: options?.storyTime,
        });

        // Advance lifecycle to committed
        this.setEpisodeLifecycle({
          seriesId,
          episodeNumber: summary.episode_number,
          status: "committed",
          needsReview: false,
        });

        // Flag downstream episodes if modifying historical canon
        this.invalidateDownstreamEpisodes(
          seriesId,
          summary.episode_number,
          `Canon updated in earlier episode ${summary.episode_number}`
        );

        ctx.db.exec("COMMIT;");
        return { applied: true, commitId, episode_number: summary.episode_number, title: summary.title };
      } catch (err) {
        ctx.db.exec("ROLLBACK;");
        throw err;
      }
    } else {
      // Memory store transactional snapshot
      const backupChars = new Map(Array.from(ctx.memoryStore.characters.entries()).map(([k, v]) => [k, { ...v }]));
      const backupProps = new Map(Array.from(ctx.memoryStore.props.entries()).map(([k, v]) => [k, { ...v }]));
      const backupEpisodes = new Map(ctx.memoryStore.episodes);
      const backupEvents = [...ctx.memoryStore.state_events];
      const backupApplied = new Map(ctx.memoryStore.applied_commits);

      try {
        ctx.memoryStore.applied_commits.set(commitId, {
          commit_id: commitId,
          episode_number: summary.episode_number,
          summary_title: summary.title,
          applied_at: new Date().toISOString(),
        });
        ctx.entities.recordEpisodeSummary(summary);
        this.applyNarrativeDelta(summary.episode_number, delta, {
          seriesId,
          confirmationSource: options?.confirmationSource ?? "pipeline_commit",
          storyTime: options?.storyTime,
        });
        this.setEpisodeLifecycle({
          seriesId,
          episodeNumber: summary.episode_number,
          status: "committed",
          needsReview: false,
        });
        this.invalidateDownstreamEpisodes(
          seriesId,
          summary.episode_number,
          `Canon updated in earlier episode ${summary.episode_number}`
        );
        return { applied: true, commitId, episode_number: summary.episode_number, title: summary.title };
      } catch (err) {
        ctx.memoryStore.characters = backupChars;
        ctx.memoryStore.props = backupProps;
        ctx.memoryStore.episodes = backupEpisodes;
        ctx.memoryStore.state_events = backupEvents;
        ctx.memoryStore.applied_commits = backupApplied;
        throw err;
      }
    }
  }

public recordStateEvent(event: StateEventRecord): void {
    const ctx=this.session();
    const now = event.created_at || new Date().toISOString();
    if (ctx.db && !ctx.isFallback) {
      ctx.db
        .prepare(`
          INSERT INTO state_events (
            series_id, episode_number, scene_id, entity_type, entity_id,
            event_type, from_state_json, to_state_json, story_time,
            confirmation_source, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `)
        .run(
          event.series_id,
          event.episode_number,
          event.scene_id ?? null,
          event.entity_type,
          event.entity_id,
          event.event_type,
          event.from_state_json ?? null,
          event.to_state_json,
          event.story_time ?? null,
          event.confirmation_source || "script_delta",
          now
        );
    } else {
      ctx.memoryStore.state_events.push({
        ...event,
        confirmation_source: event.confirmation_source || "script_delta",
        created_at: now,
      });
    }
  }

public listStateEvents(options?: {
    seriesId?: string;
    episodeNumber?: number;
    entityType?: string;
    entityId?: string;
  }): StateEventRecord[] {
    const ctx=this.session();
    if (ctx.db && !ctx.isFallback) {
      let query = "SELECT * FROM state_events WHERE 1=1";
      const params: any[] = [];
      if (options?.seriesId) {
        query += " AND series_id = ?";
        params.push(options.seriesId);
      }
      if (options?.episodeNumber !== undefined) {
        query += " AND episode_number = ?";
        params.push(options.episodeNumber);
      }
      if (options?.entityType) {
        query += " AND entity_type = ?";
        params.push(options.entityType);
      }
      if (options?.entityId) {
        query += " AND entity_id = ?";
        params.push(options.entityId);
      }
      query += " ORDER BY id ASC";
      return ctx.db.prepare(query).all(...params) as unknown as StateEventRecord[];
    }
    return ctx.memoryStore.state_events.filter((e) => {
      if (options?.seriesId && e.series_id !== options.seriesId) return false;
      if (options?.episodeNumber !== undefined && e.episode_number !== options.episodeNumber) return false;
      if (options?.entityType && e.entity_type !== options.entityType) return false;
      if (options?.entityId && e.entity_id !== options.entityId) return false;
      return true;
    });
  }

public getCharacterArchetype(
    characterId: string
  ): Omit<CharacterRecord, "status" | "current_wardrobe_id" | "distinguishing_marks"> | null {
    const ctx=this.session();
    const char = ctx.entities.getCharacter(characterId);
    if (!char) return null;
    const { status, current_wardrobe_id, distinguishing_marks, ...archetype } = char;
    return archetype;
  }

public getCharacterState(characterId: string, episodeNumber?: number): CharacterStateRecord | null {
    const ctx=this.session();
    if (ctx.db && !ctx.isFallback) {
      let query = "SELECT * FROM character_states WHERE character_id = ?";
      const params: any[] = [characterId];
      if (episodeNumber !== undefined) {
        query += " AND episode_number <= ?";
        params.push(episodeNumber);
      }
      query += " ORDER BY episode_number DESC, id DESC LIMIT 1";
      const row = ctx.db.prepare(query).get(...params);
      return row ? (row as unknown as CharacterStateRecord) : null;
    }
    const matches = ctx.memoryStore.character_states
      .filter((s) => s.character_id === characterId && (episodeNumber === undefined || s.episode_number <= episodeNumber))
      .sort((a, b) => b.episode_number - a.episode_number);
    return matches[0] ?? null;
  }

public setCharacterState(state: CharacterStateRecord): void {
    const ctx=this.session();
    const now = state.updated_at || new Date().toISOString();
    if (ctx.db && !ctx.isFallback) {
      ctx.db
        .prepare(`
          INSERT INTO character_states (character_id, episode_number, scene_id, status, current_wardrobe_id, distinguishing_marks, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `)
        .run(
          sqlInput(state.character_id),
          sqlInput(state.episode_number),
          sqlInput(state.scene_id ?? null),
          sqlInput(state.status),
          sqlInput(state.current_wardrobe_id ?? null),
          sqlInput(state.distinguishing_marks ?? null),
          sqlInput(now)
        );
    } else {
      ctx.memoryStore.character_states.push({ ...state, updated_at: now });
    }
  }

public getPropArchetype(propId: string): Omit<KeyPropRecord, "current_holder_id" | "status"> | null {
    const ctx=this.session();
    const prop = ctx.entities.getKeyProp(propId);
    if (!prop) return null;
    const { current_holder_id, status, ...archetype } = prop;
    return archetype;
  }

public getPropState(propId: string, episodeNumber?: number): PropStateRecord | null {
    const ctx=this.session();
    if (ctx.db && !ctx.isFallback) {
      let query = "SELECT * FROM prop_states WHERE prop_id = ?";
      const params: any[] = [propId];
      if (episodeNumber !== undefined) {
        query += " AND episode_number <= ?";
        params.push(episodeNumber);
      }
      query += " ORDER BY episode_number DESC, id DESC LIMIT 1";
      const row = ctx.db.prepare(query).get(...params);
      return row ? (row as unknown as PropStateRecord) : null;
    }
    const matches = ctx.memoryStore.prop_states
      .filter((s) => s.prop_id === propId && (episodeNumber === undefined || s.episode_number <= episodeNumber))
      .sort((a, b) => b.episode_number - a.episode_number);
    return matches[0] ?? null;
  }

public setPropState(state: PropStateRecord): void {
    const ctx=this.session();
    const now = state.updated_at || new Date().toISOString();
    if (ctx.db && !ctx.isFallback) {
      ctx.db
        .prepare(`
          INSERT INTO prop_states (prop_id, episode_number, scene_id, current_holder_id, status, updated_at)
          VALUES (?, ?, ?, ?, ?, ?)
        `)
        .run(
          sqlInput(state.prop_id),
          sqlInput(state.episode_number),
          sqlInput(state.scene_id ?? null),
          sqlInput(state.current_holder_id ?? null),
          sqlInput(state.status),
          sqlInput(now)
        );
    } else {
      ctx.memoryStore.prop_states.push({ ...state, updated_at: now });
    }
  }

public getLocationArchetype(locationId: string): Omit<LocationRecord, "atmospheric_rules" | "lighting_mood"> | null {
    const ctx=this.session();
    const loc = ctx.entities.getLocation(locationId);
    if (!loc) return null;
    const { atmospheric_rules, lighting_mood, ...archetype } = loc;
    return archetype;
  }

public getLocationState(locationId: string, episodeNumber?: number): LocationStateRecord | null {
    const ctx=this.session();
    if (ctx.db && !ctx.isFallback) {
      let query = "SELECT * FROM location_states WHERE location_id = ?";
      const params: any[] = [locationId];
      if (episodeNumber !== undefined) {
        query += " AND episode_number <= ?";
        params.push(episodeNumber);
      }
      query += " ORDER BY episode_number DESC, id DESC LIMIT 1";
      const row = ctx.db.prepare(query).get(...params);
      return row ? (row as unknown as LocationStateRecord) : null;
    }
    const matches = ctx.memoryStore.location_states
      .filter((s) => s.location_id === locationId && (episodeNumber === undefined || s.episode_number <= episodeNumber))
      .sort((a, b) => b.episode_number - a.episode_number);
    return matches[0] ?? null;
  }

public setLocationState(state: LocationStateRecord): void {
    const ctx=this.session();
    const now = state.updated_at || new Date().toISOString();
    if (ctx.db && !ctx.isFallback) {
      ctx.db
        .prepare(`
          INSERT INTO location_states (location_id, episode_number, scene_id, atmospheric_rules, lighting_mood, status, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `)
        .run(
          state.location_id,
          state.episode_number,
          state.scene_id ?? null,
          state.atmospheric_rules ?? null,
          state.lighting_mood ?? null,
          state.status,
          now
        );
    } else {
      ctx.memoryStore.location_states.push({ ...state, updated_at: now });
    }
  }

public getEpisodeLifecycle(seriesId: string, episodeNumber: number): EpisodeLifecycleRecord | null {
    const ctx=this.session();
    if (ctx.db && !ctx.isFallback) {
      const row = ctx.db
        .prepare("SELECT * FROM episode_lifecycle WHERE series_id = ? AND episode_number = ?")
        .get(seriesId, episodeNumber);
      if (!row) return null;
      return {
        ...row,
        needs_review: Boolean(row.needs_review),
      } as EpisodeLifecycleRecord;
    }
    const key = `${seriesId}:${episodeNumber}`;
    const direct = ctx.memoryStore.episode_lifecycle.get(key);
    if (direct) return direct;
    return null;
  }

public setEpisodeLifecycle(
    recordOrEpisodeNumber:
      | {
          seriesId: string;
          episodeNumber: number;
          status: EpisodeLifecycleStatus;
          snapshotId?: string | null;
          reviewNotes?: string | null;
          needsReview?: boolean;
          storyboardApprovedAt?: string | null;
          storyboard_approved_at?: string | null;
        }
      | number,
    statusPositional?: EpisodeLifecycleStatus,
    reviewNotesPositional?: string | null,
    seriesIdPositional?: string
  ): void {
    const ctx=this.session();
    let record: {
      seriesId: string;
      episodeNumber: number;
      status: EpisodeLifecycleStatus;
      snapshotId?: string | null;
      reviewNotes?: string | null;
      needsReview?: boolean;
      storyboardApprovedAt?: string | null;
    };

    if (typeof recordOrEpisodeNumber === "number") {
      const sId = seriesIdPositional || ctx.entities.getSeriesMetadata()?.id || "default-series";
      record = {
        seriesId: sId,
        episodeNumber: recordOrEpisodeNumber,
        status: statusPositional!,
        reviewNotes: reviewNotesPositional,
      };
    } else {
      record = {
        ...recordOrEpisodeNumber,
        storyboardApprovedAt:
          recordOrEpisodeNumber.storyboardApprovedAt ??
          recordOrEpisodeNumber.storyboard_approved_at,
      };
    }

    const current = this.getEpisodeLifecycle(record.seriesId, record.episodeNumber);
    const now = new Date().toISOString();

    if (current && current.status !== record.status) {
      const from = current.status;
      const to = record.status;

      const validTransitions: Record<EpisodeLifecycleStatus, EpisodeLifecycleStatus[]> = {
        draft: ["approved", "rendered", "rejected", "failed"],
        rendered: ["approved", "rejected", "failed", "draft"],
        approved: ["committed", "rejected", "rendered", "draft"],
        committed: ["rendered", "draft"],
        rejected: ["draft", "rendered"],
        failed: ["draft", "rendered"],
      };

      if (!validTransitions[from].includes(to)) {
        throw new InvalidLifecycleTransitionError(
          `Invalid episode lifecycle transition from '${from}' to '${to}' for episode ${record.episodeNumber}.`
        );
      }
    }

    const needsReviewVal =
      record.needsReview !== undefined
        ? record.needsReview
          ? 1
          : 0
        : current?.needs_review
        ? 1
        : 0;

    const snapshotIdVal =
      record.snapshotId !== undefined ? record.snapshotId : current?.snapshot_id ?? null;

    const reviewNotesVal =
      record.reviewNotes !== undefined ? record.reviewNotes : current?.review_notes ?? null;

    const storyboardApprovedAtVal =
      record.storyboardApprovedAt !== undefined
        ? record.storyboardApprovedAt
        : current?.storyboard_approved_at ?? null;

    if (ctx.db && !ctx.isFallback) {
      const stmt = ctx.db.prepare(`
        INSERT INTO episode_lifecycle (series_id, episode_number, status, snapshot_id, needs_review, review_notes, storyboard_approved_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(series_id, episode_number) DO UPDATE SET
          status = excluded.status,
          snapshot_id = excluded.snapshot_id,
          needs_review = excluded.needs_review,
          review_notes = excluded.review_notes,
          storyboard_approved_at = excluded.storyboard_approved_at,
          updated_at = excluded.updated_at
      `);
      stmt.run(
        record.seriesId,
        record.episodeNumber,
        record.status,
        snapshotIdVal,
        needsReviewVal,
        reviewNotesVal,
        storyboardApprovedAtVal,
        now
      );
    } else {
      const key = `${record.seriesId}:${record.episodeNumber}`;
      ctx.memoryStore.episode_lifecycle.set(key, {
        episode_number: record.episodeNumber,
        series_id: record.seriesId,
        status: record.status,
        snapshot_id: snapshotIdVal,
        needs_review: Boolean(needsReviewVal),
        review_notes: reviewNotesVal,
        storyboard_approved_at: storyboardApprovedAtVal,
        updated_at: now,
      });
    }
  }

public invalidateDownstreamEpisodes(
    seriesId: string,
    fromEpisodeNumber: number,
    reason: string
  ): number {
    const ctx=this.session();
    if (ctx.db && !ctx.isFallback) {
      const result = ctx.db
        .prepare(`
          UPDATE episode_lifecycle
          SET needs_review = 1, review_notes = COALESCE(review_notes || ' | ', '') || ?
          WHERE series_id = ? AND episode_number > ?
        `)
        .run(reason, seriesId, fromEpisodeNumber);
      return Number(result.changes ?? 0);
    } else {
      let count = 0;
      for (const lc of ctx.memoryStore.episode_lifecycle.values()) {
        if (lc.series_id === seriesId && lc.episode_number > fromEpisodeNumber) {
          lc.needs_review = true;
          lc.review_notes = lc.review_notes ? `${lc.review_notes} | ${reason}` : reason;
          count++;
        }
      }
      return count;
    }
  }

public createCanonSnapshot(
    seriesId: string,
    episodeNumber: number,
    snapshotVersion: number = 1,
    branchId?: string
  ): CanonSnapshotRecord {
    const ctx=this.session();
    const targetBranch = branchId ? ctx.branches.getBranch(branchId) : null;
    if (branchId && (!targetBranch || targetBranch.series_id !== seriesId)) {
      throw new Error(`Timeline branch ${branchId} does not belong to series ${seriesId}`);
    }

    const characters = ctx.entities.listCharacters();
    const wardrobes: CharacterWardrobeRecord[] = [];
    for (const c of characters) {
      wardrobes.push(...ctx.entities.listWardrobesForCharacter(c.id));
    }
    const locations = ctx.entities.listLocations();
    const props = ctx.entities.listKeyProps();
    const knowledge: CharacterKnowledgeRecord[] = [];
    for (const c of characters) {
      knowledge.push(...ctx.entities.getCharacterKnowledge(c.id, episodeNumber));
    }
    const world_state = ctx.entities.getAllWorldState();
    const summaries = ctx.entities.listEpisodeSummaries().filter((s) => s.episode_number <= episodeNumber);

    const snapshotData = {
      series_id: seriesId,
      episode_number: episodeNumber,
      snapshot_version: snapshotVersion,
      characters,
      wardrobes,
      locations,
      props,
      character_knowledge: knowledge,
      world_state,
      episode_summaries: summaries,
    };

    const snapshot_json = JSON.stringify(snapshotData);
    const state_hash = createHash("sha256").update(snapshot_json).digest("hex");
    const snapshotId = `snap_${seriesId}_ep${episodeNumber}_v${snapshotVersion}`;
    const now = new Date().toISOString();

    const record: CanonSnapshotRecord = {
      id: snapshotId,
      series_id: seriesId,
      episode_number: episodeNumber,
      snapshot_version: snapshotVersion,
      state_hash,
      snapshot_json,
      created_at: now,
    };

    if (ctx.db && !ctx.isFallback) {
      ctx.db
        .prepare(`
          INSERT INTO canon_snapshots (id, series_id, episode_number, snapshot_version, state_hash, snapshot_json, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            state_hash = excluded.state_hash,
            snapshot_json = excluded.snapshot_json,
            created_at = excluded.created_at
        `)
        .run(snapshotId, seriesId, episodeNumber, snapshotVersion, state_hash, snapshot_json, now);
    } else {
      ctx.memoryStore.canon_snapshots.set(snapshotId, record);
    }

    const currentLifecycle = this.getEpisodeLifecycle(seriesId, episodeNumber);
    if (currentLifecycle) {
      this.setEpisodeLifecycle({
        seriesId,
        episodeNumber,
        status: currentLifecycle.status,
        snapshotId,
      });
    }

    try {
      const snapshotBranch = targetBranch ?? ctx.branches.ensureRootCanonicalBranch(seriesId);
      if (snapshotBranch) {
        ctx.branches.bindSnapshotToBranch(snapshotBranch.id, episodeNumber, snapshotId);
      }
    } catch (caughtError) { log.warn("[canon-repository] "+String(caughtError)); }

    return record;
  }

public getCanonSnapshot(snapshotId: string): CanonSnapshotRecord | null {
    const ctx=this.session();
    if (ctx.db && !ctx.isFallback) {
      const row = ctx.db.prepare("SELECT * FROM canon_snapshots WHERE id = ?").get(snapshotId);
      return row ? (row as unknown as CanonSnapshotRecord) : null;
    }
    return ctx.memoryStore.canon_snapshots.get(snapshotId) ?? null;
  }

public getSnapshotForEpisode(seriesId: string, episodeNumber: number): CanonSnapshotRecord | null {
    const ctx=this.session();
    const lifecycle = this.getEpisodeLifecycle(seriesId, episodeNumber);
    if (lifecycle?.snapshot_id) {
      const snap = this.getCanonSnapshot(lifecycle.snapshot_id);
      if (snap) return snap;
    }
    if (ctx.db && !ctx.isFallback) {
      const row = ctx.db
        .prepare(
          "SELECT * FROM canon_snapshots WHERE series_id = ? AND episode_number = ? ORDER BY snapshot_version DESC LIMIT 1"
        )
        .get(seriesId, episodeNumber);
      return row ? (row as unknown as CanonSnapshotRecord) : null;
    }
    const matches = Array.from(ctx.memoryStore.canon_snapshots.values())
      .filter((s) => s.series_id === seriesId && s.episode_number === episodeNumber)
      .sort((a, b) => b.snapshot_version - a.snapshot_version);
    return matches[0] ?? null;
  }

public listCanonSnapshots(seriesId: string, episodeNumber?: number): CanonSnapshotRecord[] {
    const ctx=this.session();
    if (ctx.db && !ctx.isFallback) {
      let query = "SELECT * FROM canon_snapshots WHERE series_id = ?";
      const params: any[] = [seriesId];
      if (episodeNumber !== undefined) {
        query += " AND episode_number = ?";
        params.push(episodeNumber);
      }
      query += " ORDER BY episode_number ASC, snapshot_version ASC";
      return ctx.db.prepare(query).all(...params) as unknown as CanonSnapshotRecord[];
    }
    return Array.from(ctx.memoryStore.canon_snapshots.values()).filter(
      (s) => s.series_id === seriesId && (episodeNumber === undefined || s.episode_number === episodeNumber)
    );
  }

public ensureRootCanonicalBranch(seriesId: string): TimelineBranchRecord {
    const ctx=this.session();
    return ctx.branches.ensureRootCanonicalBranch(seriesId);
  }

public forkBranch(seriesId: string, options: ForkBranchOptions): TimelineBranchRecord {
    const ctx=this.session();
    return ctx.branches.forkBranch(ctx.branchCanon, seriesId, options);
  }

public listBranches(seriesId: string): TimelineBranchRecord[] {
    const ctx=this.session();
    return ctx.branches.listBranches(seriesId);
  }

public getBranch(branchId: string): TimelineBranchRecord | null {
    const ctx=this.session();
    return ctx.branches.getBranch(branchId);
  }

public getActiveCanonicalBranch(seriesId: string): TimelineBranchRecord | null {
    const ctx=this.session();
    return ctx.branches.getActiveCanonicalBranch(seriesId);
  }

public promoteBranchToCanonical(seriesId: string, branchId: string): void {
    const ctx=this.session();
    ctx.branches.promoteToCanonical(seriesId, branchId);
  }

public compareBranches(seriesId: string, branchAId: string, branchBId: string): MultiverseBranchDiff {
    const ctx=this.session();
    return ctx.branches.compareBranches(ctx.branchCanon, seriesId, branchAId, branchBId);
  }
}
