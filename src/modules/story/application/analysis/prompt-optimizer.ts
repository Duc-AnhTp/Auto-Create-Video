import type { CharacterRecord, EpisodeSummaryRecord, SeriesMetadataRecord } from "../../../../contracts/story.js";

export interface CacheablePromptBlock {
  type: "text";
  text: string;
  cache_control?: { type: "ephemeral" };
}

export interface CacheablePromptPayload {
  systemPromptBlocks: CacheablePromptBlock[];
  userPromptBlocks: CacheablePromptBlock[];
  estimatedStaticTokens: number;
  estimatedDynamicTokens: number;
  isCacheEligible: boolean; // Heuristic eligibility only; provider usage confirms real cache writes and reads.
}

export interface DecayedEpisodeSummary {
  episodeNumber: number;
  tier: "detailed" | "concise" | "macro";
  text: string;
}

export interface CompactShotGrammar {
  sceneNum: number;
  shotNum: number;
  shotType: "EST" | "WIDE" | "MED" | "CU" | "ECU" | "OTS" | "ACT";
  durationSec: number;
  lensParams?: string;
  lightingParams?: string;
  cameraMove?: string;
  visualPrompt: string;
  dialogue?: { speaker: string; direction?: string; text: string };
  beatId?: string;
}

/**
 * PromptOptimizer: Production-grade token optimization, prompt caching layout,
 * and context compression engine.
 */
export class PromptOptimizer {
  // Baseline heuristic; the provider's actual minimum can be higher for a selected model.
  public static readonly ANTHROPIC_CACHE_MIN_TOKENS = 1024;
  public static readonly TOKENS_PER_CHAR_RATIO = 3.0; // rough Vietnamese/multilingual estimate; not a provider tokenizer

  /**
   * Rough token estimate (Vietnamese / UTF-8 text ~ 3 characters per token); use provider usage for billing.
   */
  public static estimateTokens(text: string): number {
    if (!text) return 0;
    return Math.ceil(text.length / PromptOptimizer.TOKENS_PER_CHAR_RATIO);
  }

  /**
   * Compresses raw prompt text by stripping redundant whitespace, markdown filler,
   * polite verbiage, and duplicate punctuation while preserving semantic structure.
   */
  public static compressPromptText(raw: string): string {
    if (!raw) return "";

    return raw
      .replace(/\r\n/g, "\n")
      .replace(/[ \t]+/g, " ") // Collapse multiple horizontal spaces
      .replace(/\n{3,}/g, "\n\n") // Collapse 3+ newlines to 2
      .replace(/\b(vui lòng|hãy giúp tôi|xin lưu ý rằng|bạn hãy|chúng ta cần)\b/gi, "") // Strip polite conversational filler
      .replace(/\b(please note that|please ensure|kindly note)\b/gi, "")
      .trim();
  }

  /**
   * Cleans horizontal anamorphic or widescreen artifacts that distort 9:16 mobile framing.
   */
  public static cleanHorizontalPromptArtifacts(prompt: string): string {
    if (!prompt) return "";
    return prompt
      .replace(/\b(?:anamorphic(?:\s*(?:2\.39:1|lens))?|widescreen(?:\s*16:9)?|horizontal\s*pan(?:orama)?|panoramic(?:\s*view)?)\b/gi, "")
      .replace(/\b(?:split\s*screen\s*(?:left\s*right|horizontally)|side\s*by\s*side\s*horizontal)\b/gi, "")
      .replace(/\s{2,}/g, " ")
      .trim();
  }

  /**
   * Injects high-retention 9:16 vertical composition modifiers tailored for mobile short-form video.
   */
  public static injectVerticalPromptModifiers(prompt: string, shotType?: string): string {
    let cleaned = this.cleanHorizontalPromptArtifacts(prompt);

    const hasVertical = /vertical|9:16|portrait\s*composition|mobile\s*framing/i.test(cleaned);
    if (!hasVertical) {
      cleaned = `${cleaned}, vertical 9:16 portrait composition, mobile cinematic framing, centered subject, eye-level framing, vertical depth of field`;
    }

    if (shotType === "close_up" && !/upper-third/i.test(cleaned)) {
      cleaned = `${cleaned}, extreme close-up mobile framing, eye-level upper-third line, sharp facial details`;
    } else if (shotType === "establishing" && !/vertical\s*architecture/i.test(cleaned)) {
      cleaned = `${cleaned}, vertical architecture leading lines, tall vertical frame, high contrast mobile lighting`;
    } else if (shotType === "over_the_shoulder" && !/action\s*safe\s*zone/i.test(cleaned)) {
      cleaned = `${cleaned}, vertical over-the-shoulder framing, action safe zone centered`;
    } else if (shotType === "medium" && !/depth-stacked/i.test(cleaned)) {
      cleaned = `${cleaned}, depth-stacked vertical framing, upper and lower thirds composition`;
    }

    return cleaned.replace(/,\s*,/g, ",").replace(/^,\s*/, "").replace(/,\s*$/, "").trim();
  }

