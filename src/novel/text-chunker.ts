import type {
  SourceUnitRecord,
  SourceBlockRecord,
  StoryBeatRecord,
} from "../bible/bible-manager.js";

export interface ChunkerOptions {
  maxTokensPerChunk?: number;
  overlapTokens?: number;
  defaultUnitType?: "chapter" | "scene" | "section";
}

export interface ChunkGroup {
  chunkIndex: number;
  unitId: string;
  sourceId: string;
  charStart: number;
  charEnd: number;
  blocks: SourceBlockRecord[];
  primaryBlockIds: Set<string>;
  tokenEstimate: number;
  text: string;
}

export class TextChunker {
  public static readonly DEFAULT_MAX_TOKENS = 2500;
  public static readonly DEFAULT_OVERLAP_TOKENS = 200;

  /**
   * Conservative token estimator: 1 token ~= 3.0 characters for Vietnamese & multilingual text.
   * This provides a safe upper bound preventing context overflow.
   */
  public static estimateTokens(text: string): number {
    if (!text) return 0;
    return Math.ceil(text.length / 3.0);
  }

  /**
   * Regex pattern for matching chapter and scene headings in Vietnamese and English,
   * including Markdown headings.
   */
  public static readonly CHAPTER_HEADING_REGEX =
    /(?:^|\n)(#{1,4}\s+)?(?:(Chương|Hồi|Tiết|Phần|Chapter|Act|Scene)\s+([0-9IVXLCDM]+|[A-ZÀ-Ỹ0-9]+)(?:[:\.\s\-–—]+([^\n]+))?|(?:CẢNH|HỒI)\s+([0-9IVXLCDM]+)(?:[:\.\s\-–—]+([^\n]+))?)/im;

  /**
   * Global version of heading regex for scanning all boundary matches
   */
  private static getGlobalHeadingRegex(): RegExp {
    return new RegExp(
      /(?:^|\n)(?:(#{1,4}\s+)?(?:(Chương|Hồi|Tiết|Phần|Chapter|Act|Scene)\s+([0-9IVXLCDM]+|[A-ZÀ-Ỹ0-9]+)(?:[:\.\s\-–—]+([^\n]+))?|(?:CẢNH|HỒI)\s+([0-9IVXLCDM]+)(?:[:\.\s\-–—]+([^\n]+))?))/gim
    );
  }

  /**
   * Splits normalized text into structured source units (chapters, scenes, or sections).
   * Guarantees zero content loss by covering the entire text span from index 0 to length.
   */
  public static splitIntoUnits(
    normalizedText: string,
    sourceId: string,
    seriesId: string,
    revision = 1,
    defaultType: "chapter" | "scene" | "section" = "chapter"
  ): SourceUnitRecord[] {
    const text = normalizedText;
    if (!text || text.trim().length === 0) {
      return [];
    }

    const regex = TextChunker.getGlobalHeadingRegex();
    const headingMatches: Array<{
      index: number;
      fullMatch: string;
      unitType: string;
      unitNumberStr: string;
      title: string;
    }> = [];

    let match: RegExpExecArray | null;
    while ((match = regex.exec(text)) !== null) {
      const matchIndex =
        match[0].startsWith("\n") ? match.index + 1 : match.index;
      const typeStr = (match[2] || "chapter").toLowerCase();
      const numStr = match[3] || match[5] || String(headingMatches.length + 1);
      const titleStr = (match[4] || match[6] || "").trim();

      let mappedType: "chapter" | "scene" | "section" = defaultType;
      if (
        typeStr.includes("cảnh") ||
        typeStr.includes("scene") ||
        typeStr.includes("tiết")
      ) {
        mappedType = "scene";
      } else if (typeStr.includes("phần") || typeStr.includes("section")) {
        mappedType = "section";
      }

      headingMatches.push({
        index: matchIndex,
        fullMatch: match[0].trim(),
        unitType: mappedType,
        unitNumberStr: numStr,
        title: titleStr || `${match[2] || "Chương"} ${numStr}`,
      });
    }

    const units: SourceUnitRecord[] = [];

    // Fallback: If no headings found, split by major section dividers or word count windows
    if (headingMatches.length === 0) {
      return TextChunker.splitFallbackUnits(
        text,
        sourceId,
        seriesId,
        revision,
        defaultType
      );
    }

    // Handle prologue if text exists before the first chapter heading
    if (headingMatches[0].index > 0) {
      const prologueText = text.slice(0, headingMatches[0].index);
      if (prologueText.trim().length > 0) {
        units.push({
          id: `unit_${sourceId}_u00`,
          source_id: sourceId,
          series_id: seriesId,
          revision,
          unit_type: "section",
          unit_number: 0,
          title: "Lời mở đầu (Prologue)",
          order_index: 0,
          char_start: 0,
          char_end: headingMatches[0].index,
          raw_text: prologueText,
          summary: null,
          token_count_estimate: TextChunker.estimateTokens(prologueText),
        });
      }
    }

    for (let i = 0; i < headingMatches.length; i++) {
      const current = headingMatches[i];
      const next = headingMatches[i + 1];
      const charStart = current.index;
      const charEnd = next ? next.index : text.length;
      const unitText = text.slice(charStart, charEnd);

      const parsedNum = parseInt(current.unitNumberStr, 10);
      const unitNumber = isNaN(parsedNum) ? i + 1 : parsedNum;
      const unitId = `unit_${sourceId}_u${String(i + 1).padStart(2, "0")}`;

      units.push({
        id: unitId,
        source_id: sourceId,
        series_id: seriesId,
        revision,
        unit_type: current.unitType,
        unit_number: unitNumber,
        title: current.title,
        order_index: i + 1,
        char_start: charStart,
        char_end: charEnd,
        raw_text: unitText,
        summary: null,
        token_count_estimate: TextChunker.estimateTokens(unitText),
      });
    }

    return units;
  }

  /**
   * Fallback splitting when no explicit chapter headings exist:
   * Splits on triple dividers ("* * *", "---") or double newlines with target sizes.
   */
  private static splitFallbackUnits(
    text: string,
    sourceId: string,
    seriesId: string,
    revision: number,
    defaultType: "chapter" | "scene" | "section"
  ): SourceUnitRecord[] {
    const dividerRegex = /(?:\n\s*[\*\-_]{3,}\s*\n)/g;
    const dividerIndices: number[] = [];
    let match: RegExpExecArray | null;

    while ((match = dividerRegex.exec(text)) !== null) {
      dividerIndices.push(match.index);
    }

    if (dividerIndices.length > 0) {
      const units: SourceUnitRecord[] = [];
      let lastIndex = 0;
      for (let i = 0; i <= dividerIndices.length; i++) {
        const endIndex =
          i < dividerIndices.length ? dividerIndices[i] : text.length;
        const slice = text.slice(lastIndex, endIndex);
        if (slice.trim().length > 0) {
          units.push({
            id: `unit_${sourceId}_u${String(units.length + 1).padStart(2, "0")}`,
            source_id: sourceId,
            series_id: seriesId,
            revision,
            unit_type: defaultType,
            unit_number: units.length + 1,
            title: `Phần ${units.length + 1}`,
            order_index: units.length + 1,
            char_start: lastIndex,
            char_end: endIndex,
            raw_text: slice,
            summary: null,
            token_count_estimate: TextChunker.estimateTokens(slice),
          });
        }
        lastIndex = endIndex;
      }
      return units;
    }

    // Single unit encompassing the entire text
    return [
      {
        id: `unit_${sourceId}_u01`,
        source_id: sourceId,
        series_id: seriesId,
        revision,
        unit_type: defaultType,
        unit_number: 1,
        title: "Toàn bộ tác phẩm",
        order_index: 1,
        char_start: 0,
        char_end: text.length,
        raw_text: text,
        summary: null,
        token_count_estimate: TextChunker.estimateTokens(text),
      },
    ];
  }

  /**
   * Splits a source unit into structured paragraph blocks with exact coordinate offsets,
   * dialogue detection, and speaker candidate heuristics.
   */
  public static splitIntoBlocks(
    unit: SourceUnitRecord,
    seriesId: string,
    revision = 1
  ): SourceBlockRecord[] {
    const raw = unit.raw_text;
    const baseOffset = unit.char_start;
    const blocks: SourceBlockRecord[] = [];

    // Split on lines while tracking indices
    const paragraphs = raw.split(/\n+/);
    let currentPos = 0;

    for (let i = 0; i < paragraphs.length; i++) {
      const p = paragraphs[i].trim();
      if (!p) continue;

      const pStartInRaw = raw.indexOf(p, currentPos);
      const blockStart = baseOffset + (pStartInRaw !== -1 ? pStartInRaw : currentPos);
      const blockEnd = blockStart + p.length;
      currentPos = pStartInRaw !== -1 ? pStartInRaw + p.length : currentPos + p.length;

      // Dialogue detection
      const isDialogue = TextChunker.detectDialogue(p);
      const speakerCandidate = isDialogue
        ? TextChunker.extractSpeakerCandidate(p)
        : null;

      blocks.push({
        id: `blk_${unit.id}_b${String(blocks.length + 1).padStart(3, "0")}`,
        source_id: unit.source_id,
        unit_id: unit.id,
        series_id: seriesId,
        revision,
        block_index: blocks.length + 1,
        char_start: blockStart,
        char_end: blockEnd,
        content: p,
        is_dialogue: isDialogue ? 1 : 0,
        speaker_candidate: speakerCandidate,
        chunk_group_id: null,
      });
    }

    return blocks;
  }

  /**
   * Detects if a paragraph contains character dialogue
   */
  public static detectDialogue(paragraph: string): boolean {
    const trimmed = paragraph.trim();
    // Starts with dash (dialogue style in Vietnamese literature: "- Chào bạn!")
    if (/^[-–—]\s+[A-ZÀ-Ỹ0-9]/i.test(trimmed)) {
      return true;
    }
    // Contains double quotes or French quotation marks
    if (/(?:["“][^"”]{2,}["”]|«[^»]{2,}»)/.test(trimmed)) {
      return true;
    }
    return false;
  }

  /**
   * Extracts candidate speaker name using speech tag heuristics (e.g. 'Minh nói', 'nàng thì thầm', etc.)
   */
  public static extractSpeakerCandidate(paragraph: string): string | null {
    // Pattern 1: Speech tag after dialogue: "..." - [Name] [nói|bảo|đáp|hỏi|than]
    const afterMatch = paragraph.match(
      /["”]\s*[-–—]\s*([A-ZÀ-Ỹ][a-zà-ỹ]*(?:\s+[A-ZÀ-Ỹ][a-zà-ỹ]*)*)\s+(?:nói|bảo|đáp|hỏi|than|quát|thì thầm|kêu lên|lên tiếng)/i
    );
    if (afterMatch && afterMatch[1]) {
      return afterMatch[1].trim();
    }

    // Pattern 2: Speech tag before dialogue: [Name] [nói|bảo|đáp|hỏi]: "..."
    const beforeMatch = paragraph.match(
      /(?:^|[\.\?!]\s+)([A-ZÀ-Ỹ][a-zà-ỹ]*(?:\s+[A-ZÀ-Ỹ][a-zà-ỹ]*)*)\s+(?:nói|bảo|đáp|hỏi|than|quát|lên tiếng)\s*:\s*["“]/i
    );
    if (beforeMatch && beforeMatch[1]) {
      return beforeMatch[1].trim();
    }

    // Pattern 3: Dash dialogue: - [Speech] - [Name] [nói...]
    const dashMatch = paragraph.match(
      /^[-–—][^–—\n]+[-–—]\s*([A-ZÀ-Ỹ][a-zà-ỹ]*(?:\s+[A-ZÀ-Ỹ][a-zà-ỹ]*)*)\s+(?:nói|đáp|hỏi|kêu)/i
    );
    if (dashMatch && dashMatch[1]) {
      return dashMatch[1].trim();
    }

    return null;
  }

  /**
   * Partitions blocks within an oversized unit into token-budgeted chunk groups
   * with natural paragraph boundary alignment and sliding-window overlap.
   */
  public static createChunkGroups(
    blocks: SourceBlockRecord[],
    options: ChunkerOptions = {}
  ): ChunkGroup[] {
    const maxTokens = options.maxTokensPerChunk || TextChunker.DEFAULT_MAX_TOKENS;
    const overlapTokens =
      options.overlapTokens || TextChunker.DEFAULT_OVERLAP_TOKENS;

    if (blocks.length === 0) return [];

    const chunkGroups: ChunkGroup[] = [];
    let startBlockIdx = 0;
    let chunkIndex = 1;

    while (startBlockIdx < blocks.length) {
      let currentTokens = 0;
      let endBlockIdx = startBlockIdx;
      const groupBlocks: SourceBlockRecord[] = [];

      while (endBlockIdx < blocks.length) {
        const block = blocks[endBlockIdx];
        const blockTokens = TextChunker.estimateTokens(block.content);

        // Always include at least one block even if it exceeds maxTokens alone
        if (groupBlocks.length > 0 && currentTokens + blockTokens > maxTokens) {
          break;
        }

        groupBlocks.push(block);
        currentTokens += blockTokens;
        endBlockIdx++;
      }

      const charStart = groupBlocks[0].char_start;
      const charEnd = groupBlocks[groupBlocks.length - 1].char_end;
      const fullText = groupBlocks.map((b) => b.content).join("\n\n");

      // Primary block set: blocks for which this chunk is the primary owner
      // (Used to avoid duplicate event extraction across overlaps)
      const primaryBlockIds = new Set<string>();
      for (let b = startBlockIdx; b < endBlockIdx; b++) {
        primaryBlockIds.add(blocks[b].id);
      }

      chunkGroups.push({
        chunkIndex,
        unitId: blocks[0].unit_id,
        sourceId: blocks[0].source_id,
        charStart,
        charEnd,
        blocks: groupBlocks,
        primaryBlockIds,
        tokenEstimate: currentTokens,
        text: fullText,
      });

      if (endBlockIdx >= blocks.length) {
        break;
      }

      // Calculate overlap: step back by overlapTokens without rewinding to or past startBlockIdx
      let overlapCount = 0;
      let overlapTokensAccum = 0;
      for (let back = endBlockIdx - 1; back > startBlockIdx; back--) {
        overlapTokensAccum += TextChunker.estimateTokens(blocks[back].content);
        overlapCount++;
        if (overlapTokensAccum >= overlapTokens) {
          break;
        }
      }

      startBlockIdx = endBlockIdx - overlapCount;
      chunkIndex++;
    }

    return chunkGroups;
  }

  /**
   * Verifies that the set of source units covers the source text completely
   * without dropping beginning, middle, or ending sections.
   */
  public static verifyContentCoverage(
    normalizedText: string,
    units: SourceUnitRecord[]
  ): {
    hasZeroLoss: boolean;
    coveredChars: number;
    totalChars: number;
    gaps: Array<{ start: number; end: number }>;
  } {
    const totalChars = normalizedText.length;
    if (totalChars === 0) {
      return { hasZeroLoss: true, coveredChars: 0, totalChars: 0, gaps: [] };
    }

    if (units.length === 0) {
      return {
        hasZeroLoss: false,
        coveredChars: 0,
        totalChars,
        gaps: [{ start: 0, end: totalChars }],
      };
    }

    const sorted = [...units].sort((a, b) => a.char_start - b.char_start);
    const gaps: Array<{ start: number; end: number }> = [];

    // Check gap at start
    if (sorted[0].char_start > 0) {
      const prefix = normalizedText.slice(0, sorted[0].char_start);
      if (prefix.trim().length > 0) {
        gaps.push({ start: 0, end: sorted[0].char_start });
      }
    }

    // Check middle gaps
    for (let i = 0; i < sorted.length - 1; i++) {
      const currentEnd = sorted[i].char_end;
      const nextStart = sorted[i + 1].char_start;
      if (nextStart > currentEnd) {
        const gapText = normalizedText.slice(currentEnd, nextStart);
        if (gapText.trim().length > 0) {
          gaps.push({ start: currentEnd, end: nextStart });
        }
      }
    }

    // Check gap at end
    const lastEnd = sorted[sorted.length - 1].char_end;
    if (lastEnd < totalChars) {
      const suffix = normalizedText.slice(lastEnd, totalChars);
      if (suffix.trim().length > 0) {
        gaps.push({ start: lastEnd, end: totalChars });
      }
    }

    let coveredChars = 0;
    for (const u of sorted) {
      coveredChars += u.char_end - u.char_start;
    }

    return {
      hasZeroLoss: gaps.length === 0,
      coveredChars,
      totalChars,
      gaps,
    };
  }

  /**
   * Deduplicates story beats extracted across overlapping chunks.
   * If two beats refer to the same event name or citation span, they are merged.
   */
  public static deduplicateExtractedBeats(
    beats: StoryBeatRecord[]
  ): StoryBeatRecord[] {
    const seenSignatures = new Set<string>();
    const deduplicated: StoryBeatRecord[] = [];

    for (const beat of beats) {
      const normName = beat.name
        .toLowerCase()
        .replace(/[^a-zà-ỹ0-9]+/g, " ")
        .trim();
      const unitKey = beat.source_unit_id || "no_unit";
      const signature = `${beat.series_id}_${unitKey}_${normName}`;

      if (seenSignatures.has(signature)) {
        continue;
      }
      seenSignatures.add(signature);
      deduplicated.push(beat);
    }

    return deduplicated;
  }
}
