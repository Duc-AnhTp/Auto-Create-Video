import type { EpisodeResult, QaEvaluationStatus } from "../../ports/episode-options.js";
import type { BackendProvider } from "../../../../contracts/video.js";
import type { EpisodeProductionJob, EffectiveRenderConfig } from "../../../../contracts/episode.js";
import type { EpisodePacingReport } from "../../../media/index.js";
import type { AssembleAudioResult } from "../../../media/index.js";
import type { normalizeScript } from "../../../story/index.js";
export type PreparedScript=Awaited<ReturnType<typeof normalizeScript>>;
export interface PrepareProductionInput {
rawScriptTextOrPath: string;
}
export interface PrepareProductionOutput {
script: PreparedScript;
job: EpisodeProductionJob;
effectiveConfig: EffectiveRenderConfig;
outputDir: string;
provider: BackendProvider;
seriesId: string;
pacingReport: EpisodePacingReport | undefined;
mockTts: boolean;
auditPassed: boolean;
}
export interface ProduceAudioInput {
script: PreparedScript;
job: EpisodeProductionJob;
effectiveConfig: EffectiveRenderConfig;
outputDir: string;
mockTts: boolean;
}
export interface ProduceAudioOutput {
script: PreparedScript;
job: EpisodeProductionJob;
visualDurations: Map<string,number>;
planningDurations: Map<string,number>;
audioPath: string | undefined;
audioRes: Partial<AssembleAudioResult> | null;
audioDurationSec: number;
}
export interface ProduceShotsInput {
script: PreparedScript;
job: EpisodeProductionJob;
visualDurations: Map<string,number>;
planningDurations: Map<string,number>;
provider: BackendProvider;
outputDir: string;
seriesId: string;
}
export interface ProduceShotsOutput {
script: PreparedScript;
job: EpisodeProductionJob;
reusedShotIds: Set<string>;
videoShotsDir: string;
shotVideos: string[];
visualDurations: Map<string,number>;
}
export interface EvaluateShotsInput {
script: PreparedScript;
job: EpisodeProductionJob;
provider: BackendProvider;
seriesId: string;
outputDir: string;
reusedShotIds: Set<string>;
videoShotsDir: string;
shotVideos: string[];
}
export interface EvaluateShotsOutput {
script: PreparedScript;
job: EpisodeProductionJob;
shotVideos: string[];
faceQaWarnCount: number;
faceQaFailCount: number;
faceQaUnavailableCount: number;
}
export interface AssembleProductionInput {
script: PreparedScript;
job: EpisodeProductionJob;
provider: BackendProvider;
seriesId: string;
outputDir: string;
videoShotsDir: string;
shotVideos: string[];
visualDurations: Map<string,number>;
effectiveConfig: EffectiveRenderConfig;
audioPath: string | undefined;
audioRes: Partial<AssembleAudioResult> | null;
audioDurationSec: number;
pacingReport: EpisodePacingReport | undefined;
auditPassed: boolean;
}
export interface AssembleProductionOutput {
script: PreparedScript;
job: EpisodeProductionJob;
finalVideoPath: string;
beatCoveragePassed: boolean;
beatCoverageStatus: QaEvaluationStatus;
missingMandatoryBeatIds: string[];
}
export interface FinalizeProductionInput {
script: PreparedScript;
job: EpisodeProductionJob;
provider: BackendProvider;
mockTts: boolean;
seriesId: string;
outputDir: string;
finalVideoPath: string;
audioPath: string | undefined;
auditPassed: boolean;
faceQaWarnCount: number;
faceQaFailCount: number;
faceQaUnavailableCount: number;
beatCoveragePassed: boolean;
beatCoverageStatus: QaEvaluationStatus;
missingMandatoryBeatIds: string[];
}
export type AssemblyResult = {kind:"assembled";value:AssembleProductionOutput}|{kind:"skipped";result:EpisodeResult};
