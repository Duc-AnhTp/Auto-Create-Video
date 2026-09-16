import type {
  BibleManager,
  SeriesMetadataRecord,
  PlannedEpisodeRecord,
  CharacterRecord,
  StoryBeatRecord,
  StoryThreadRecord,
  KnowledgeStateRecord,
} from "../bible/bible-manager.js";

export interface SourceSpanContext {
  unitId: string;
  title: string;
  charStart: number;
  charEnd: number;
  excerpt: string;
}

export interface UnitSummaryContext {
  unitId: string;
  title: string;
  summary: string;
}

export interface EpisodeGenerationContext {
  seriesId: string;
  episodeNumber: number;
  seriesMetadata: SeriesMetadataRecord | null;
  plannedEpisode: PlannedEpisodeRecord | null;
  stateIn: Record<string, any>;
  plannedStateOut: Record<string, any>;
  unitSummaries?: UnitSummaryContext[];
  sourceSpans: SourceSpanContext[];
  mandatoryBeats: StoryBeatRecord[];
  activeCharacters: CharacterRecord[];
  characterKnowledge: Map<string, string[]>;
  activeThreads: StoryThreadRecord[];
  negativeConstraints: string[];
  formattedPrompt: string;
  tokenEstimate: number;
}

export interface ContextBuilderOptions {
  seriesId: string;
  episodeNumber: number;
  planId?: string;
  sourceUnitIds?: string[];
  maxTokensBudget?: number;
}

export class ContextBuilder {
  public static readonly DEFAULT_TOKEN_BUDGET = 4000;

