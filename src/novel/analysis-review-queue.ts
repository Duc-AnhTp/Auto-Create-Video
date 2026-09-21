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
        let item = this.items.get(r.id);
        if (!item) {
          let parsedData = {};
          let parsedReasons: string[] = [];
          try {
            parsedData = JSON.parse(r.data_json);
          } catch {}
          try {
            parsedReasons = JSON.parse(r.reasons_json || "[]");
          } catch {}
          item = {
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
          };
          this.items.set(r.id, item);
        } else {
          item.status = r.status;
          item.reviewedAt = r.reviewed_at || undefined;
          item.reviewNotes = r.review_notes || undefined;
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
        let item = this.items.get(r.id);
        if (!item) {
          let parsedData = {};
          let parsedReasons: string[] = [];
          try {
            parsedData = JSON.parse(r.data_json);
          } catch {}
          try {
            parsedReasons = JSON.parse(r.reasons_json || "[]");
          } catch {}
          item = {
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
          };
          this.items.set(r.id, item);
        } else {
          item.status = r.status;
          item.reviewedAt = r.reviewed_at || undefined;
          item.reviewNotes = r.review_notes || undefined;
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
    let dbWriteOk = true;
    if (this.bible) {
      dbWriteOk = this.bible.approveReviewItem(id, notes);
    }
    // Always update in-memory state when the item exists there.
    // When a DB is wired but the item was never persisted (in-memory-only queue),
    // approveReviewItem() returns false (item not found in DB) which is not a write
    // failure — we still update in-memory. Only skip in-memory update if the DB
    // actively rejected a write for an item that IS in the DB.
    if (item) {
      item.status = "approved";
      item.reviewedAt = now;
      if (notes) item.reviewNotes = notes;
    }
    // Return false only when the DB write actively failed (item existed in DB but write rejected).
    // Return true when: no bible (in-memory only), or item not in DB (in-memory only mode), or DB wrote OK.
    return dbWriteOk;
  }

  public reject(id: string, notes?: string): boolean {
    const item = this.items.get(id);
    const now = new Date().toISOString();
    let dbWriteOk = true;
    if (this.bible) {
      dbWriteOk = this.bible.rejectReviewItem(id, notes);
    }
    if (item) {
      item.status = "rejected";
      item.reviewedAt = now;
      if (notes) item.reviewNotes = notes;
    }
    return dbWriteOk;
  }

  public modify<T>(id: string, modifiedData: T, notes?: string): boolean {
    const item = this.items.get(id);
    const now = new Date().toISOString();
    let dbWriteOk = true;
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
        // enqueueReviewItem does not return a bool; assume success if no throw.
      }
      // If item not in DB (in-memory only), dbWriteOk stays true — not a write failure.
    }
    // Always update in-memory if the item is there — same rationale as approve()/reject().
    if (item) {
      item.data = modifiedData;
      item.status = "modified";
      item.reviewedAt = now;
      if (notes) item.reviewNotes = notes;
    }
    return dbWriteOk;
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
