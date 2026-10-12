import type { ReferenceProvenance, ProductionArtifact } from "../../../contracts/production.js";
import type { SeriesMetadataRecord, CharacterRecord, CharacterWardrobeRecord, LocationRecord, KeyPropRecord, EpisodeSummaryRecord, StoryboardKeyframeRecord, ShotTakeRecord, AtomicReserveShotTakeParams, AtomicReserveShotTakeResult, StateEventRecord, EpisodeLifecycleStatus, EpisodeLifecycleRecord, SourceUnitRecord, SourceBlockRecord, StoryBeatRecord, SeriesPlanRecord, CoverageLedgerRecord, NarrativeDelta } from "../../../contracts/story.js";
import type { ContinuityAuditResult, LlmInvoker } from "../../story/index.js";

export interface EpisodeDependenciesStore {
approveShotTake(takeId: string): void;
atomicReserveShotTake(params: AtomicReserveShotTakeParams): AtomicReserveShotTakeResult;
auditDraftScript(episodeNumber: number, draftScript: string, invoker?: LlmInvoker | { llmInvoker?: LlmInvoker; promptTemplate?: string }): Promise<ContinuityAuditResult>;
commitEpisode(summaryOrOptions:
      | EpisodeSummaryRecord
      | {
          episodeNumber?: number;
          episode_number?: number;
          title?: string;
          logline?: string;
          majorEvents?: string[];
          major_events?: string[];
          delta?: NarrativeDelta;
          delta_changes?: Record<string, unknown>;
          commitId?: string;
          seriesId?: string;
          force?: boolean;
          created_at?: string;
        }, deltaArg?: NarrativeDelta, optionsArg?: {
      commitId?: string;
      seriesId?: string;
      confirmationSource?: StateEventRecord["confirmation_source"];
      storyTime?: string;
      force?: boolean;
    }): { applied: boolean; commitId: string; reason?: string; episode_number: number; title: string };
getActiveSeriesPlan(seriesId: string): SeriesPlanRecord | null;
getApprovedStoryboardForShot(seriesId: string, episodeNumber: number, shotId: string): StoryboardKeyframeRecord | null;
getApprovedTakeForShot(seriesId: string, episodeNumber: number, shotId: string): ShotTakeRecord | null;
getArtifact(id: string): ProductionArtifact | null;
getCharacter(id: string, seriesId?: string): CharacterRecord | null;
getEpisodeLifecycle(seriesId: string, episodeNumber: number): EpisodeLifecycleRecord | null;
getKeyProp(id: string, seriesId?: string): KeyPropRecord | null;
getLocation(id: string, seriesId?: string): LocationRecord | null;
getReference(path: string): ReferenceProvenance | null;
getSeriesCostAndTakesSummary(seriesId: string): {
    totalTakes: number;
    approvedTakes: number;
    totalCostUsd: number;
    episodes: Array<{
      episodeNumber: number;
      takeCount: number;
      approvedCount: number;
      costUsd: number;
    }>;
  };
getSeriesMetadata(id?: string): SeriesMetadataRecord | null;
getSeriesPlan(id: string): SeriesPlanRecord | null;
getShotTake(takeId: string): ShotTakeRecord | null;
getWardrobe(id: string): CharacterWardrobeRecord | null;
listArtifacts(seriesId: string, episode: number): ProductionArtifact[];
listCharacters(seriesId?: string): CharacterRecord[];
listCoverageLedgers(planOrSeriesId: string): CoverageLedgerRecord[];
listKeyProps(seriesId?: string): KeyPropRecord[];
listLocations(seriesId?: string): LocationRecord[];
listReferences(seriesId: string): ReferenceProvenance[];
listShotTakes(seriesId: string, episodeNumber: number, shotId?: string): ShotTakeRecord[];
listSourceBlocks(unitId: string): SourceBlockRecord[];
listSourceUnits(sourceId: string, revision?: number): SourceUnitRecord[];
listStoryBeats(seriesId: string, sourceId?: string): StoryBeatRecord[];
putArtifact(value: ProductionArtifact): ProductionArtifact;
putReference(value: ReferenceProvenance): void;
recordShotTake(take: ShotTakeRecord): void;
setEpisodeLifecycle(recordOrEpisodeNumber:
      | {
          seriesId: string;
          episodeNumber: number;
          status: EpisodeLifecycleStatus;
          snapshotId?: string | null;
          reviewNotes?: string | null;
          needsReview?: boolean;
          storyboardApprovedAt?: string | null;
          storyboard_approved_at?: string | null;
        }
      | number, statusPositional?: EpisodeLifecycleStatus, reviewNotesPositional?: string | null, seriesIdPositional?: string): void;
updateShotTakeQa(takeId: string, qa: {
      qa_status: "PASS" | "WARN" | "FAIL" | "NOT_RUN" | "UNAVAILABLE";
      qa_score?: number;
      qa_notes?: string;
      qa_report_json?: string;
    }): void;
upsertCharacter(char: CharacterRecord): void;
upsertCoverageLedger(cov: CoverageLedgerRecord): void;
upsertLocation(loc: LocationRecord): void;
}