  /**
   * Builds rich, structured, token-budgeted prompt context for generating an episode screenplay,
   * combining Bible canon, planned episode arcs, tiered source retrieval (summary tier, beat tier, span tier),
   * character knowledge boundaries, mandatory beats, and continuity constraints.
   */
  public static buildEpisodeContext(
    bible: BibleManager,
    options: ContextBuilderOptions
  ): EpisodeGenerationContext {
    const seriesId = options.seriesId;
    const epNum = options.episodeNumber;
    const tokenBudget = options.maxTokensBudget || ContextBuilder.DEFAULT_TOKEN_BUDGET;

    // 1. Series Metadata & Visual Style
    const seriesMetadata = bible.getSeriesMetadata(seriesId);

    // 2. Active Adaptation Plan & Planned Episode
    let plan = options.planId ? bible.getSeriesPlan(options.planId) : null;
    if (!plan) {
      plan = bible.getActiveSeriesPlan(seriesId);
    }

    let plannedEpisode: PlannedEpisodeRecord | null = null;
    if (plan) {
      plannedEpisode = bible.getPlannedEpisode(plan.id, epNum);
    }

    // 3. State In / State Out
    let stateIn: Record<string, any> = {};
    let plannedStateOut: Record<string, any> = {};

    if (plannedEpisode) {
      try {
        stateIn = JSON.parse(plannedEpisode.state_in_json || "{}");
        plannedStateOut = JSON.parse(plannedEpisode.planned_state_out_json || "{}");
      } catch {}
    }

    // If episode > 1 and stateIn is empty, pull planned_state_out from episode N-1
    if (epNum > 1 && Object.keys(stateIn).length === 0 && plan) {
      const prevEp = bible.getPlannedEpisode(plan.id, epNum - 1);
      if (prevEp) {
        try {
          stateIn = JSON.parse(prevEp.planned_state_out_json || "{}");
        } catch {}
      }
    }

    // 4. Resolve Unit IDs
    const unitIds = options.sourceUnitIds || [];
    if (unitIds.length === 0 && plan) {
      const ledgers = bible.listCoverageLedgers(plan.id);
      const epLedgers = ledgers.filter(
        (l) => l.episode_number === epNum && l.adaptation_decision !== "omitted"
      );
      for (const l of epLedgers) {
        if (!unitIds.includes(l.source_unit_id)) {
          unitIds.push(l.source_unit_id);
        }
      }
    }

    // 5. Tier 1: Chapter / Unit Summaries (Macro Tier)
    const unitSummaries: UnitSummaryContext[] = [];
    const unitMap = new Map<string, any>();

    for (const uId of unitIds) {
      const unit = bible.getSourceUnit(uId);
      if (unit) {
        unitMap.set(uId, unit);
        const summary = unit.summary || ContextBuilder.generateFallbackSummary(unit);
        unitSummaries.push({
          unitId: unit.id,
          title: unit.title,
          summary,
        });
      }
    }

    // 6. Tier 2: Mandatory & Key Beats for this episode (Beat Tier)
    const allBeats = bible.listStoryBeats(seriesId);
    const mandatoryBeats = allBeats.filter((b) => {
      if (b.is_mandatory !== 1) return false;
      if (unitIds.length > 0 && b.source_unit_id) {
        return unitIds.includes(b.source_unit_id);
      }
      return true;
    });

    // 7. Tier 3: Verbatim Source Spans (Span Tier, respecting maxTokensBudget)
    const totalCharBudget = tokenBudget * 3;
    const reservedChars = Math.min(2500, Math.floor(totalCharBudget * 0.4));
    const availableSpanBudget = Math.max(300, totalCharBudget - reservedChars);
    const budgetPerUnit = Math.floor(availableSpanBudget / Math.max(1, unitIds.length));

    const sourceSpans: SourceSpanContext[] = [];

    for (const uId of unitIds) {
      const unit = unitMap.get(uId);
      if (unit) {
        const excerpt = ContextBuilder.extractTieredExcerpt(
          unit,
          mandatoryBeats.filter((b) => b.source_unit_id === uId),
          budgetPerUnit
        );

        sourceSpans.push({
          unitId: unit.id,
          title: unit.title,
          charStart: unit.char_start,
          charEnd: unit.char_end,
          excerpt,
        });
      }
    }

    // 8. Active Characters (scoped to current series)
    const allCharacters = bible.listCharacters(seriesId);
    const activeCharacters = allCharacters.filter((c) => c.status !== "deceased");

    // Build beat-to-episode and unit-to-episode map if plan exists to enforce epistemic knowledge boundaries
    const beatEpisodeMap = new Map<string, number>();
    const unitEpisodeMap = new Map<string, number>();
    let hasPlanLedgers = false;

    const setMinEp = (map: Map<string, number>, key: string, ep: number) => {
      const cur = map.get(key);
      if (cur === undefined || ep < cur) {
        map.set(key, ep);
      }
    };

    if (plan) {
      const ledgers = bible.listCoverageLedgers(plan.id);
      if (ledgers.length > 0) {
        hasPlanLedgers = true;
      }
      for (const l of ledgers) {
        if (typeof l.episode_number === "number") {
          if (l.beat_id) {
            setMinEp(beatEpisodeMap, l.beat_id, l.episode_number);
          }
          if (l.mandatory_beat_id) {
            setMinEp(beatEpisodeMap, l.mandatory_beat_id, l.episode_number);
          }
          if (l.source_unit_id) {
            setMinEp(unitEpisodeMap, l.source_unit_id, l.episode_number);
          }
        }
      }
    }

    // Pre-index beats to resolve unanchored ledgers or unit mappings
    const beatsById = new Map<string, StoryBeatRecord>(allBeats.map((b) => [b.id, b]));

    // 9. Character Knowledge (epistemic state: what character knows up to episode N)
    const characterKnowledge = new Map<string, string[]>();
    for (const char of activeCharacters) {
      const states = bible.listKnowledgeStates(seriesId, char.id, "character_knowledge");
      const knownFacts = states
        .filter((s) => {
          if (typeof s.revealed_at_episode === "number") {
            return s.revealed_at_episode <= epNum;
          }
          if (s.revealed_at_beat_id) {
            const beatEp = beatEpisodeMap.get(s.revealed_at_beat_id);
            if (beatEp !== undefined) {
              return beatEp <= epNum;
            }

            // Fallback via source_unit_id mapping
            const beat = beatsById.get(s.revealed_at_beat_id);
            if (beat?.source_unit_id) {
              const unitEp = unitEpisodeMap.get(beat.source_unit_id);
              if (unitEp !== undefined) {
                return unitEp <= epNum;
              }
              // If current episode contains this beat's source unit, reveal it
              if (unitIds.includes(beat.source_unit_id)) {
                return true;
              }
            }

            // If beat order <= 1, treat as foundational knowledge rather than dropping it.
            // Do not leak future beats (beat_order > 1) even before coverage ledgers are created.
            if (beat && beat.beat_order <= 1) {
              return true;
            }

            // If beat is unassigned or in future episodes, do not reveal in early episodes
            return false;
          }
          // Foundational knowledge without specific future beat anchor
          return true;
        })
        .map((s) => s.notes || s.fact_key);
      characterKnowledge.set(char.id, knownFacts);
    }

    // 10. Active Story Threads
    const allThreads = bible.listStoryThreads(seriesId);
    const activeThreads = allThreads.filter((t) => t.status === "open");

    // 11. Negative Constraints from Bible
    const negativeConstraints = bible.getNegativeConstraints(epNum);

    // 12. Assemble structured formatted prompt
    const formattedPrompt = ContextBuilder.formatStructuredPrompt({
      seriesId,
      episodeNumber: epNum,
      seriesMetadata,
      plannedEpisode,
      stateIn,
      plannedStateOut,
      unitSummaries,
      sourceSpans,
      mandatoryBeats,
      activeCharacters,
      characterKnowledge,
      activeThreads,
      negativeConstraints,
    });

    const tokenEstimate = Math.ceil(formattedPrompt.length / 3.0);

    return {
      seriesId,
      episodeNumber: epNum,
      seriesMetadata,
      plannedEpisode,
      stateIn,
      plannedStateOut,
      unitSummaries,
      sourceSpans,
      mandatoryBeats,
      activeCharacters,
      characterKnowledge,
      activeThreads,
      negativeConstraints,
      formattedPrompt,
      tokenEstimate,
    };
  }

