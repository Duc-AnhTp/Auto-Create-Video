import type {
  LlmExtractedCharacter,
  LlmExtractedBeat,
  LlmExtractedThread,
} from "./llm-analysis-schemas.js";
import type { BibleManager, AnalysisReviewItemRecord } from "../bible/bible-manager.js";

export type ReviewItemType = "character" | "beat" | "thread" | "chekhov_gun" | "prop";

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

  public hasBible(): boolean {
    return Boolean(this.bible);
  }

  public getBible(): BibleManager | undefined {
    return this.bible;
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

      // Auto-approved entities must be atomically persisted into domain tables
      if (status === "approved") {
        this.persistApprovedToDomainBible(type, data);
      }
    }

    return item;
  }

  public getPending(seriesId?: string): ReviewQueueItem[] {
    if (this.bible) {
      this.syncRecords(this.bible.getPendingReviewItems(seriesId));
    }

    return Array.from(this.items.values()).filter(
      (item) => item.status === "pending" && (!seriesId || item.seriesId === seriesId)
    );
  }

  public getPendingCount(seriesId?: string): number {
    return this.getPending(seriesId).length;
  }

  public getAll(seriesId?: string): ReviewQueueItem[] {
    if (this.bible) {
      this.syncRecords(this.bible.listReviewItems(seriesId));
    }

    return Array.from(this.items.values()).filter(
      (item) => !seriesId || item.seriesId === seriesId
    );
  }

  private syncRecords(records: AnalysisReviewItemRecord[]): void {
    for (const r of records) {
      const item = this.items.get(r.id);
      if (!item) {
        this.items.set(r.id, this.hydrateRecord(r));
      } else {
        item.status = r.status;
        item.reviewedAt = r.reviewed_at || undefined;
        item.reviewNotes = r.review_notes || undefined;
        if (r.data_json) {
          try {
            item.data = JSON.parse(r.data_json);
          } catch {}
        }
      }
    }
  }

  private hydrateRecord(r: AnalysisReviewItemRecord): ReviewQueueItem {
    let parsedData = {};
    let parsedReasons: string[] = [];
    try {
      parsedData = JSON.parse(r.data_json);
    } catch {}
    try {
      parsedReasons = JSON.parse(r.reasons_json || "[]");
    } catch {}
    return {
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
  }

  private persistApprovedToDomainBible(type: ReviewItemType, data: any, seriesId?: string): void {
    if (!this.bible || !data) return;
    try {
      const targetSeriesId = data.series_id || data.seriesId || seriesId;
      if (type === "character" && data.id) {
        this.bible.upsertCharacter({
          ...data,
          series_id: targetSeriesId || data.series_id,
        });
      } else if (type === "beat" && data.id) {
        this.bible.upsertStoryBeat({
          ...data,
          series_id: targetSeriesId || data.series_id,
        });
      } else if (type === "thread" && data.id) {
        this.bible.upsertStoryThread({
          ...data,
          series_id: targetSeriesId || data.series_id,
        });
      } else if (type === "prop" && data.id) {
        this.bible.upsertKeyProp({
          id: data.id,
          name: data.name || data.id,
          visual_summary: data.visual_summary || data.visualSummary || data.description || data.name || "",
          current_holder_id: data.current_holder_id || data.currentHolderId || null,
          reference_image_path: data.reference_image_path || data.referenceImagePath || null,
          status: data.status || "intact",
          series_id: targetSeriesId || undefined,
        });
      } else if (type === "chekhov_gun" && (data.id || data.gun_id || data.gunId)) {
        const gunId = data.id || data.gun_id || data.gunId;
        this.bible.plantChekhovGun({
          id: gunId,
          series_id: targetSeriesId || "series_main",
          name: data.name || data.itemOrClue || data.item_or_clue || gunId,
          type: (data.type as any) || "prop",
          description: data.description || data.context || "",
          planted_at_episode: data.planted_at_episode ?? data.plantedAtEpisode ?? 1,
          planted_in_beat_id: data.planted_in_beat_id ?? data.plantedInBeatId ?? null,
          payoff_status: data.payoff_status ?? "planted",
          payoff_episode: data.payoff_episode ?? data.payoffExpectedBy ?? null,
        });
      }
    } catch {}
  }

  public approve(id: string, notes?: string): boolean {
    const item = this.items.get(id);
    const now = new Date().toISOString();
    let dbWriteOk = false;
    let inDb = false;

    if (this.bible) {
      const dbItem = this.bible.getReviewItem(id);
      if (dbItem) {
        inDb = true;
        dbWriteOk = this.bible.approveReviewItem(id, notes);
        if (dbWriteOk) {
          dbItem.status = "approved";
          dbItem.reviewed_at = now;
          if (notes !== undefined) dbItem.review_notes = notes;
          if (!item) {
            this.items.set(id, this.hydrateRecord(dbItem));
          }
        }
      }
    }

    if (!item && !inDb) {
      return false;
    }

    // Do not mutate in-memory cache if the database write failed
    if (inDb && !dbWriteOk) {
      return false;
    }

    if (item) {
      item.status = "approved";
      item.reviewedAt = now;
      if (notes !== undefined) item.reviewNotes = notes;
    }

    const currentItem = item || this.items.get(id);
    if (currentItem) {
      this.persistApprovedToDomainBible(currentItem.type, currentItem.data, currentItem.seriesId);
    }

    return inDb ? dbWriteOk : true;
  }

  public reject(id: string, notes?: string): boolean {
    const item = this.items.get(id);
    const now = new Date().toISOString();
    let dbWriteOk = false;
    let inDb = false;

    if (this.bible) {
      const dbItem = this.bible.getReviewItem(id);
      if (dbItem) {
        inDb = true;
        dbWriteOk = this.bible.rejectReviewItem(id, notes);
        if (dbWriteOk) {
          dbItem.status = "rejected";
          dbItem.reviewed_at = now;
          if (notes !== undefined) dbItem.review_notes = notes;
          if (!item) {
            this.items.set(id, this.hydrateRecord(dbItem));
          }
        }
      }
    }

    if (!item && !inDb) {
      return false;
    }

    // Do not mutate in-memory cache if the database write failed
    if (inDb && !dbWriteOk) {
      return false;
    }

    if (item) {
      item.status = "rejected";
      item.reviewedAt = now;
      if (notes !== undefined) item.reviewNotes = notes;
    }

    return inDb ? dbWriteOk : true;
  }

  public modify<T>(id: string, modifiedData: T, notes?: string, autoApprove = false): boolean {
    const item = this.items.get(id);
    const now = new Date().toISOString();
    let dbWriteOk = false;
    let inDb = false;

    let wasApproved = item?.status === "approved" || item?.status === "modified" || autoApprove;

    if (this.bible) {
      const existing = this.bible.getReviewItem(id);
      if (existing) {
        inDb = true;
        wasApproved = wasApproved || existing.status === "approved" || existing.status === "modified";
        const newStatus = wasApproved ? "modified" : "pending";
        try {
          this.bible.enqueueReviewItem({
            ...existing,
            data_json: JSON.stringify(modifiedData),
            status: newStatus,
            reviewed_at: now,
            review_notes: notes !== undefined ? notes : existing.review_notes,
          });
          dbWriteOk = true;
          existing.data_json = JSON.stringify(modifiedData);
          existing.status = newStatus;
          existing.reviewed_at = now;
          if (notes !== undefined) existing.review_notes = notes;
          if (!item) {
            this.items.set(id, this.hydrateRecord(existing));
          }
        } catch {
          dbWriteOk = false;
        }
      }
    }

    if (!item && !inDb) {
      return false;
    }

    // Do not mutate in-memory cache if the database write failed
    if (inDb && !dbWriteOk) {
      return false;
    }

    const newStatus = wasApproved ? "modified" : "pending";
    if (item) {
      item.data = modifiedData;
      item.status = newStatus;
      item.reviewedAt = now;
      if (notes !== undefined) item.reviewNotes = notes;
    }

    const currentItem = item || this.items.get(id);
    // Hard Gate: only persist to domain tables if the item is approved
    if (currentItem && wasApproved) {
      this.persistApprovedToDomainBible(currentItem.type, currentItem.data, currentItem.seriesId);
    }

    return inDb ? dbWriteOk : true;
  }

  public getApprovedData<T>(type: ReviewItemType, seriesId?: string): T[] {
    // Selectively refresh approved and modified records from Bible
    if (this.bible) {
      this.syncRecords(this.bible.listReviewItems(seriesId, "approved"));
      this.syncRecords(this.bible.listReviewItems(seriesId, "modified"));
    }

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
