import axios from "axios";
import { BibleManager } from "../bible/bible-manager.js";
import { normalizeScript, parseRawScreenplay } from "./script-normalizer.js";
import type { EpisodicScript } from "./series-schema.js";

export interface StoryToScreenplayOptions {
  seriesId: string;
  prompt?: string;
  storyText?: string;
  episodeNumber?: number;
  targetScenes?: number;
  targetShotsPerScene?: number;
  tone?: string;
  llmApiKey?: string;
  llmProvider?: "anthropic" | "openai" | "gemini" | "custom";
  customLlmInvoker?: (prompt: string, systemPrompt?: string) => Promise<string>;
  skipAudit?: boolean;
}

export interface GeneratedScreenplayResult {
  rawScreenplay: string;
  script: EpisodicScript;
  charactersUsed: string[];
  propsUsed: string[];
  sceneCount: number;
  shotCount: number;
  estimatedDurationSec: number;
  canonContextSummary: string;
  generatorUsed: "llm" | "rule_based";
}

/**
 * Story/Prompt-to-Screenplay AI Generator.
 *
 * Converts a rough premise, short prompt, or full novel chapter into a cinema-ready
 * episodic screenplay with multi-shot breakdown, dialogue, and timing,
 * strictly anchored to the series Story Bible (canon memory, characters, key props, world state).
 */
export class StoryToScreenplayGenerator {
  private bible: BibleManager;

  constructor(bible: BibleManager) {
    this.bible = bible;
  }

  /**
   * Generates a fully compliant EpisodicScript from a short prompt or full story text.
   */
  public async generateScreenplay(
    options: StoryToScreenplayOptions
  ): Promise<GeneratedScreenplayResult> {
    const { seriesId } = options;
    const seriesMeta = this.bible.getSeriesMetadata(seriesId);
    const existingChars = this.bible.listCharacters(seriesId);
    const existingProps = this.bible.listKeyProps(seriesId);
    const worldState = this.bible.getAllWorldState(seriesId);
    const history = this.bible.getCanonHistory(seriesId);

    // Determine episode number
    let episodeNumber = options.episodeNumber;
    if (episodeNumber === undefined) {
      episodeNumber = history.length > 0 ? history[history.length - 1].episode_number + 1 : 1;
    }

    const canonSummary = this.buildCanonContextSummary({
      seriesMeta,
      existingChars,
      existingProps,
      worldState,
      history,
      episodeNumber,
    });

    let rawScreenplay = "";
    let generatorUsed: "llm" | "rule_based" = "rule_based";

    // Try LLM if configured
    if (options.customLlmInvoker) {
      try {
        rawScreenplay = await this.generateViaCustomInvoker(options, canonSummary, episodeNumber);
        generatorUsed = "llm";
      } catch (err) {
        rawScreenplay = this.generateRuleBasedScreenplay(options, canonSummary, episodeNumber);
      }
    } else if (options.llmApiKey || process.env.ANTHROPIC_API_KEY || process.env.OPENAI_API_KEY || process.env.GEMINI_API_KEY) {
      try {
        rawScreenplay = await this.generateViaLlmApi(options, canonSummary, episodeNumber);
        generatorUsed = "llm";
      } catch (err) {
        rawScreenplay = this.generateRuleBasedScreenplay(options, canonSummary, episodeNumber);
      }
    } else {
      rawScreenplay = this.generateRuleBasedScreenplay(options, canonSummary, episodeNumber);
    }

    // Clean up code blocks if LLM output markdown fences
    rawScreenplay = this.stripMarkdownFences(rawScreenplay);

    // Normalize and validate through script normalizer
    const script = await normalizeScript(rawScreenplay, this.bible, {
      seriesId,
      skipAudit: options.skipAudit ?? false,
    });

    // Compute stats
    let shotCount = 0;
    let estimatedDurationSec = 0;
    const charactersSet = new Set<string>();
    const propsSet = new Set<string>();

    for (const scene of script.scenes) {
      if (Array.isArray(scene.charactersPresent)) {
        for (const cp of scene.charactersPresent) {
          const charId = typeof cp === "string" ? cp : (cp as any)?.characterId;
          if (charId) charactersSet.add(charId);
        }
      }
      if (Array.isArray(scene.propsPresent)) {
        for (const prop of scene.propsPresent) {
          if (prop) {
            propsSet.add(prop);
            const foundProp = existingProps.find((p) => p.id === prop || p.name === prop);
            if (foundProp) {
              propsSet.add(foundProp.name);
            }
          }
        }
      }
      for (const shot of scene.shots) {
        shotCount++;
        estimatedDurationSec += shot.durationSec ?? (shot as any).targetDurationSec ?? 0;
      }
    }

    return {
      rawScreenplay,
      script,
      charactersUsed: Array.from(charactersSet),
      propsUsed: Array.from(propsSet),
      sceneCount: script.scenes.length,
      shotCount,
      estimatedDurationSec,
      canonContextSummary: canonSummary,
      generatorUsed,
    };
  }

