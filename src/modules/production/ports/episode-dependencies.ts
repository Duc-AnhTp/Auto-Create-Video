import type { MediaFactories } from "../../media/index.js";
import type {AudioGenerationStore} from './audio-generation-store.js';
import type { EpisodeDependenciesStore } from "./episode-dependencies-store.js";
import type { VideoModelGateway } from "../application/dispatch/video-gateway.js";
import type { DurableShotOrchestrator } from "../application/dispatch/job-orchestrator.js";
import type { FaceQaEvaluator } from "../adapters/qa/face-evaluator.js";
import type { EpisodeAudioAssembler } from "../../media/index.js";
import type { CheckpointStore } from "./checkpoint-store.js";
import type { AssemblyEpisodeUseCase } from "../application/assembly-episode-use-case.js";
import type { NarrativeDeltaBuilder } from "../application/narrative-delta-builder.js";
import type { ShotQaUseCase } from "../application/shot-qa-use-case.js";
export interface EpisodeDependencies {audioGenerations:AudioGenerationStore;media:MediaFactories;bible:EpisodeDependenciesStore;gateway:Pick<VideoModelGateway,"getAdapter"|"selectBackend"|"executeShot"|"getAvailableProviders"|"getTelemetry">;audioAssembler:Pick<EpisodeAudioAssembler,"getCfg"|"assembleEpisodeAudio"|"resolveVoicePlan">;faceQa:Pick<FaceQaEvaluator,"backend"|"evaluateShot"|"setStyleCategory"|"styleCategory"|"tPass"|"tWarn"|"maxReRolls"|"evaluateMultiFrame">;orchestrator:Pick<DurableShotOrchestrator,"executeShot"|"executeShotWithRecovery"|"getLedger"|"getRateManager"|"resumePendingJobsForSeries"|"resolveEffectiveExecutionParams">;checkpoints:CheckpointStore;remux:AssemblyEpisodeUseCase["remuxEpisode"];narrativeDelta:NarrativeDeltaBuilder["generateNarrativeDelta"];shots:ShotQaUseCase}