  /**
   * Generates a concise fallback summary for a source unit when no summary exists.
   */
  public static generateFallbackSummary(unit: any): string {
    const raw = (unit.raw_text || "").trim();
    if (!raw) return `Chương ${unit.unit_number}: ${unit.title}`;
    if (raw.length <= 350) return raw;
    const firstPart = raw.slice(0, 180).replace(/\s+/g, " ").trim();
    const lastPart = raw.slice(-140).replace(/\s+/g, " ").trim();
    return `${firstPart}... [Biến cố tiếp diễn] ...${lastPart}`;
  }

  /**
   * Extracts a balanced, multi-tier excerpt for a unit:
   * - Preserves 100% of the chapter if it fits within budget.
   * - If citing specific beats, anchors extracts to cited beat coordinates.
   * - If larger than budget, provides balanced opening, middle turning point, and chapter climax.
   */
  public static extractTieredExcerpt(
    unit: any,
    beats: StoryBeatRecord[],
    maxChars: number
  ): string {
    const raw = unit.raw_text || "";
    if (raw.length <= maxChars) {
      return raw;
    }

    // Check for cited span coordinates from beats
    const citedSpans: Array<{ start: number; end: number }> = [];
    for (const b of beats) {
      if (
        b.source_span_start !== undefined &&
        b.source_span_start !== null &&
        b.source_span_end !== undefined &&
        b.source_span_end !== null
      ) {
        const s =
          b.source_span_start >= unit.char_start
            ? b.source_span_start - unit.char_start
            : b.source_span_start;
        const e =
          b.source_span_end >= unit.char_start
            ? b.source_span_end - unit.char_start
            : b.source_span_end;
        citedSpans.push({ start: Math.max(0, s), end: Math.min(raw.length, e) });
      } else if (b.source_citations_json) {
        try {
          const citations = JSON.parse(b.source_citations_json);
          if (Array.isArray(citations)) {
            for (const c of citations) {
              if (
                typeof c.charStart === "number" &&
                typeof c.charEnd === "number" &&
                c.charEnd > c.charStart
              ) {
                const s =
                  c.charStart >= unit.char_start ? c.charStart - unit.char_start : c.charStart;
                const e =
                  c.charEnd >= unit.char_start ? c.charEnd - unit.char_start : c.charEnd;
                citedSpans.push({ start: Math.max(0, s), end: Math.min(raw.length, e) });
              }
            }
          }
        } catch {}
      }
    }

    if (citedSpans.length > 0) {
      citedSpans.sort((a, b) => a.start - b.start);
      const merged: Array<{ start: number; end: number }> = [];
      let current = { ...citedSpans[0] };
      for (let i = 1; i < citedSpans.length; i++) {
        if (citedSpans[i].start <= current.end + 100) {
          current.end = Math.max(current.end, citedSpans[i].end);
        } else {
          merged.push(current);
          current = { ...citedSpans[i] };
        }
      }
      merged.push(current);

      const sections: string[] = [];
      for (const span of merged) {
        const paddedStart = Math.max(0, span.start - 80);
        const paddedEnd = Math.min(raw.length, span.end + 120);
        sections.push(raw.slice(paddedStart, paddedEnd).trim());
      }
      const combined = sections.join("\n\n...[chuyển cảnh / diễn biến tiếp]...\n\n");
      if (combined.length <= maxChars) {
        return combined;
      }
    }

    // Balanced 3-tier window: Opening 35%, Middle 35%, Ending Climax 30%
    const openingLen = Math.floor(maxChars * 0.35);
    const middleLen = Math.floor(maxChars * 0.35);
    const endingLen = Math.floor(maxChars * 0.3);

    const opening = raw.slice(0, openingLen).trim();
    const midPoint = Math.floor(raw.length / 2);
    const middle = raw
      .slice(
        Math.max(openingLen, midPoint - Math.floor(middleLen / 2)),
        midPoint + Math.floor(middleLen / 2)
      )
      .trim();
    const ending = raw
      .slice(Math.max(midPoint + Math.floor(middleLen / 2), raw.length - endingLen))
      .trim();

    return `${opening}\n\n...[diễn biến giữa chương]...\n\n${middle}\n\n...[cao trào cuối chương]...\n\n${ending}`;
  }