  /**
   * Builds rich context from Story Bible for canon memory continuity.
   */
  private buildCanonContextSummary(ctx: {
    seriesMeta: any;
    existingChars: any[];
    existingProps: any[];
    worldState: Record<string, unknown>;
    history: any[];
    episodeNumber: number;
  }): string {
    const lines: string[] = [];

    if (ctx.seriesMeta) {
      lines.push(`Series: "${ctx.seriesMeta.title}" (Thể loại: ${ctx.seriesMeta.genre || "Điện ảnh"})`);
      lines.push(`Phong cách thị giác: ${ctx.seriesMeta.visual_style}`);
    }

    if (ctx.existingChars.length > 0) {
      lines.push("\nNhân vật đã thiết lập (Canon Characters):");
      for (const char of ctx.existingChars) {
        lines.push(
          `- ${char.name} (id: ${char.id}, trạng thái: ${char.status}): ${char.visual_summary}. Dấu hiệu: ${char.distinguishing_marks || "không"}.`
        );
      }
    }

    if (ctx.existingProps.length > 0) {
      lines.push("\nĐạo cụ quan trọng (Key Props):");
      for (const prop of ctx.existingProps) {
        lines.push(
          `- ${prop.name} (id: ${prop.id}): Người nắm giữ hiện tại: ${prop.current_holder_id || "chưa xác định"}. ${prop.description || ""}`
        );
      }
    }

    if (Object.keys(ctx.worldState).length > 0) {
      lines.push("\nTrạng thái thế giới hiện tại (World State):");
      for (const [k, v] of Object.entries(ctx.worldState)) {
        lines.push(`- ${k}: ${JSON.stringify(v)}`);
      }
    }

    if (ctx.history.length > 0) {
      lines.push("\nTóm tắt các tập trước (Preceding Episodes):");
      for (const ep of ctx.history) {
        lines.push(`Tập ${ep.episode_number}: "${ep.title}". Logline: ${ep.logline}`);
        if (Array.isArray(ep.major_events) && ep.major_events.length > 0) {
          lines.push(`  Sự kiện chính: ${ep.major_events.join("; ")}`);
        }
      }
    }

    return lines.join("\n");
  }

  /**
   * Generates screenplay via custom LLM invoker.
   */
  private async generateViaCustomInvoker(
    options: StoryToScreenplayOptions,
    canonSummary: string,
    episodeNumber: number
  ): Promise<string> {
    const prompt = this.buildLlmPrompt(options, canonSummary, episodeNumber);
    const systemPrompt = this.buildSystemPrompt();
    return options.customLlmInvoker!(prompt, systemPrompt);
  }