  /**
   * Applies Rolling Exponential Decay to historical episode summaries.
   * - Episode N-1: Detailed summary (logline + major events + state out).
   * - Episode N-2 & N-3: Concise summary (single sentence logline + turning point).
   * - Episode 1..N-4: Macro arc summary (condensed single sentence per era).
   * Reduces repeated historical context; actual token savings depend on the provider tokenization and usage.
   */
  public static applyRollingContextDecay(
    summaries: EpisodeSummaryRecord[],
    currentEpisode: number
  ): DecayedEpisodeSummary[] {
    if (!summaries || summaries.length === 0) return [];

    // Filter only preceding episodes
    const pastSummaries = summaries
      .filter((s) => s.episode_number < currentEpisode)
      .sort((a, b) => a.episode_number - b.episode_number);

    if (pastSummaries.length === 0) return [];

    const result: DecayedEpisodeSummary[] = [];
    const macroOldEpisodes: EpisodeSummaryRecord[] = [];

    for (const s of pastSummaries) {
      const distance = currentEpisode - s.episode_number;

      if (distance === 1) {
        // Immediate predecessor: Detailed
        const majorEventsStr =
          Array.isArray(s.major_events) && s.major_events.length > 0
            ? ` Biến cố: ${s.major_events.slice(0, 3).join("; ")}.`
            : "";
        result.push({
          episodeNumber: s.episode_number,
          tier: "detailed",
          text: `Tập ${s.episode_number} ("${s.title}"): ${s.logline || "Diễn biến tiếp tục."}${majorEventsStr}`,
        });
      } else if (distance <= 3) {
        // Intermediate distance: Concise (1 sentence)
        const firstSentence = s.logline ? s.logline.split(/\.\s+/)[0].replace(/\.+$/, "") : s.title;
        result.push({
          episodeNumber: s.episode_number,
          tier: "concise",
          text: `Tập ${s.episode_number}: ${firstSentence}.`,
        });
      } else {
        // Distant past: Accumulate into macro tier
        macroOldEpisodes.push(s);
      }
    }

    if (macroOldEpisodes.length > 0) {
      const minEp = macroOldEpisodes[0].episode_number;
      const maxEp = macroOldEpisodes[macroOldEpisodes.length - 1].episode_number;
      const keyEvents = macroOldEpisodes
        .map((e) => e.logline ? e.logline.split(/\.\s+/)[0].replace(/\.+$/, "") : e.title)
        .slice(0, 3)
        .join(" -> ");

      result.unshift({
        episodeNumber: minEp,
        tier: "macro",
        text: `Tiền truyện Tập ${minEp}-${maxEp} (Tóm lược vĩ mô): ${keyEvents}.`,
      });
    }

    return result;
  }

  /**
   * Filters characters strictly to those participating in the current episode/scene.
   * Eliminates irrelevant character profile bloat.
   */
  public static filterActiveCharactersForScene(
    allCharacters: CharacterRecord[],
    sceneParticipantIds: string[],
    leadProtagonistId?: string
  ): CharacterRecord[] {
    const idSet = new Set(sceneParticipantIds);
    if (leadProtagonistId) idSet.add(leadProtagonistId);

    // If no specific participants indicated, retain main cast only (protagonist & antagonist)
    if (idSet.size === 0) {
      return allCharacters.filter(
        (c) => c.role === "protagonist" || c.role === "antagonist"
      );
    }

    return allCharacters.filter((c) => idSet.has(c.id));
  }

