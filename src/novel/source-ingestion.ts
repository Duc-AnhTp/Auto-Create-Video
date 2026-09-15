import { createHash } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { basename } from "node:path";
import type { BibleManager, SourceWorkRecord } from "../bible/bible-manager.js";

export interface NormalizationRules {
  normalizeLineEndings?: boolean;
  stripTrailingWhitespace?: boolean;
  normalizeQuotes?: boolean;
  normalizeDashes?: boolean;
  trimSurroundingWhitespace?: boolean;
}

export const DEFAULT_NORMALIZATION_RULES: NormalizationRules = {
  normalizeLineEndings: true,
  stripTrailingWhitespace: true,
  normalizeQuotes: false,
  normalizeDashes: false,
  trimSurroundingWhitespace: true,
};

export interface SourceIngestionOptions {
  seriesId: string;
  sourceId?: string;
  title: string;
  author?: string;
  sourceType?: "novel" | "screenplay" | "markdown" | "txt";
  normalizationRules?: NormalizationRules;
  metadata?: Record<string, any>;
}

export interface IngestionResult {
  work: SourceWorkRecord;
  isNewRevision: boolean;
  previousRevision?: number;
  contentHash: string;
}

export class SourceIngestionEngine {
  /**
   * Computes SHA-256 hash of raw text
   */
  public static computeContentHash(rawText: string): string {
    return createHash("sha256").update(rawText, "utf8").digest("hex");
  }

  /**
   * Normalizes raw source text according to configured rules while preserving
   * the original text for reference and coordinate mapping.
   */
  public static normalizeText(
    rawText: string,
    rules: NormalizationRules = DEFAULT_NORMALIZATION_RULES
  ): { normalizedText: string; rulesApplied: NormalizationRules } {
    let text = rawText;

    if (rules.normalizeLineEndings) {
      text = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    }

    if (rules.stripTrailingWhitespace) {
      text = text
        .split("\n")
        .map((line) => line.trimEnd())
        .join("\n");
    }

    if (rules.normalizeQuotes) {
      // Standardize curly/smart quotes to straight quotes if desired
      text = text
        .replace(/[“”«»]/g, '"')
        .replace(/[‘’]/g, "'");
    }

    if (rules.normalizeDashes) {
      // Standardize em-dash and en-dash to hyphen or standard em-dash
      text = text.replace(/[–—]/g, "--");
    }

    if (rules.trimSurroundingWhitespace) {
      text = text.trim();
    }

    return {
      normalizedText: text,
      rulesApplied: rules,
    };
  }

  /**
   * Generates a stable source ID based on seriesId and title slug
   */
  public static generateSourceId(seriesId: string, title: string): string {
    const slug = title
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 32);
    return `src_${seriesId}_${slug || "work"}`;
  }

  /**
   * Detects the source type from file extension or content patterns
   */
  public static detectSourceType(
    filePathOrContent: string,
    isFilePath = false
  ): "novel" | "screenplay" | "markdown" | "txt" {
    if (isFilePath) {
      const lower = filePathOrContent.toLowerCase();
      if (lower.endsWith(".md") || lower.endsWith(".markdown")) return "markdown";
      if (lower.endsWith(".fountain") || lower.endsWith(".fdx")) return "screenplay";
    }

    const content = filePathOrContent.slice(0, 2000);
    // Screenplay cues: INT., EXT., CẢNH, FADE IN:
    if (
      /(?:INT\.|EXT\.|FADE IN:|CẢNH\s+\d+|HỒI\s+[I|V|X]+:)/i.test(content) &&
      /^[A-ZÀ-Ỹ\s]{2,}:/m.test(content)
    ) {
      return "screenplay";
    }

    if (/^#+\s+/m.test(content)) {
      return "markdown";
    }

    return "novel";
  }

  /**
   * Ingests a raw text string, computes content hash, handles revision tracking,
   * and saves the work into the Story Bible.
   */
  public static ingestSourceText(
    rawText: string,
    options: SourceIngestionOptions,
    bible: BibleManager
  ): IngestionResult {
    if (!rawText || rawText.trim().length === 0) {
      throw new Error("Cannot ingest empty source text");
    }

    const sourceId =
      options.sourceId ||
      SourceIngestionEngine.generateSourceId(options.seriesId, options.title);
    const contentHash = SourceIngestionEngine.computeContentHash(rawText);

    const rules = options.normalizationRules || DEFAULT_NORMALIZATION_RULES;
    const { normalizedText, rulesApplied } = SourceIngestionEngine.normalizeText(
      rawText,
      rules
    );

    const existingWork = bible.getSourceWork(sourceId);

    let revision = 1;
    let isNewRevision = false;
    let previousRevision: number | undefined;

    if (existingWork) {
      if (existingWork.content_hash === contentHash) {
        // Content is identical: idempotent return without bumping revision
        return {
          work: existingWork,
          isNewRevision: false,
          previousRevision: existingWork.current_revision,
          contentHash,
        };
      } else {
        // Content changed: increment revision
        previousRevision = existingWork.current_revision;
        revision = existingWork.current_revision + 1;
        isNewRevision = true;
      }
    } else {
      isNewRevision = true;
    }

    const workRecord: SourceWorkRecord = {
      id: sourceId,
      series_id: options.seriesId,
      title: options.title,
      author: options.author ?? null,
      source_type:
        options.sourceType ||
        SourceIngestionEngine.detectSourceType(rawText, false),
      current_revision: revision,
      content_hash: contentHash,
      raw_text: rawText,
      normalized_text: normalizedText,
      normalization_rules_json: JSON.stringify(rulesApplied),
      metadata_json: JSON.stringify(options.metadata || {}),
      created_at: existingWork?.created_at || new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    bible.upsertSourceWork(workRecord);

    return {
      work: workRecord,
      isNewRevision,
      previousRevision,
      contentHash,
    };
  }

  /**
   * Ingests a source file from disk.
   */
  public static ingestSourceFile(
    filePath: string,
    options: Omit<SourceIngestionOptions, "title"> & { title?: string },
    bible: BibleManager
  ): IngestionResult {
    if (!existsSync(filePath)) {
      throw new Error(`Source file not found: ${filePath}`);
    }

    const rawText = readFileSync(filePath, "utf8");
    const fileTitle =
      options.title ||
      basename(filePath).replace(/\.[^/.]+$/, "").replace(/[-_]/g, " ");

    const detectedType =
      options.sourceType ||
      SourceIngestionEngine.detectSourceType(filePath, true);

    return SourceIngestionEngine.ingestSourceText(
      rawText,
      {
        ...options,
        title: fileTitle,
        sourceType: detectedType,
        metadata: {
          ...options.metadata,
          original_file_path: filePath,
          file_name: basename(filePath),
        },
      },
      bible
    );
  }
}
