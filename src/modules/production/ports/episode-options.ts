import type {ExecutionContext} from '../../../contracts/execution.js';
import type { FoleyGenerator } from "../../media/index.js";
import { type NarrativeDelta } from "../../../contracts/story.js";
import { type BackendProvider } from "../../../contracts/video.js";
import {
type VisualQaBackend,
type VisualStyleCategory
} from "../adapters/qa/face-evaluator.js";
import { type EpisodicScript } from "../../../contracts/episode.js";

export interface EpisodeOptions extends ExecutionContext {
  seriesId?: string;
  biblePath?: string;
  provider?: BackendProvider;
  dryRun?: boolean;
  mockTts?: boolean;
  skipAudit?: boolean;
  skipRender?: boolean;
  resume?: boolean;
  regenerateAudio?: boolean;
  narrativeDelta?: NarrativeDelta;
  outputDir?: string;
  faceQaThresholds?: { tPass?: number; tWarn?: number; maxReRolls?: number };
  faceFeatureExtractor?: (
    shotVideoPath: string,
    referenceImagePath: string
  ) => Promise<{ frameEmbeddings: number[][]; referenceEmbedding: number[] }>;
  visualQaBackend?: VisualQaBackend;
  styleCategory?: VisualStyleCategory;
  budgetCapUsd?: number;
  hedge?:{enabled:boolean;fallbackProvider?:BackendProvider;delayMs:number};
  maxReRolls?: number;
  storyboardReviewRequired?: boolean;
  commitCanon?: boolean;
  requireApproval?: boolean;
  autoCommitCanon?: boolean;
  strictCharacters?: boolean;
  characterMapping?: Record<string, string>;
  overflowPolicy?: "extend_shot" | "split_shot" | "error";
  transitionDurationSec?: number;
  fps?: number;
  aspectRatio?: string;
  ttsEngine?: string;
  ttsProvider?: string;
  allowMockMedia?: boolean;
  voiceConfigs?: Record<string, unknown>;
  useHierarchicalAssembly?: boolean;
  autoGenerateMissingConceptArt?: boolean;
  /** Enable Hollywood cinematic directing (180-degree axis enforcement & Foley action detection) */
  cinematicDirecting?: boolean;
  foleyGenerator?: FoleyGenerator;
  specHash?: string;
  /** Cooperative boundary: finish in-flight work before pausing or cancelling. */
  expectedEpisodeNumber?: number;
  exportResolution?: "720p" | "1080p";
}

export interface EpisodeResult {
  episodeNumber: number;
  title: string;
  script: EpisodicScript;
  videoPath: string;
  audioPath: string;
  outputDir: string;
  auditPassed: boolean;
  isMock: boolean;
  committedCanon: boolean;
}

export type QaEvaluationStatus = "PASS" | "FAIL" | "UNAVAILABLE" | "ERROR" | "NOT_APPLICABLE";