  /**
   * Assembles a secure, structured prompt text.
   * Treats source text strictly as read-only data, preventing prompt injection attacks.
   */
  private static formatStructuredPrompt(ctx: {
    seriesId: string;
    episodeNumber: number;
    seriesMetadata: SeriesMetadataRecord | null;
    plannedEpisode: PlannedEpisodeRecord | null;
    stateIn: Record<string, any>;
    plannedStateOut: Record<string, any>;
    unitSummaries?: UnitSummaryContext[];
    sourceSpans: SourceSpanContext[];
    mandatoryBeats: StoryBeatRecord[];
    activeCharacters: CharacterRecord[];
    characterKnowledge: Map<string, string[]>;
    activeThreads: StoryThreadRecord[];
    negativeConstraints: string[];
  }): string {
    const lines: string[] = [];

    lines.push("=== KẾ HOẠCH VÀ NGỮ CẢNH BIÊN SOẠN TẬP PHIM ===");
    lines.push(`Loạt phim: ${ctx.seriesMetadata?.title || ctx.seriesId}`);
    lines.push(`Tập số: ${ctx.episodeNumber}`);
    if (ctx.seriesMetadata?.visual_style) {
      lines.push(`Phong cách thị giác: ${ctx.seriesMetadata.visual_style}`);
    }
    if (ctx.seriesMetadata?.aspect_ratio) {
      lines.push(`Tỷ lệ khung hình: ${ctx.seriesMetadata.aspect_ratio}`);
    }

    // Planned Episode Arc
    if (ctx.plannedEpisode) {
      lines.push("\n[MỤC TIÊU VÀ CẤU TRÚC TẬP]");
      lines.push(`Tiêu đề tập: ${ctx.plannedEpisode.title}`);
      lines.push(`Logline: ${ctx.plannedEpisode.logline}`);
      if (ctx.plannedEpisode.goal) lines.push(`Mục tiêu cốt lõi: ${ctx.plannedEpisode.goal}`);
      if (ctx.plannedEpisode.opening) lines.push(`Mở đầu: ${ctx.plannedEpisode.opening}`);
      if (ctx.plannedEpisode.development) lines.push(`Diễn biến chính: ${ctx.plannedEpisode.development}`);
      if (ctx.plannedEpisode.climax) lines.push(`Cao trào: ${ctx.plannedEpisode.climax}`);
      if (ctx.plannedEpisode.ending) lines.push(`Kết thúc (Cliffhanger): ${ctx.plannedEpisode.ending}`);
      lines.push(`Thời lượng mục tiêu: ${ctx.plannedEpisode.target_duration_sec}s`);
    }

    // Continuity State In / Planned State Out
    lines.push("\n[TÌNH TRẠNG LIÊN TỤC (CONTINUITY STATE)]");
    lines.push(`Trạng thái đầu vào (State In): ${JSON.stringify(ctx.stateIn)}`);
    lines.push(`Trạng thái dự kiến sau tập (Planned State Out): ${JSON.stringify(ctx.plannedStateOut)}`);

    // Tier 1: Unit Summaries
    if (ctx.unitSummaries && ctx.unitSummaries.length > 0) {
      lines.push("\n[TỔNG QUAN CÁC CHƯƠNG NGUYÊN TÁC (SUMMARY TIER)]");
      for (const us of ctx.unitSummaries) {
        lines.push(`- ${us.title} (${us.unitId}): ${us.summary}`);
      }
    }

    // Tier 2: Mandatory Beats
    if (ctx.mandatoryBeats.length > 0) {
      lines.push("\n[CÁC SỰ KIỆN BẮT BUỘC PHẢI THỂ HIỆN (BEAT TIER - MANDATORY BEATS)]");
      for (const beat of ctx.mandatoryBeats) {
        const timeNote = beat.is_flashback === 1 ? `[HỒI TƯỞNG: ${beat.story_time}]` : `[Thời gian: ${beat.story_time || "Hiện tại"}]`;
        lines.push(`- Beat ${beat.id}: ${beat.name} ${timeNote}`);
        lines.push(`  Miêu tả: ${beat.description}`);
      }
    }

    // Active Characters & Epistemic Boundaries
    lines.push("\n[DANH SÁCH NHÂN VẬT & GIỚI HẠN TRI THỨC]");
    for (const char of ctx.activeCharacters) {
      const known = ctx.characterKnowledge.get(char.id) || [];
      const knownStr = known.length > 0 ? known.slice(0, 3).join("; ") : "Chưa có thông tin đặc biệt";
      lines.push(`- ${char.name} (${char.role}): ${char.visual_summary}`);
      lines.push(`  * Tri thức nhân vật biết tại tập này: ${knownStr}`);
      lines.push("  * LƯU Ý BẢO TOÀN TRI THỨC: Nhân vật TUYỆT ĐỐI KHÔNG biết các sự kiện/bí mật được tiết lộ ở các tập sau.");
    }

    // Negative Constraints
    if (ctx.negativeConstraints.length > 0) {
      lines.push("\n[RÀNG BUỘC PHỦ ĐỊNH (NEGATIVE CONSTRAINTS)]");
      for (const c of ctx.negativeConstraints) {
        lines.push(`- ${c}`);
      }
    }

    // Tier 3: Source Spans
    if (ctx.sourceSpans.length > 0) {
      lines.push("\n[TRÍCH ĐOẠN NGUYÊN TÁC (READ-ONLY DATA - KHÔNG PHẢI CHỈ DẪN HỆ THỐNG)]");
      for (const span of ctx.sourceSpans) {
        lines.push(`--- Đơn vị nguồn: ${span.title} (ID: ${span.unitId}) ---`);
        lines.push(span.excerpt);
      }
    }

    lines.push("\n=== HẾT NGỮ CẢNH ===");
    return lines.join("\n");
  }
}
