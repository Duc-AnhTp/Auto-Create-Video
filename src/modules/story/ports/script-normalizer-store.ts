import type { SeriesMetadataRecord, CharacterRecord, CharacterWardrobeRecord, LocationRecord, KeyPropRecord } from "../../../contracts/story.js";
import type { ContinuityAuditResult, LlmInvoker } from "../application/continuity-auditor.js";

export interface ScriptNormalizerStore {
auditDraftScript(episodeNumber: number, draftScript: string, invoker?: LlmInvoker | { llmInvoker?: LlmInvoker; promptTemplate?: string }): Promise<ContinuityAuditResult>;
getSeriesMetadata(id?: string): SeriesMetadataRecord | null;
getWardrobe(id: string): CharacterWardrobeRecord | null;
listCharacters(seriesId?: string): CharacterRecord[];
listKeyProps(seriesId?: string): KeyPropRecord[];
listLocations(seriesId?: string): LocationRecord[];
}
