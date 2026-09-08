import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type {
  CharacterRecord,
  CharacterKnowledgeRecord,
  EpisodeSummaryRecord,
} from "./bible-manager.js";

export interface ScriptLocation {
  scene_number: number;
  shot_id?: string | null;
  line_quote: string;
}

export type ContradictionType =
  | "character_status"
  | "knowledge_state"
  | "physical_description"
  | "timeline"
  | "item_continuity"
  | "relationship_or_world_rule";

export type ContradictionSeverity = "critical" | "moderate" | "minor";

export interface ContradictionReport {
  severity: ContradictionSeverity;
  type: ContradictionType;
  description: string;
  bible_reference: string;
  script_location: ScriptLocation;
  recommended_fix: string;
}

export interface ContinuityAuditResult {
  episode_number: number;
  thought_process: string[];
  contradictions: ContradictionReport[];
  audit_status: "PASS" | "WARN" | "FAIL";
  summary: string;
}

export interface StoryBiblePayload {
  characters: CharacterRecord[];
  character_knowledge: CharacterKnowledgeRecord[];
  world_state: Record<string, unknown>;
  episode_summaries: EpisodeSummaryRecord[];
}

export type LlmInvoker = (prompt: string) => Promise<string>;

/**
 * Escapes XML-sensitive characters to prevent structural breakout in XML packaging.
 */
