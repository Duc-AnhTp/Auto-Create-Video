import type {
  BibleManager,
  SourceWorkRecord,
  SourceUnitRecord,
  SourceBlockRecord,
  StoryBeatRecord,
  StoryThreadRecord,
  KnowledgeStateRecord,
  CharacterRecord,
} from "../bible/bible-manager.js";
import { TextChunker } from "./text-chunker.js";

export interface StoryAnalysisOptions {
  seriesId: string;
  sourceId: string;
  revision?: number;
  useLlm?: boolean;
  llmProvider?: (prompt: string) => Promise<string>;
}

export interface ExtractedEntity {
  id: string;
  name: string;
  aliases: string[];
  role: "protagonist" | "antagonist" | "supporting" | "minor";
  visualSummary: string;
  relationships: Array<{ targetId: string; relationType: string }>;
  citations: Array<{ unitId: string; charStart: number; charEnd: number }>;
}

export interface AnalysisResult {
  characters: CharacterRecord[];
  beats: StoryBeatRecord[];
  threads: StoryThreadRecord[];
  knowledgeStates: KnowledgeStateRecord[];
  warnings: string[];
}

export class StoryAnalysisEngine {
  /**
   * Common flashback and non-linear memory indicators in Vietnamese and English
   */
  public static readonly FLASHBACK_PATTERNS = [
    /(?:năm xưa|nhiều năm trước|\d+\s+năm trước|thuở nhỏ|thời niên thiếu|ngày ấy)/i,
    /(?:ký ức ùa về|nhớ lại|hồi tưởng|trong tâm trí hiện lên|chợt nhớ lại)/i,
    /(?:years ago|\d+\s+years earlier|in the past|flashback|remembers when|recalled)/i,
  ];

  /**
   * Analyzes an entire source work, extracting entities, narrative beats,
   * story threads, and epistemic knowledge states, then persists them to the Story Bible.
   */
  public static async analyzeWork(
    work: SourceWorkRecord,
    units: SourceUnitRecord[],
    blocks: SourceBlockRecord[],
    bible: BibleManager,
    options: StoryAnalysisOptions
  ): Promise<AnalysisResult> {
    const seriesId = options.seriesId;
    const sourceId = options.sourceId;
    const revision = options.revision || work.current_revision;

    const warnings: string[] = [];

    // Step 1: Extract characters with aliases and citations
    const extractedEntities = StoryAnalysisEngine.extractCharacters(
      units,
      blocks,
      seriesId
    );

    // Persist characters to Story Bible
    const characters: CharacterRecord[] = [];
    for (const ent of extractedEntities) {
      const charRecord: CharacterRecord = {
        id: ent.id,
        name: ent.name,
        role: ent.role,
        series_id: seriesId,
        visual_summary: ent.visualSummary,
        personality_traits: ent.aliases, // Store aliases in traits / metadata
        voice_profile_id: `voice_${ent.id}`,
        status: "alive",
        aliases_json: JSON.stringify(ent.aliases),
        relationship_graph_json: JSON.stringify(ent.relationships),
      };
      bible.upsertCharacter(charRecord);
      characters.push(charRecord);
    }

    // Step 2: Extract Story Beats across units
    const rawBeats = StoryAnalysisEngine.extractBeats(
      units,
      blocks,
      extractedEntities,
      seriesId,
      sourceId
    );

    // Deduplicate beats across chunk overlaps
    const beats = TextChunker.deduplicateExtractedBeats(rawBeats);
    bible.batchUpsertStoryBeats(beats);

    // Step 3: Extract Story Threads (setups and payoffs)
    const threads = StoryAnalysisEngine.extractThreads(beats, seriesId);
    for (const t of threads) {
      bible.upsertStoryThread(t);
    }

    // Step 4: Record 4-Dimensional Epistemic Knowledge States
    const knowledgeStates = StoryAnalysisEngine.extractKnowledgeStates(
      beats,
      extractedEntities,
      seriesId
    );
    for (const k of knowledgeStates) {
      bible.recordKnowledgeState(k);
    }

    return {
      characters,
      beats,
      threads,
      knowledgeStates,
      warnings,
    };
  }

