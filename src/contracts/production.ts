export type Provenance = "mock" | "production" | "unknown";

export interface ReferenceProvenance {
  path: string; seriesId: string; entityId: string; provider: string;
  mode: Provenance; sha256: string;
  embeddingSource: "synthetic" | "verified" | "unavailable" | "unknown";
  embeddingHash?: string;
  source?:string;
}

export interface ProductionArtifact {
  id: string; seriesId: string; episodeNumber: number; kind: "image" | "shot" | "master" | "delivery" | "evidence";
  path: string; sha256: string; sizeBytes: number; mode: Provenance; ready: boolean; approved: boolean;
  probe?: Record<string, unknown>; createdAt: string;
  source?:string;
}

export interface ProviderAttemptGroup {
  id: string; seriesId: string; episodeNumber: number; shotId: string; specHash: string;
  primaryId: string; hedgeId?: string; hedgeDueAt: number; winnerId?: string;
  status: "reserved" | "running" | "needs_review" | "completed" | "failed";
  reason?: string; spec: Record<string, unknown>; destinationPath?: string; createdAt: string;
}

export interface AttemptLease { id: string; owner: string; version: number; expiresAt: number }
