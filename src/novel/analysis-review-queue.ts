import type {
  LlmExtractedCharacter,
  LlmExtractedBeat,
  LlmExtractedThread,
} from "./llm-analysis-schemas.js";

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
      reasons.push(`Độ tin cậy thấp: ${(confidence * 100).toFixed(1)}% < ${(autoApproveThreshold * 100).toFixed(1)}%`);
    }
    if ((data as any)?.needsHumanReview) {
      reasons.push("Được LLM đánh dấu cần người giám sát xác nhận.");
    }

    const id =
      options.id ||
      `rev_${type}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    const item: ReviewQueueItem<T> = {
      id,
      type,
      seriesId,
      sourceId: options.sourceId,
      data,
      confidenceScore: confidence,
      reasons,
      status: needsReview ? "pending" : "approved",
      createdAt: new Date().toISOString(),
    };

    this.items.set(id, item);
    return item;
  }

  public getPending(seriesId?: string): ReviewQueueItem[] {
    return Array.from(this.items.values()).filter(
      (item) => item.status === "pending" && (!seriesId || item.seriesId === seriesId)
    );
  }

  public getAll(seriesId?: string): ReviewQueueItem[] {
    return Array.from(this.items.values()).filter(
      (item) => !seriesId || item.seriesId === seriesId
    );
  }

  public approve(id: string, notes?: string): boolean {
    const item = this.items.get(id);
    if (!item) return false;
    item.status = "approved";
    item.reviewedAt = new Date().toISOString();
    if (notes) item.reviewNotes = notes;
    return true;
  }

  public reject(id: string, notes?: string): boolean {
    const item = this.items.get(id);
    if (!item) return false;
    item.status = "rejected";
    item.reviewedAt = new Date().toISOString();
    if (notes) item.reviewNotes = notes;
    return true;
  }

  public modify<T>(id: string, modifiedData: T, notes?: string): boolean {
    const item = this.items.get(id);
    if (!item) return false;
    item.data = modifiedData;
    item.status = "modified";
    item.reviewedAt = new Date().toISOString();
    if (notes) item.reviewNotes = notes;
    return true;
  }

  public getApprovedData<T>(type: ReviewItemType, seriesId?: string): T[] {
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