  /**
   * Extracts characters with alias detection, role heuristic, and source citations.
   * Enforces Anti-Merging: Does NOT merge two names unless there is explicit alias proof.
   */
  public static extractCharacters(
    units: SourceUnitRecord[],
    blocks: SourceBlockRecord[],
    seriesId: string
  ): ExtractedEntity[] {
    const nameOccurrences = new Map<
      string,
      { count: number; citations: Array<{ unitId: string; charStart: number; charEnd: number }> }
    >();

    // Explicit alias declarations: e.g. "Minh, biệt danh là Chuột Bão" or "Minh (tức Lão Tam)"
    const aliasMapping = new Map<string, Set<string>>();

    // Scan dialogue speaker candidates and character name patterns
    for (const block of blocks) {
      const content = block.content;

      // Check speaker candidate
      if (block.speaker_candidate) {
        const name = StoryAnalysisEngine.cleanName(block.speaker_candidate);
        if (name && name.length >= 2) {
          const current = nameOccurrences.get(name) || { count: 0, citations: [] };
          current.count += 3; // Dialogue speaker given higher weight
          current.citations.push({
            unitId: block.unit_id,
            charStart: block.char_start,
            charEnd: block.char_end,
          });
          nameOccurrences.set(name, current);
        }
      }

      // Check alias patterns in text
      // Pattern 1: [Name] [-,( ] (người mà giang hồ / còn được sư môn / v.v.) (còn gọi là|tức là|tức|biệt danh là|thường gọi là|gọi là|biệt hiệu là) [Alias]
      const aliasMatch = content.match(
        /([A-ZÀ-Ỹ][a-zà-ỹ]*(?:\s+[A-ZÀ-Ỹ][a-zà-ỹ]*)*)[,\s–\-]+(?:(?:người mà\s+[^,–\-\n]*?|còn\s+được\s+[^,–\-\n]*?|được\s+[^,–\-\n]*?)*)(?:còn gọi là|tức là|tức|biệt danh là|thường gọi là|gọi là|biệt hiệu là)\s+([A-ZÀ-Ỹ][a-zà-ỹ]*(?:\s+[A-ZÀ-Ỹ][a-zà-ỹ]*)*)/i
      );
      if (aliasMatch && aliasMatch[1] && aliasMatch[2]) {
        const primary = StoryAnalysisEngine.cleanName(aliasMatch[1]);
        const alias = StoryAnalysisEngine.cleanName(aliasMatch[2]);
        if (primary && alias && primary !== alias) {
          StoryAnalysisEngine.registerAliasPair(aliasMapping, primary, alias);
        }
      }

      // Pattern 2: [Title / Alias] [Name], e.g. "Bạch Y Nữ hiệp Tiểu Lan"
      const appositionMatch = content.match(
        /(Bạch Y Nữ hiệp|Hắc Ma Giáo Chủ|Thám tử|Chưởng quầy|Đại hiệp|Nữ hiệp)\s+([A-ZÀ-Ỹ][a-zà-ỹ]*(?:\s+[A-ZÀ-Ỹ][a-zà-ỹ]*)*)/i
      );
      if (appositionMatch && appositionMatch[1] && appositionMatch[2]) {
        const alias = StoryAnalysisEngine.cleanName(appositionMatch[1]);
        const primary = StoryAnalysisEngine.cleanName(appositionMatch[2]);
        if (primary && alias && primary !== alias) {
          StoryAnalysisEngine.registerAliasPair(aliasMapping, primary, alias);
        }
      }

      // Scan capitalized name patterns (Vietnamese titles: Thám tử X, Bác sĩ Y, Lão Z, Tiểu W)
      const namePattern =
        /\b(Thám tử\s+[A-ZÀ-Ỹ][a-zà-ỹ]+|Chưởng quầy\s+[A-ZÀ-Ỹ][a-zà-ỹ]+|Lão\s+[A-ZÀ-Ỹ][a-zà-ỹ]+|Tiểu\s+[A-ZÀ-Ỹ][a-zà-ỹ]+|[A-ZÀ-Ỹ][a-zà-ỹ]+\s+[A-ZÀ-Ỹ][a-zà-ỹ]+)\b/g;
      let match: RegExpExecArray | null;
      while ((match = namePattern.exec(content)) !== null) {
        const rawName = match[0];
        // Filter common false positives
        if (
          /^(Tuy Nhiên|Nhưng Mà|Sau Đó|Đột Nhiên|Một Ngày|Buổi Sáng|Hôm Sau|Kinh Thành|Lạc Dương|Tửu Lầu)/i.test(
            rawName
          )
        ) {
          continue;
        }
        const clean = StoryAnalysisEngine.cleanName(rawName);
        if (clean && clean.length >= 2) {
          const cur = nameOccurrences.get(clean) || { count: 0, citations: [] };
          cur.count += 1;
          if (cur.citations.length < 5) {
            cur.citations.push({
              unitId: block.unit_id,
              charStart: block.char_start,
              charEnd: block.char_end,
            });
          }
          nameOccurrences.set(clean, cur);
        }
      }
    }

    // Sort candidates by occurrence count
    const sorted = Array.from(nameOccurrences.entries())
      .filter(([_, data]) => data.count >= 2)
      .sort((a, b) => b[1].count - a[1].count);

    const entities: ExtractedEntity[] = [];
    const entityIds = new Set<string>();

    for (let i = 0; i < sorted.length; i++) {
      const [name, data] = sorted[i];
      const slug = name
        .toLowerCase()
        .normalize("NFD")
        .replace(/[̀-ͯ]/g, "")
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "")
        .slice(0, 24);

      const id = `char_${slug || `person_${i + 1}`}`;
      if (entityIds.has(id)) continue;
      entityIds.add(id);

      // Determine role by ranking
      let role: "protagonist" | "antagonist" | "supporting" | "minor" = "supporting";
      if (i === 0) role = "protagonist";
      else if (i === 1 && data.count >= 5) role = "supporting";
      else if (data.count <= 2) role = "minor";

      // Collect known aliases
      const aliasesSet = new Set<string>();
      for (const [key, set] of aliasMapping.entries()) {
        if (key === name || name.includes(key) || key.includes(name)) {
          for (const a of set) aliasesSet.add(a);
        }
      }
      const aliases = Array.from(aliasesSet);

      entities.push({
        id,
        name,
        aliases,
        role,
        visualSummary: `Nhân vật ${name} trong tác phẩm, xuất hiện ${data.count} lần.`,
        relationships: [],
        citations: data.citations,
      });
    }

