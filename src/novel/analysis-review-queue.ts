import type {
  LlmExtractedCharacter,
  LlmExtractedBeat,
  LlmExtractedThread,
} from "./llm-analysis-schemas.js";
import type { BibleManager, AnalysisReviewItemRecord } from "../bible/bible-manager.js";

export type ReviewItemType = "character" | "beat" | "thread";

export interface ReviewQueueItem<T = any> {
  id: string;
  type: ReviewItemType;
  seriesId: string;
  sourceId?: string;
  data: T;
  confidenceScore: number;
  reasons: string[];
  status: "pending" | "approved" | "rejected" | "modified";
  reviewedAt?: string;
  reviewNotes?: string;
  createdAt: string;
}

export class AnalysisReviewQueue {
  private items: Map<string, ReviewQueueItem> = new Map();
  private bible?: BibleManager;

  constructor(bible?: BibleManager) {
    this.bible = bible;
  }

  public setBible(bible: BibleManager): void {
    this.bible = bible;
  }

  public enqueue<T>(
    type: ReviewItemType,
    seriesId: string,
    data: T,
    options: {
      id?: string;
      sourceId?: string;
      confidenceScore?: number;
      reasons?: string[];
      autoApproveThreshold?: number;
    } = {}
  ): ReviewQueueItem<T> {
    const confidence = options.confidenceScore ?? (data as any)?.confidenceScore ?? 1.0;
    const autoApproveThreshold = options.autoApproveThreshold ?? 0.75;
    const needsReview =
      (data as any)?.needsHumanReview === true || confidence < autoApproveThreshold;

    const reasons = options.reasons || [];
    if (confidence < autoApproveThreshold) {
      reasons.push(
        `Độ tin cậy thấp: ${(confidence * 100).toFixed(1)}% < ${(autoApproveThreshold * 100).toFixed(1)}%`
      );
    }
    if ((data as any)?.needsHumanReview) {
      reasons.push("Được LLM đánh dấu cần người giám sát xác nhận.");
    }

    const id =
      options.id ||
      `rev_${type}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    const status = needsReview ? "pending" : "approved";
    const now = new Date().toISOString();

    const item: ReviewQueueItem<T> = {
      id,
      type,
      seriesId,
      sourceId: options.sourceId,
      data,
      confidenceScore: confidence,
      reasons,
      status,
      createdAt: now,
    };

    this.items.set(id, item);

    if (this.bible) {
      this.bible.enqueueReviewItem({
        id,
        type,
        series_id: seriesId,
        source_id: options.sourceId ?? null,
        data_json: JSON.stringify(data),
        confidence_score: confidence,
        reasons_json: JSON.stringify(reasons),
        status,
        created_at: now,
      });
    }

    return item;
  }

  public getPending(seriesId?: string): ReviewQueueItem[] {
    if (this.bible) {
      const records = this.bible.getPendingReviewItems(seriesId);
      for (const r of records) {
        if (!this.items.has(r.id)) {
          let parsedData = {};
          let parsedReasons: string[] = [];
          try {
            parsedData = JSON.parse(r.data_json);
          } catch {}
          try {
            parsedReasons = JSON.parse(r.reasons_json || "[]");
          } catch {}
          this.items.set(r.id, {
            id: r.id,
            type: r.type as ReviewItemType,
            seriesId: r.series_id,
            sourceId: r.source_id || undefined,
            data: parsedData,
            confidenceScore: r.confidence_score,
            reasons: parsedReasons,
            status: r.status,
            reviewedAt: r.reviewed_at || undefined,
            reviewNotes: r.review_notes || undefined,
            createdAt: r.created_at || new Date().toISOString(),
          });
        }
      }
    }

    return Array.from(this.items.values()).filter(
      (item) => item.status === "pending" && (!seriesId || item.seriesId === seriesId)
    );
  }

  public getAll(seriesId?: string): ReviewQueueItem[] {
    if (this.bible) {
      const records = this.bible.listReviewItems(seriesId);
      for (const r of records) {
        if (!this.items.has(r.id)) {
          let parsedData = {};
          let parsedReasons: string[] = [];
          try {
            parsedData = JSON.parse(r.data_json);
          } catch {}
          try {
            parsedReasons = JSON.parse(r.reasons_json || "[]");
          } catch {}
          this.items.set(r.id, {
            id: r.id,
            type: r.type as ReviewItemType,
            seriesId: r.series_id,
            sourceId: r.source_id || undefined,
            data: parsedData,
            confidenceScore: r.confidence_score,
            reasons: parsedReasons,
            status: r.status,
            reviewedAt: r.reviewed_at || undefined,
            reviewNotes: r.review_notes || undefined,
            createdAt: r.created_at || new Date().toISOString(),
          });
        }
      }
    }

    return Array.from(this.items.values()).filter(
      (item) => !seriesId || item.seriesId === seriesId
    );
  }

  public approve(id: string, notes?: string): boolean {
    const item = this.items.get(id);
    const now = new Date().toISOString();
    if (item) {
      item.status = "approved";
      item.reviewedAt = now;
      if (notes) item.reviewNotes = notes;
    }
    if (this.bible) {
      this.bible.approveReviewItem(id, notes);
    }
    return Boolean(item || this.bible);
  }

  public reject(id: string, notes?: string): boolean {
    const item = this.items.get(id);
    const now = new Date().toISOString();
    if (item) {
      item.status = "rejected";
      item.reviewedAt = now;
      if (notes) item.reviewNotes = notes;
    }
    if (this.bible) {
      this.bible.rejectReviewItem(id, notes);
    }
    return Boolean(item || this.bible);
  }

  public modify<T>(id: string, modifiedData: T, notes?: string): boolean {
    const item = this.items.get(id);
    const now = new Date().toISOString();
    if (item) {
      item.data = modifiedData;
      item.status = "modified";
      item.reviewedAt = now;
      if (notes) item.reviewNotes = notes;
    }
    if (this.bible) {
      const existing = this.bible.getReviewItem(id);
      if (existing) {
        this.bible.enqueueReviewItem({
          ...existing,
          data_json: JSON.stringify(modifiedData),
          status: "modified",
          reviewed_at: now,
          review_notes: notes || existing.review_notes,
        });
      }
    }
    return Boolean(item || this.bible);
  }

  public getApprovedData<T>(type: ReviewItemType, seriesId?: string): T[] {
    // Refresh from bible if available
    this.getAll(seriesId);

    return Array.from(this.items.values())
      .filter(
        (item) =>
          item.type === type &&
          (item.status === "approved" || item.status === "modified") &&
          (!seriesId || item.seriesId === seriesId)
      )
      .map((item) => item.data as T);
  }

  public clear(): void {
    this.items.clear();
  }
}
