import type {CoverageLedgerStore} from "../../story/index.js";
import type {SeriesPlanRecord} from '../../../contracts/story.js';
import type { CharacterRecord, CharacterWardrobeRecord, KeyPropRecord, EpisodeSummaryRecord, ShotTakeRecord, StateEventRecord, EpisodeLifecycleStatus, EpisodeLifecycleRecord, CoverageLedgerRecord, NarrativeDelta, BudgetLedgerSummary } from "../../../contracts/story.js";

export interface FinalizeServiceStore extends CoverageLedgerStore {
getActiveSeriesPlan(seriesId:string):SeriesPlanRecord|null;
getSeriesBudgetLedger(seriesId:string):BudgetLedgerSummary;
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
getApprovedTakeForShot(seriesId: string, episodeNumber: number, shotId: string): ShotTakeRecord | null;
getCharacter(id: string, seriesId?: string): CharacterRecord | null;
getEpisodeLifecycle(seriesId: string, episodeNumber: number): EpisodeLifecycleRecord | null;
getKeyProp(id: string, seriesId?: string): KeyPropRecord | null;
getWardrobe(id: string): CharacterWardrobeRecord | null;
listCoverageLedgers(planOrSeriesId: string): CoverageLedgerRecord[];
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
upsertCoverageLedger(cov: CoverageLedgerRecord): void;
}