    return entities;
  }

  private static cleanName(name: string): string {
    return name
      .trim()
      .replace(/^[\s,.\-–—"“'«]+/g, "")
      .replace(/[\s,.\-–—"”'»]+$/g, "")
      .trim();
  }

  private static registerAliasPair(
    aliasMapping: Map<string, Set<string>>,
    primary: string,
    alias: string
  ): void {
    if (!aliasMapping.has(primary)) aliasMapping.set(primary, new Set());
    aliasMapping.get(primary)!.add(alias);
    if (!aliasMapping.has(alias)) aliasMapping.set(alias, new Set());
    aliasMapping.get(alias)!.add(primary);

    const withoutHiep = alias.replace(/\s+hiệp$/i, "").trim();
    if (withoutHiep && withoutHiep !== alias) {
      aliasMapping.get(primary)!.add(withoutHiep);
      aliasMapping.get(alias)!.add(withoutHiep);
    }
    const baseAlias = alias
      .replace(/\s+(?:nữ hiệp|đại hiệp|tiểu thư|công tử|đại nhân|tiên sinh)$/i, "")
      .trim();
    if (baseAlias && baseAlias !== alias) {
      aliasMapping.get(primary)!.add(baseAlias);
      aliasMapping.get(alias)!.add(baseAlias);
    }
  }

  /**
   * Extracts story beats per unit with chronology vs telling order and flashback detection.
   */
  public static extractBeats(
    units: SourceUnitRecord[],
    blocks: SourceBlockRecord[],
    entities: ExtractedEntity[],
    seriesId: string,
    sourceId: string
  ): StoryBeatRecord[] {
    const beats: StoryBeatRecord[] = [];
    let beatOrderCounter = 1;

    for (const unit of units) {
      const unitBlocks = blocks.filter((b) => b.unit_id === unit.id);
      if (unitBlocks.length === 0) continue;

      // Group blocks into meaningful scenes / beat units (every 3-5 blocks or major shifts)
      const beatBlockGroups: SourceBlockRecord[][] = [];
      let currentGroup: SourceBlockRecord[] = [];

      for (const b of unitBlocks) {
        currentGroup.push(b);
        if (currentGroup.length >= 4 || b.content.length > 500) {
          beatBlockGroups.push(currentGroup);
          currentGroup = [];
        }
      }
      if (currentGroup.length > 0) {
        beatBlockGroups.push(currentGroup);
      }

      for (let g = 0; g < beatBlockGroups.length; g++) {
        const group = beatBlockGroups[g];
        const groupText = group.map((b) => b.content).join("\n\n");

        // Flashback detection
        const isFlashback = StoryAnalysisEngine.isFlashbackText(groupText);

        // Participating characters
        const participants: string[] = [];
        for (const ent of entities) {
          if (groupText.includes(ent.name) || ent.aliases.some((a) => groupText.includes(a))) {
            participants.push(ent.id);
          }
        }

        // Story time heuristic
        let storyTime: string | null = null;
        if (isFlashback) {
          storyTime = "Quá khứ / Ký ức trước sự kiện chính";
        } else {
          storyTime = `Thời điểm câu chuyện ${unit.title || ""}, phân đoạn ${g + 1}`;
        }

        const beatId = `beat_${sourceId}_u${String(unit.order_index).padStart(2, "0")}_b${String(g + 1).padStart(2, "0")}`;
        const beatTitle = `${unit.title} - Đoạn ${g + 1}`;

        // Build meaningful beat description from narrative content
        const narrativeBlocks = group.filter(
          (b) =>
            !(
              (b.content.toLowerCase().startsWith("chương") ||
                b.content.toLowerCase().startsWith("chapter") ||
                b.content.toLowerCase().startsWith("hồi")) &&
              b.content.length < 80
            )
        );
        const descBlocks = narrativeBlocks.length > 0 ? narrativeBlocks : group;
        const description =
          descBlocks
            .map((b) => b.content)
            .join(" ")
            .slice(0, 300)
            .replace(/\s+/g, " ") + "...";

        beats.push({
          id: beatId,
          source_id: sourceId,
          source_unit_id: unit.id,
          series_id: seriesId,
          beat_order: beatOrderCounter++,
          name: beatTitle,
          description,
          participating_characters_json: JSON.stringify(participants),
          location_id: null,
          story_time: storyTime,
          is_flashback: isFlashback ? 1 : 0,
          preconditions_json: JSON.stringify({}),
          post_state_changes_json: JSON.stringify({ completed_segment: true }),
          source_citations_json: JSON.stringify([
            {
              unitId: unit.id,
              charStart: group[0].char_start,
              charEnd: group[group.length - 1].char_end,
              excerpt: groupText.slice(0, 150),
            },
          ]),
          is_mandatory: 1,
          created_at: new Date().toISOString(),
        });
      }
    }

    return beats;
  }

  /**
   * Detects if a text block describes a flashback or non-linear memory jump
   */
  public static isFlashbackText(text: string): boolean {
    for (const pattern of StoryAnalysisEngine.FLASHBACK_PATTERNS) {
      if (pattern.test(text)) {
        return true;
      }
    }
    return false;
  }

  /**
   * Extracts plot threads (setups and payoffs) from beats
   */
  public static extractThreads(
    beats: StoryBeatRecord[],
    seriesId: string
  ): StoryThreadRecord[] {
    const threads: StoryThreadRecord[] = [];

    // Main series arc thread
    if (beats.length > 0) {
      threads.push({
        id: `thread_${seriesId}_main_arc`,
        series_id: seriesId,
        name: "Cốt truyện chính",
        thread_type: "main",
        description: "Hành trình phát triển sự kiện xuyên suốt từ đầu tới cuối tác phẩm",
        setup_beat_id: beats[0].id,
        payoff_beat_id: beats[beats.length - 1].id,
        status: "open",
        dependencies_json: JSON.stringify([]),
        created_at: new Date().toISOString(),
      });
    }

    // Flashback / mystery subplot threads if flashbacks exist
    const flashbackBeats = beats.filter((b) => b.is_flashback === 1);
    if (flashbackBeats.length > 0) {
      threads.push({
        id: `thread_${seriesId}_past_mystery`,
        series_id: seriesId,
        name: "Bí mật quá khứ",
        thread_type: "subplot",
        description: "Các manh mối và biến cố trong quá khứ được hé lộ qua hồi tưởng",
        setup_beat_id: flashbackBeats[0].id,
        payoff_beat_id: null,
        status: "open",
        dependencies_json: JSON.stringify([]),
        created_at: new Date().toISOString(),
      });
    }

    return threads;
  }

  /**
   * Extracts epistemic knowledge states (distinguishing source fact, adaptation decision,
   * character knowledge, and audience knowledge).
   */
  public static extractKnowledgeStates(
    beats: StoryBeatRecord[],
    entities: ExtractedEntity[],
    seriesId: string
  ): Array<Omit<KnowledgeStateRecord, "id" | "created_at">> {
    const states: Array<Omit<KnowledgeStateRecord, "id" | "created_at">> = [];

    for (const beat of beats) {
      // 1. Source facts established in this beat
      states.push({
        series_id: seriesId,
        fact_key: `event_${beat.id}`,
        fact_type: "source_fact",
        entity_id: "source",
        revealed_at_episode: null,
        revealed_at_beat_id: beat.id,
        is_flashback: beat.is_flashback,
        notes: beat.name,
      });

      // 2. Audience knowledge (audience learns fact when beat is presented)
      states.push({
        series_id: seriesId,
        fact_key: `event_${beat.id}`,
        fact_type: "audience_knowledge",
        entity_id: "audience",
        revealed_at_episode: null,
        revealed_at_beat_id: beat.id,
        is_flashback: beat.is_flashback,
        notes: `Khán giả biết sự kiện qua beat ${beat.id}`,
      });

      // 3. Character knowledge: only participating characters gain knowledge of this beat!
      // Characters not participating do NOT know this event occurred.
      let participantIds: string[] = [];
      try {
        participantIds = JSON.parse(beat.participating_characters_json);
      } catch {}

      for (const charId of participantIds) {
        states.push({
          series_id: seriesId,
          fact_key: `event_${beat.id}`,
          fact_type: "character_knowledge",
          entity_id: charId,
          revealed_at_episode: null,
          revealed_at_beat_id: beat.id,
          is_flashback: beat.is_flashback,
          notes: `Nhân vật ${charId} chứng kiến/tham gia sự kiện ${beat.id}`,
        });
      }
    }

    return states;
  }
}