export function escapeXmlContent(content: string): string {
  return content
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * Deterministically derives the audit status from the list of verified contradictions:
 * - FAIL if at least 1 contradiction is 'critical'
 * - WARN if no 'critical', but at least 1 'moderate' or 'minor'
 * - PASS if contradictions list is empty
 */
export function deriveAuditStatus(contradictions: ContradictionReport[]): "PASS" | "WARN" | "FAIL" {
  if (!contradictions || contradictions.length === 0) {
    return "PASS";
  }
  const hasCritical = contradictions.some((c) => c.severity === "critical");
  if (hasCritical) {
    return "FAIL";
  }
  return "WARN";
}

/**
 * Assembles the prompt payload by packaging Story Bible, Draft Script, and Episode Number
 * inside isolated XML containers to eliminate Prompt Injection vulnerabilities.
 */
export function buildAuditPrompt(
  episodeNumber: number,
  bible: StoryBiblePayload,
  draftScript: string,
  basePromptTemplate?: string
): string {
  const template = basePromptTemplate ?? loadDefaultPromptTemplate();

  const bibleJson = JSON.stringify(bible, null, 2);

  return `
${template}

<story_bible>
${escapeXmlContent(bibleJson)}
</story_bible>

<draft_script>
${escapeXmlContent(draftScript)}
</draft_script>

<episode_number>
${episodeNumber}
</episode_number>
`.trim();
}

/**
 * Loads the default continuity-auditor.prompt template from disk if available.
 */
function loadDefaultPromptTemplate(): string {
  try {
    const dir = dirname(fileURLToPath(import.meta.url));
    const localPromptPath = join(dir, "continuity-auditor.prompt");
    if (existsSync(localPromptPath)) {
      return readFileSync(localPromptPath, "utf-8");
    }
  } catch {
    // Ignore error if import.meta.url is unavailable
  }

  const promptPath = join(process.cwd(), "src", "bible", "continuity-auditor.prompt");
  if (existsSync(promptPath)) {
    return readFileSync(promptPath, "utf-8");
  }
  return "Bạn là một Continuity Auditor chuyên nghiệp.";
}

/**
 * Safely parses the raw LLM output into a typed ContinuityAuditResult.
 * Handles markdown fence stripping and enforces deterministic audit_status calculation.
 */
export function parseAuditResponse(
  rawResponse: string,
  expectedEpisode: number
): ContinuityAuditResult {
  // Strip optional markdown code fences (```json ... ```)
  let cleanText = rawResponse.trim();
  if (cleanText.startsWith("```")) {
    const lines = cleanText.split("\n");
    if (lines[0].startsWith("```")) {
      lines.shift();
    }
    if (lines.length > 0 && lines[lines.length - 1].trim().startsWith("```")) {
      lines.pop();
    }
    cleanText = lines.join("\n").trim();
  }

  const parsed = JSON.parse(cleanText);

  // Normalize contradictions
  const contradictions: ContradictionReport[] = Array.isArray(parsed.contradictions)
    ? parsed.contradictions.map((c: any) => ({
        severity: ["critical", "moderate", "minor"].includes(c.severity) ? c.severity : "moderate",
        type: [
          "character_status",
          "knowledge_state",
          "physical_description",
          "timeline",
          "item_continuity",
          "relationship_or_world_rule",
        ].includes(c.type)
          ? c.type
          : "relationship_or_world_rule",
        description: String(c.description || "Unspecified contradiction"),
        bible_reference: String(c.bible_reference || "N/A"),
        script_location: {
          scene_number: Number(c.script_location?.scene_number ?? 1),
          shot_id: c.script_location?.shot_id ? String(c.script_location.shot_id) : null,
          line_quote: String(c.script_location?.line_quote || ""),
        },
        recommended_fix: String(c.recommended_fix || ""),
      }))
    : [];

  // Deterministically enforce audit status to eliminate LLM hallucination discrepancies
  const calculatedStatus = deriveAuditStatus(contradictions);

  return {
    episode_number: Number(parsed.episode_number ?? expectedEpisode),
    thought_process: Array.isArray(parsed.thought_process) ? parsed.thought_process.map(String) : [],
    contradictions,
    audit_status: calculatedStatus,
    summary: String(parsed.summary || (calculatedStatus === "PASS" ? "Kịch bản nhất quán." : "Phát hiện mâu thuẫn.")),
  };
}

/**
 * Continuity Auditor Service
 */
/**
 * Escapes regex special characters in user/character strings.
 */
export function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Builds a Unicode-aware word-boundary regex for character names.
 * Standard \b treats accented characters (e.g. 'Đ', 'À') as non-word chars,
 * failing word boundary checks when preceded or followed by whitespace.
 */
export function buildCharacterNameRegex(name: string, suffixPattern = ""): RegExp {
  const escaped = escapeRegex(name);
  return new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])${suffixPattern}`, "iu");
}

export class ContinuityAuditor {
  private llmInvoker?: LlmInvoker;
  private promptTemplate?: string;

  constructor(options?: { llmInvoker?: LlmInvoker; promptTemplate?: string }) {
    this.llmInvoker = options?.llmInvoker;
    this.promptTemplate = options?.promptTemplate;
  }

  /**
   * Audits a draft script against the Story Bible state.
   */
  public async auditScript(
    episodeNumber: number,
    bible: StoryBiblePayload,
    draftScript: string
  ): Promise<ContinuityAuditResult> {
    const fullPrompt = buildAuditPrompt(
      episodeNumber,
      bible,
      draftScript,
      this.promptTemplate
    );

    if (!this.llmInvoker) {
      // Fallback deterministic rule-based pre-scan for offline or unit test execution
      return this.runRuleBasedAudit(episodeNumber, bible, draftScript);
    }

    const rawOutput = await this.llmInvoker(fullPrompt);
    return parseAuditResponse(rawOutput, episodeNumber);
  }

  /**
   * Fast rule-based pre-scan to catch overt critical contradictions offline.
   */
  public runRuleBasedAudit(
    episodeNumber: number,
    bible: StoryBiblePayload,
    draftScript: string
  ): ContinuityAuditResult {
    const contradictions: ContradictionReport[] = [];
    const thoughtProcess: string[] = [
      `Bắt đầu kiểm duyệt tĩnh cho tập ${episodeNumber}...`,
    ];

    // Check 1: Deceased or missing characters acting without flashback
    for (const char of bible.characters) {
      if (char.status === "deceased" || char.status === "missing") {
        const regex = buildCharacterNameRegex(char.name);
        if (regex.test(draftScript)) {
          const isFlashback =
            draftScript.toLowerCase().includes("[hồi tưởng]") ||
            draftScript.toLowerCase().includes("[flashback]") ||
            draftScript.toLowerCase().includes("[ảo giác]");

          if (!isFlashback) {
            contradictions.push({
              severity: "critical",
              type: "character_status",
              description: `Nhân vật ${char.name} có trạng thái '${char.status}' trong Story Bible nhưng xuất hiện trong kịch bản mà không được đánh dấu là hồi tưởng/flashback.`,
              bible_reference: `characters.${char.id}.status`,
              script_location: {
                scene_number: 1,
                shot_id: null,
                line_quote: `Nhân vật ${char.name} xuất hiện trong phân cảnh.`,
              },
              recommended_fix: `Chuyển cảnh thành hồi tưởng hoặc loại bỏ nhân vật ${char.name}.`,
            });
          }
        }
      }
    }

    // Check 2: Injured character performing high intensity action without medical treatment
    for (const char of bible.characters) {
      if (char.status === "injured") {
        const regex = buildCharacterNameRegex(char.name, ".*(chạy|rượt đuổi|chiến đấu|leo trèo)");
        if (regex.test(draftScript)) {
          contradictions.push({
            severity: "critical",
            type: "character_status",
            description: `Nhân vật ${char.name} đang bị thương nặng ('injured') nhưng thực hiện hành động thể lực mạnh mà không có phân cảnh chữa trị.`,
            bible_reference: `characters.${char.id}.status`,
            script_location: {
              scene_number: 1,
              shot_id: null,
              line_quote: `Hành động thể lực mạnh của ${char.name}.`,
            },
            recommended_fix: `Thêm phân cảnh điều trị hoặc giảm cường độ vận động của ${char.name}.`,
          });
        }
      }
    }

    // Check 3: Secret Knowledge Leaks
    for (const char of bible.characters) {
      const knownKeys = bible.character_knowledge
        .filter((k) => k.character_id === char.id && k.revealed_in_episode < episodeNumber)
        .map((k) => k.fact_key);

      // Example canonical secret fact: "knows_killer_identity"
      if (!knownKeys.includes("knows_killer_identity")) {
        const leakRegex = buildCharacterNameRegex(char.name, ".*(kẻ sát nhân chính là|thủ phạm là|tên giết người là)");
        if (leakRegex.test(draftScript)) {
          contradictions.push({
            severity: "critical",
            type: "knowledge_state",
            description: `Nhân vật ${char.name} chưa từng biết danh tính kẻ sát nhân tính đến trước tập ${episodeNumber}, nhưng đã tiết lộ trong kịch bản.`,
            bible_reference: `character_knowledge.${char.id}.knows_killer_identity`,
            script_location: {
              scene_number: 1,
              shot_id: null,
              line_quote: "Tiết lộ danh tính kẻ sát nhân trong lời thoại.",
            },
            recommended_fix: `Xóa lời thoại tiết lộ thông tin bí mật hoặc thêm sự kiện khám phá manh mối hợp lệ.`,
          });
        }
      }
    }

    const audit_status = deriveAuditStatus(contradictions);
    const summary =
      audit_status === "PASS"
        ? `Kịch bản tập ${episodeNumber} hoàn toàn nhất quán với Story Bible.`
        : `Phát hiện ${contradictions.length} mâu thuẫn cần khắc phục trước khi render video.`;

    thoughtProcess.push(`Hoàn tất kiểm duyệt. Kết quả: ${audit_status}.`);

    return {
      episode_number: episodeNumber,
      thought_process: thoughtProcess,
      contradictions,
      audit_status,
      summary,
    };
  }
}
