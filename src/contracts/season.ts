export type EpisodeStatusType =
  | "pending"
  | "running"
  | "rendered"
  | "qa_pending"
  | "needs_review"
  | "approved"
  | "canon_committed"
  | "completed"
  | "failed"
  | "skipped"
  | "budget_exceeded";

export interface EpisodeExecutionStatus {
  episodeNumber: number;
  title: string;
  status: EpisodeStatusType;
  outputPath?: string;
  durationSec?: number;
  costUsd?: number;
  error?: string;
  takeCount?: number;
  startedAt?: string;
  completedAt?: string;
}

export interface SeasonProgress {
  seriesId: string;
  planId: string;
  status: "idle" | "running" | "completed" | "failed_partial" | "stopped_budget" | "needs_review";
  totalEpisodes: number;
  completedEpisodes: number;
  failedEpisodes: number;
  skippedEpisodes: number;
  pendingEpisodes: number;
  totalCostUsd: number;
  episodes: EpisodeExecutionStatus[];
  costLedger: {
    estimated: number;
    reserved: number;
    confirmed: number;
    confirmedInvoiced?: number;
    confirmedEstimated?: number;
    uncertain: number;
  };
}

export interface SeasonProductionResult {
  success: boolean;
  seriesId: string;
  planId: string;
  totalTargetEpisodes: number;
  episodesExecuted: number;
  episodesCompleted: number;
  episodesFailed: number;
  totalDurationSec: number;
  totalCostUsd: number;
  progress: SeasonProgress;
  seasonMasterReportPath?: string;
}