  /**
   * Builds a two-tier Cache-Aware prompt structure.
   * The Static Invariant Prefix contains stable director rules, series metadata, archetypes,
   * and only the immutable world rules explicitly supplied by the caller.
   * Uses a local token estimate to decide whether to attach an Anthropic-style ephemeral cache marker.
   * Provider acceptance, cache hits, pricing, and latency must be verified from API usage and current rate cards.
   */
  public static buildCacheablePromptStructure(options: {
    seriesMeta: SeriesMetadataRecord | null;
    coreWorldRules?: string[];
    turnaroundArchetypes?: Array<{ name: string; visualSummary: string }>;
    dynamicUserPrompt: string;
    episodeNumber: number;
    forceCacheHeader?: boolean; // Deprecated hint; never overrides the estimated minimum prefix size.
  }): CacheablePromptPayload {
    const staticLines: string[] = [];

    // 1. Director Persona & Cinema Grammar (Invariant)
    staticLines.push("=== ĐẠO DIỄN ĐIỆN ẢNH & BIÊN KỊCH CHUYÊN NGHIỆP (CINEMATIC SHOWRUNNER) ===");
    staticLines.push(
      "Nhiệm vụ: Chuyển thể nội dung thành Kịch Bản Phân Cảnh Điện Ảnh Đa Cảnh (Multi-Scene Screenplay)."
    );
    staticLines.push(
      "Quy tắc 5-Shot Coverage Hollywood: Bắt buộc đan xen Establishing, Wide, Medium, OTS (Over-The-Shoulder), Close-up."
    );
    staticLines.push(
      "Yêu cầu cú máy: Mỗi cú máy phải ghi rõ loại góc máy (establishing, wide, medium, close_up, action) và thời lượng (3s - 10s)."
    );
    staticLines.push(
      "Chỉ đạo diễn xuất: Thoại luôn kèm cảm xúc trong ngoặc vuông đầu câu, ví dụ: [thì thầm, căm hận] Lời thoại..."
    );

    // 2. Series Invariant World & Visual Style
    if (options.seriesMeta) {
      staticLines.push(`\n=== QUY TẮC THẾ GIỚI & PHONG CÁCH SERIES CỐ ĐỊNH ===`);
      staticLines.push(`Series: "${options.seriesMeta.title}" (Thể loại: ${options.seriesMeta.genre || "Điện ảnh"})`);
      staticLines.push(`Phong cách thị giác (Visual Style): ${options.seriesMeta.visual_style || "Cinematic 35mm film"}`);
      if (options.seriesMeta.aspect_ratio) {
        staticLines.push(`Tỷ lệ khung hình: ${options.seriesMeta.aspect_ratio}`);
      }
    }

    // 3. Core World Rules
    if (options.coreWorldRules && options.coreWorldRules.length > 0) {
      staticLines.push("\n[QUY TẮC BẤT DI BẤT DỊCH CỦA THẾ GIỚI]");
      for (const rule of options.coreWorldRules) {
        staticLines.push(`- ${rule}`);
      }
    }

    // 4. Character Turnaround Archetypes (Invariant visual identities)
    if (options.turnaroundArchetypes && options.turnaroundArchetypes.length > 0) {
      staticLines.push("\n[HỒ SƠ THỊ GIÁC NHÂN VẬT GỐC (TURNAROUND ARCHETYPES)]");
      for (const t of options.turnaroundArchetypes) {
        staticLines.push(`- ${t.name}: ${t.visualSummary}`);
      }
    }

    const staticSystemText = staticLines.join("\n");
    const staticTokens = PromptOptimizer.estimateTokens(staticSystemText);

    const isCacheEligible = staticTokens >= PromptOptimizer.ANTHROPIC_CACHE_MIN_TOKENS;

    const systemPromptBlocks: CacheablePromptBlock[] = [
      {
        type: "text",
        text: staticSystemText,
        ...(isCacheEligible ? { cache_control: { type: "ephemeral" } } : {}),
      },
    ];

    // Dynamic User Suffix (Changes per episode)
    const compressedDynamic = PromptOptimizer.compressPromptText(options.dynamicUserPrompt);
    const dynamicTokens = PromptOptimizer.estimateTokens(compressedDynamic);

    const userPromptBlocks: CacheablePromptBlock[] = [
      {
        type: "text",
        text: compressedDynamic,
      },
    ];

    return {
      systemPromptBlocks,
      userPromptBlocks,
      estimatedStaticTokens: staticTokens,
      estimatedDynamicTokens: dynamicTokens,
      isCacheEligible,
    };
  }