  /**
   * Generates screenplay via standard Cloud LLM API.
   */
  private async generateViaLlmApi(
    options: StoryToScreenplayOptions,
    canonSummary: string,
    episodeNumber: number
  ): Promise<string> {
    const prompt = this.buildLlmPrompt(options, canonSummary, episodeNumber);
    const systemPrompt = this.buildSystemPrompt();

    // 1. Anthropic Claude
    const anthropicKey = options.llmApiKey || process.env.ANTHROPIC_API_KEY;
    if (options.llmProvider === "anthropic" || anthropicKey) {
      const res = await axios.post(
        "https://api.anthropic.com/v1/messages",
        {
          model: "claude-3-5-sonnet-20241022",
          max_tokens: 4000,
          system: systemPrompt,
          messages: [{ role: "user", content: prompt }],
        },
        {
          headers: {
            "x-api-key": anthropicKey,
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
          },
          timeout: 45000,
        }
      );
      return res.data?.content?.[0]?.text || "";
    }

    // 2. OpenAI
    const openAiKey = options.llmApiKey || process.env.OPENAI_API_KEY;
    if (options.llmProvider === "openai" || openAiKey) {
      const res = await axios.post(
        "https://api.openai.com/v1/chat/completions",
        {
          model: "gpt-4o",
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: prompt },
          ],
        },
        {
          headers: {
            Authorization: `Bearer ${openAiKey}`,
            "Content-Type": "application/json",
          },
          timeout: 45000,
        }
      );
      return res.data?.choices?.[0]?.message?.content || "";
    }

    // Fallback to rule based
    return this.generateRuleBasedScreenplay(options, canonSummary, episodeNumber);
  }

  /**
   * Builds system prompt for screenplay generation.
   */
  private buildSystemPrompt(): string {
    return `Bạn là một Nhà Biên Kịch Điện Ảnh Chuyên Nghiệp (Showrunner & Screenwriter).
Nhiệm vụ của bạn là chuyển thể ý tưởng, cốt truyện hoặc chương truyện thành Kịch Bản Phân Cảnh Điện Ảnh Đa Cảnh (Episodic Screenplay) tuân thủ định dạng chuẩn sau:

ĐỊNH DẠNG BẮT BUỘC:
TẬP <số>: <TIÊU ĐỀ TẬP VIẾT HOA>
Logline: <Câu tóm tắt cốt truyện 1 câu>

CẢNH 1: <TÊN BỐI CẢNH - THỜI GIAN>
Nhân vật: <Tên nhân vật 1>, <Tên nhân vật 2>
Đạo cụ: <Tên đạo cụ nếu có>
CÚ MÁY 1 (establishing, 4s): <Mô tả hình ảnh chi tiết phục vụ AI Video Generator>
CÚ MÁY 2 (medium, 4s): <Mô tả hành động của nhân vật>
<TÊN NHÂN VẬT>: <Lời thoại của nhân vật>
CÚ MÁY 3 (close_up, 4s): <Mô tả biểu cảm cận cảnh>

QUY TẮC BẤT DI BẤT DỊCH:
1. Luôn tuân thủ tuyệt đối Story Bible: Nhân vật đang bị thương ('injured') không được vận động thể lực cường độ cao nếu không có phân cảnh chữa trị; nhân vật đã chết ('deceased') chỉ xuất hiện trong [HỒI TƯỞNG]; đạo cụ thuộc về đúng người đang giữ.
2. Mỗi cú máy phải có loại cú máy hợp lệ (establishing, wide, medium, close_up, action) và thời lượng (3s - 6s).
3. Đảm bảo cấu trúc 3 cảnh rõ ràng: Cảnh 1 (Khởi đầu/Setup), Cảnh 2 (Xung đột/Confrontation), Cảnh 3 (Cao trào/Cliffhanger).`;
  }

  /**
   * Builds prompt sent to LLM.
   */
  private buildLlmPrompt(
    options: StoryToScreenplayOptions,
    canonSummary: string,
    episodeNumber: number
  ): string {
    const inputContent = options.prompt || options.storyText || "Hành trình tiếp tục của các nhân vật.";
    const targetScenes = options.targetScenes || 3;

    return `Hãy viết kịch bản điện ảnh Tập ${episodeNumber} cho Series với các thông tin sau:

=== KÝ ỨC VÀ BỘ NHỚ CANON (STORY BIBLE) ===
${canonSummary}

=== ĐẦU VÀO CỐT TRUYỆN / Ý TƯỞNG CỦA ĐẠO DIỄN ===
${inputContent}

YÊU CẦU:
- Số cảnh mục tiêu: ${targetScenes} cảnh.
- Nhịp phim: ${options.tone || "Kịch tính, điện ảnh, giàu cảm xúc"}.
- Xuất đúng định dạng kịch bản phân cảnh thuần túy (không kèm lời chào hay giải thích ngoài kịch bản).`;
  }

  /**
   * Rule-Based Intelligent Screenplay Generator (Deterministic Offline Fallback).
   * Parses raw input text, identifies characters, dialogues, actions, and builds a valid EpisodicScript.
   */
  public generateRuleBasedScreenplay(
    options: StoryToScreenplayOptions,
    canonSummary: string,
    episodeNumber: number
  ): string {
    const input = (options.prompt || options.storyText || "").trim();
    const existingChars = this.bible.listCharacters(options.seriesId);
    const existingProps = this.bible.listKeyProps(options.seriesId);

    // 1. Derive Title & Logline
    let title = `TẬP ${episodeNumber}: KHỞI ĐẦU MỚI`;
    let logline = input.length > 0 ? input.slice(0, 120) : "Các nhân vật đối mặt với thử thách mới.";

    const lines = input.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    if (lines.length > 0 && lines[0].length < 60 && !lines[0].includes(":")) {
      title = `TẬP ${episodeNumber}: ${lines[0].toUpperCase()}`;
    }

    // 2. Identify characters present in text
    const matchedChars: string[] = [];
    const inputLower = input.toLowerCase();
    for (const c of existingChars) {
      if (inputLower.includes(c.name.toLowerCase()) || existingChars.length <= 3) {
        matchedChars.push(c.name);
      }
    }
    if (matchedChars.length === 0) {
      matchedChars.push("Nhân vật chính");
    }

    // 3. Identify props present in text
    const matchedProps: string[] = [];
    for (const p of existingProps) {
      if (inputLower.includes(p.name.toLowerCase()) || inputLower.includes(p.id.toLowerCase())) {
        matchedProps.push(p.name);
      }
    }

    // 4. Split sentences/paragraphs into 3 Scenes
    const sceneParagraphs = this.partitionIntoScenes(lines, options.targetScenes || 3);

    const screenplayParts: string[] = [];
    screenplayParts.push(`TẬP ${episodeNumber}: ${title.replace(/^TẬP\s*\d+:\s*/i, "")}`);
    screenplayParts.push(`Logline: ${logline.replace(/\r?\n/g, " ")}\n`);

    const defaultLocations = [
      "KHU PHỐ CỔ - ĐÊM",
      "CĂN HẦM BÍ MẬT - ĐÊM",
      "SÂN THƯỢNG TÒA NHÀ TRUNG TÂM - RẠNG ĐÔNG",
    ];

    sceneParagraphs.forEach((paraLines, idx) => {
      const sceneNum = idx + 1;
      const location = defaultLocations[idx % defaultLocations.length];
      screenplayParts.push(`CẢNH ${sceneNum}: ${location}`);
      screenplayParts.push(`Nhân vật: ${matchedChars.slice(0, 3).join(", ")}`);
      if (matchedProps.length > 0) {
        screenplayParts.push(`Đạo cụ: ${matchedProps[0]}`);
      }

      // Generate shots for this scene
      const sceneShots = this.generateShotsForScene(paraLines, matchedChars, sceneNum);
      for (const s of sceneShots) {
        screenplayParts.push(s);
      }
      screenplayParts.push(""); // blank line
    });

    return screenplayParts.join("\n").trim();
  }

  /**
   * Partitions input lines into N scene buckets.
   */
  private partitionIntoScenes(lines: string[], targetScenes: number): string[][] {
    if (lines.length <= targetScenes) {
      const buckets: string[][] = Array.from({ length: targetScenes }, () => []);
      lines.forEach((l, i) => {
        buckets[i % targetScenes].push(l);
      });
      return buckets;
    }

    const chunkSize = Math.ceil(lines.length / targetScenes);
    const result: string[][] = [];
    for (let i = 0; i < targetScenes; i++) {
      const chunk = lines.slice(i * chunkSize, (i + 1) * chunkSize);
      result.push(chunk.length > 0 ? chunk : ["Không khí im lặng bao trùm không gian."]);
    }
    return result;
  }

  /**
   * Generates cinematic shots and dialogues from text lines.
   */
  private generateShotsForScene(
    lines: string[],
    characters: string[],
    sceneNumber: number
  ): string[] {
    const shots: string[] = [];
    const leadChar = characters[0] || "Minh";
    const secondChar = characters[1] || characters[0] || "An";

    // Shot 1: Establishing
    shots.push(
      `CÚ MÁY 1 (establishing, 4s): Toàn cảnh không gian tĩnh mịch với ánh sáng điện ảnh tương phản cao.`
    );

    // Shot 2: Medium lead action
    const textSnippet = lines[0] || `Nhân vật ${leadChar} thận trọng quan sát xung quanh.`;
    shots.push(
      `CÚ MÁY 2 (medium, 4s): ${leadChar} bước vào khung hình. ${textSnippet.slice(0, 90)}.`
    );

    // Dialogue 1
    const extractedQuote = this.extractQuote(lines);
    const dialogueLine = extractedQuote || "Chúng ta cần hành động ngay trước khi quá muộn.";
    shots.push(`${leadChar.toUpperCase()}: ${dialogueLine}`);

    // Shot 3: Close up reaction or action
    if (characters.length > 1) {
      shots.push(
        `CÚ MÁY 3 (close_up, 4s): Cận cảnh gương mặt của ${secondChar} lộ rõ vẻ kiên định, gật đầu đồng thuận.`
      );
      shots.push(`${secondChar.toUpperCase()}: Tôi đã chuẩn bị mọi thứ sẵn sàng.`);
    } else {
      shots.push(
        `CÚ MÁY 3 (close_up, 4s): Cận cảnh ánh mắt quyết đoán của ${leadChar}, sẵn sàng đối mặt với hiểm nguy.`
      );
    }

    // Shot 4: Wide transition/outro of scene
    shots.push(
      `CÚ MÁY 4 (wide, 4s): Góc máy rộng ghi lại khoảnh khắc cả hai bắt đầu triển khai kế hoạch trong bóng tối.`
    );

    return shots;
  }

  /**
   * Extracts direct dialogue quote from text if present.
   */
  private extractQuote(lines: string[]): string | null {
    for (const l of lines) {
      const match = l.match(/["“]([^"”]+)["”]/);
      if (match && match[1].length > 3) {
        return match[1];
      }
    }
    return null;
  }

  /**
   * Strips markdown fences (``` ... ```) from LLM raw output.
   */
  private stripMarkdownFences(text: string): string {
    let clean = text.trim();
    if (clean.startsWith("```")) {
      const lines = clean.split("\n");
      if (lines[0].startsWith("```")) {
        lines.shift();
      }
      if (lines.length > 0 && lines[lines.length - 1].trim().startsWith("```")) {
        lines.pop();
      }
      clean = lines.join("\n").trim();
    }
    return clean;
  }
}