  /**
   * Encodes a verbose screenplay string into Compact Cinema Shorthand Notation.
   * Compresses screenplay structure; token savings and round-trip fidelity depend on the input grammar.
   *
   * Example:
   * C1.1 [EST|4s|35mm|chiaroscuro|fog|dolly_in]: Rừng nguyên sinh mờ sương. [BEAT: b01]
   * NAM [thì thầm, lo lắng]: Chúng ta không còn nhiều thời gian.
   */
  public static toCompactCinemaNotation(rawScript: string): string {
    const lines = rawScript.split("\n");
    const compactLines: string[] = [];

    let currentScene = 1;
    let currentShot = 1;

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) {
        compactLines.push("");
        continue;
      }

      // Match Scene Header
      const sceneMatch = trimmed.match(/^CẢNH\s*(\d+)[:\s]*(.*)$/i);
      if (sceneMatch) {
        currentScene = parseInt(sceneMatch[1], 10);
        currentShot = 1;
        compactLines.push(`CẢNH ${currentScene}: ${sceneMatch[2].trim()}`);
        continue;
      }

      // Match Shot Header: CÚ MÁY 1 (establishing, 4s): <prompt>
      const shotMatch = trimmed.match(
        /^CÚ MÁY\s*(\d+)\s*\(([^,\)]+)(?:,\s*(\d+)s)?\)\s*:\s*(.*)$/i
      );
      if (shotMatch) {
        const sNum = parseInt(shotMatch[1], 10) || currentShot;
        currentShot = sNum + 1;
        const shotTypeRaw = shotMatch[2].trim().toLowerCase();
        const duration = shotMatch[3] ? `${shotMatch[3]}s` : "4s";
        const prompt = shotMatch[4].trim();

        let code = "MED";
        if (shotTypeRaw.includes("establishing")) code = "EST";
        else if (shotTypeRaw.includes("wide")) code = "WIDE";
        else if (shotTypeRaw.includes("close") && shotTypeRaw.includes("extreme")) code = "ECU";
        else if (shotTypeRaw.includes("close")) code = "CU";
        else if (shotTypeRaw.includes("ots_b_a") || shotTypeRaw.includes("ots_ba")) code = "OTS_BA";
        else if (shotTypeRaw.includes("ots") || shotTypeRaw.includes("vai")) code = "OTS";
        else if (shotTypeRaw.includes("two") || shotTypeRaw.includes("hai người")) code = "TWO";
        else if (shotTypeRaw.includes("action") || shotTypeRaw.includes("hành động")) code = "ACT";

        compactLines.push(`C${currentScene}.${sNum} [${code}|${duration}]: ${prompt}`);
        continue;
      }

      // Dialogue or normal lines
      compactLines.push(trimmed);
    }

    return compactLines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  }

  /**
   * Expands Compact Cinema Shorthand Notation back into standard format
   * for seamless compatibility with script-normalizer.ts.
   *
   * Example:
   * C1.1 [EST|4s]: Toàn cảnh rừng mờ sương. -> CÚ MÁY 1 (establishing, 4s): Toàn cảnh rừng mờ sương.
   */
  public static expandCompactCinemaNotation(compactScript: string): string {
    const lines = compactScript.split("\n");
    const expandedLines: string[] = [];

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) {
        expandedLines.push("");
        continue;
      }

      // Match compact shot: C1.2 [CU|5s]: Gương mặt Mai căng thẳng...
      // or C1.2 [EST|4s|35mm|fog]: ...
      const compactMatch = trimmed.match(/^C\d+\.(\d+)\s*\[([A-Z0-9_]+)\|(\d+)s(?:\|([^\]]+))?\]\s*:\s*(.*)$/i);
      if (compactMatch) {
        const shotNum = compactMatch[1];
        const code = compactMatch[2].toUpperCase();
        const duration = compactMatch[3];
        const extraTags = compactMatch[4] ? compactMatch[4].split("|").join(", ") : "";
        const prompt = compactMatch[5].trim();

        let shotType = "medium";
        if (code === "EST") shotType = "establishing";
        else if (code === "WIDE") shotType = "wide";
        else if (code === "CU") shotType = "close_up";
        else if (code === "ECU") shotType = "extreme_close_up";
        else if (code === "OTS_BA") shotType = "ots_b_a";
        else if (code === "OTS") shotType = "ots_a_b";
        else if (code === "TWO") shotType = "two_shot";
        else if (code === "ACT") shotType = "action";

        const tagsSuffix = extraTags ? ` (${extraTags})` : "";
        expandedLines.push(`CÚ MÁY ${shotNum} (${shotType}, ${duration}s): ${prompt}${tagsSuffix}`);
        continue;
      }

      expandedLines.push(trimmed);
    }

    return expandedLines.join("\n");
  }
}
