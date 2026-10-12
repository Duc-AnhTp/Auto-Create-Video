import type {UnifiedTimeline} from './timeline.js';
export type DialogueEmotion =
  | "calm_deliberate"
  | "whisper"
  | "intense_confrontation"
  | "furious_shout"
  | "terrified"
  | "heartbroken_grief"
  | "panicked"
  | "sarcastic";

export interface EmotionalVoiceSettings {
  emotion: DialogueEmotion;
  rate: number; // 0.5 to 2.0 (1.0 = normal)
  pitch: number; // -10 to +10 semitones (0 = normal)
  volumeDb: number; // -12 to +6 dB (0 = normal)
  breathiness: number; // 0.0 to 1.0 (higher for whispers/grief)
  tremorIntensity: number; // 0.0 to 1.0 (for terrified/panicked)
  pausePaddingMs: number; // Pauses between punctuation
  actingPrompt: string; // Plaintext acting instruction for neural models
  elevenLabsSettings?: {
    stability: number; // 0.0 to 1.0
    similarityBoost: number; // 0.0 to 1.0
    style: number; // 0.0 to 1.0
    useSpeakerBoost: boolean;
  };
  ssmlText: string;
}

export interface DialogueEmotionContext {
  characterName: string;
  characterRole?: string;
  sceneTensionScore?: number; // 0.0 to 1.0
  dramaticAct?: string;
  wounds?: string[];
  psychologicalDisposition?: string;
  explicitActingInstruction?: string;
}

export type VisemeClass =
  | "sil" // Silence / Resting mouth
  | "PP" // Bilabial plosives: p, b, m
  | "FF" // Labiodental fricatives: f, v
  | "TH" // Dental: th
  | "DD" // Alveolar: t, d, s, z
  | "kk" // Velar: k, g, ng
  | "CH" // Postalveolar: ch, j, sh
  | "SS" // Sibilants: s, z, x
  | "nn" // Nasals / Approximants: n, l
  | "RR" // Liquid / rhotic: r
  | "aa" // Open back vowel: a, ah, aw
  | "E" // Mid front vowel: e, eh, ay
  | "I" // Close front vowel: i, ee, ih
  | "O" // Close-mid back rounded vowel: o, oh
  | "U";

export interface VisemeKeyframe {
  viseme: VisemeClass;
  startSec: number;
  endSec: number;
  durationSec: number;
  intensity: number; // 0.0 to 1.0
  morphTargets: {
    jawOpen: number; // 0.0 to 1.0
    mouthPucker: number; // 0.0 to 1.0
    mouthSmile: number; // 0.0 to 1.0
    mouthFunnel: number; // 0.0 to 1.0
    mouthClose: number; // 0.0 to 1.0
  };
}

export interface VisemeFrameSample {
  frameIndex: number;
  timestampSec: number;
  primaryViseme: VisemeClass;
  visemeWeights: Partial<Record<VisemeClass, number>>;
  jawOpen: number;
  mouthPucker: number;
  mouthSmile: number;
  mouthFunnel: number;
  mouthClose: number;
}

export interface VisemeAlignmentResult {
  totalDurationSec: number;
  fps: number;
  totalFrames: number;
  keyframes: VisemeKeyframe[];
  frames: VisemeFrameSample[];
}

export type LipSyncProvider = "wav2lip" | "liveportrait" | "sadtalker" | "synclabs" | "mock";

export interface NormalizedFaceRoi {
  x: number; // 0.0 to 1.0
  y: number; // 0.0 to 1.0
  width: number; // 0.0 to 1.0
  height: number; // 0.0 to 1.0
  featherRadiusPx: number;
}

export interface LipSyncOptions {
  provider?: LipSyncProvider;
  fps?: number;
  featheringRadiusPx?: number;
  temporalSmoothingFrames?: number;
  audioOffsetMs?: number;
  allowMockFallback?: boolean;
}

export interface LipSyncResult {
  success: boolean;
  isMock: boolean;
  measurement: "mock" | "measured";
  outputVideoPath: string;
  providerUsed: LipSyncProvider;
  totalDurationSec: number;
  fps: number;
  avSyncOffsetMs: number; // Simulated for mock output; measured only when measurement is "measured"
  syncConfidenceScore: number; // 0.0 to 1.0
  mouthRoi: NormalizedFaceRoi;
  visemeAlignment: VisemeAlignmentResult;
  manifestPath: string;
}

export interface ColorHistogram {
  r: number[];
  g: number[];
  b: number[];
  luma: number[];
  totalPixels: number;
  moments: {
    mean: [number, number, number]; // [R, G, B]
    stdDev: [number, number, number];
    median: [number, number, number];
    min: [number, number, number];
    max: [number, number, number];
    entropy: number;
  };
}

export interface ColorTemperatureMetrics {
  cctKelvin: number; // 2000K (Candle/Tungsten) to 12000K (Deep Shade)
  tintFactor: number; // -1.0 (Magenta) to +1.0 (Green)
  dominantWarmth:
    | "warm_tungsten"
    | "golden_hour"
    | "daylight"
    | "overcast_cool"
    | "deep_shade";
  chromaticityX: number;
  chromaticityY: number;
}

export interface LightSourceVector {
  azimuthDeg: number; // -180° to 180° (0° = key front, -90° = camera left, 90° = camera right, 180° = rim/backlight)
  elevationDeg: number; // -90° to 90° (0° = horizontal eye-level, 45° = standard 3-point key, -30° = dramatic uplight)
  intensity: number; // 0.0 to 2.0
  color: [number, number, number]; // Normalized RGB multiplier
  cctKelvin: number;
  vector3D: [number, number, number]; // Normalized [x, y, z] vector
}

export interface AmbientHemisphereLighting {
  skyAmbient: [number, number, number]; // Ambient diffuse from above (skylight / ceiling)
  groundBounce: [number, number, number]; // Ambient bounce from floor/ground
  rimLightIntensity: number; // Fresnel edge separation intensity (0.0 to 1.5)
  rimLightColor: [number, number, number];
  rimPower: number; // Exponent for Fresnel falloff (default: 3.0)
}

export interface DepthRelightingConfig {
  keyLight: LightSourceVector;
  ambient: AmbientHemisphereLighting;
  depthScale: number; // Depth gradient scale factor (default: 3.5)
  foregroundWeight: number; // Priority for actor facial tones vs background (0.0 to 1.0)
  enableRimLight: boolean;
  enableAmbientBounce: boolean;
}

export interface HistogramMatchTransfer {
  transferTableR: number[]; // 256 values: Target R -> Ref R
  transferTableG: number[];
  transferTableB: number[];
  transferTableLuma: number[];
  wassersteinDistance: number; // Earth Mover's Distance between distributions
}

export interface ShotHarmonizationProfile {
  shotId: string;
  shotType:
    | "establishing"
    | "wide"
    | "medium"
    | "two_shot"
    | "ots_a_b"
    | "ots_b_a"
    | "close_up"
    | "extreme_close_up";
  isSceneMaster: boolean;
  sourceCct: ColorTemperatureMetrics;
  targetCct: ColorTemperatureMetrics;
  cctDeltaKelvin: number;
  histogramMatch: HistogramMatchTransfer;
  cdlCorrection: AscCdl;
  relightingConfig: DepthRelightingConfig;
  ffmpegFilterGraph: string;
  comfyUiDirectives: {
    promptModifiers: string[];
    controlNetDepthWeight: number;
    relightingGuidance: string;
  };
  confidenceScore: number;
}

export interface SceneHarmonizationResult {
  sceneId: string;
  masterShotId: string;
  masterCct: ColorTemperatureMetrics;
  masterLighting: LightSourceVector;
  profiles: ShotHarmonizationProfile[];
  sceneConsistencyScore: number; // 0.0 to 1.0 (e.g. 0.96)
  davinciCdlManifestXml: string;
}

export interface ShotInput {
  shotId: string;
  shotType?: ShotHarmonizationProfile["shotType"];
  clipPath?: string;
  depthMapPath?: string;
  /** Optional custom or pre-measured color temperature */
  measuredCct?: number;
  /** Optional sample RGB values (e.g. representative background / actor face) */
  averageRgb?: [number, number, number];
  /** Custom CDL override */
  customCdl?: Partial<AscCdl>;
}

export interface SceneHarmonizationInput {
  sceneId: string;
  masterShotId?: string; // If omitted, defaults to first shot
  shots: ShotInput[];
  targetEnvironmentPreset?: "golden_hour" | "daylight_overcast" | "cyberpunk_night" | "interior_candle" | "studio_commercial";
  keyLightAzimuthDeg?: number;
  keyLightElevationDeg?: number;
}

export interface AscCdl {
  slope: [number, number, number]; // [R, G, B]
  offset: [number, number, number]; // [R, G, B]
  power: [number, number, number]; // [R, G, B]
  saturation: number;
}

export type CinematicPresetName =
  | "kodak_2383"
  | "fuji_eterna"
  | "teal_orange"
  | "cyberpunk_neon"
  | "bleach_bypass"
  | "monochrome_noir"
  | "natural_balance";

export interface CinematicLookPreset {
  id: CinematicPresetName;
  name: string;
  description: string;
  cdl: AscCdl;
  recommendedGrain: number;
}

export interface CdlGradeOptions {
  lutSize?: 17 | 33; // 3D LUT lattice dimension (default: 33)
  outputLutPath?: string;
  outputXmlPath?: string;
  customCdl?: Partial<AscCdl>;
  mockFallback?: boolean;
}

export interface CdlGradeResult {
  outputPath: string;
  presetApplied?: CinematicPresetName;
  cdl: AscCdl;
  lutPath: string;
  xmlPath: string;
  filterGraphString: string;
}

export interface IngestedClipItem {
  id: string;
  name: string;
  startFrame: number;
  endFrame: number;
  inFrame: number;
  outFrame: number;
  durationFrames: number;
  filePath?: string;
  shotId?: string;
  takeNumber?: number;
  isAudio?: boolean;
}

export interface IngestedNleTimeline {
  sequenceName: string;
  fps: number;
  videoClips: IngestedClipItem[];
  audioClips: IngestedClipItem[];
  totalFrames: number;
  totalDurationSec: number;
}

export interface ShotTrimDiff {
  shotId: string;
  originalDurationSec: number;
  editedDurationSec: number;
  deltaSec: number;
}

export interface ShotTakeSwapDiff {
  shotId: string;
  originalTakeNumber?: number;
  newTakeNumber: number;
  newClipPath: string;
  durationSec?: number;
}

export interface NleDiffReport {
  hasModifications: boolean;
  sequenceName: string;
  originalTotalDurationSec: number;
  editedTotalDurationSec: number;
  totalDurationDeltaSec: number;
  trimmedShots: ShotTrimDiff[];
  swappedTakes: ShotTakeSwapDiff[];
  removedShots: string[];
  reorderedShots: Array<{ shotId: string; originalIndex: number; newIndex: number }>;
}

export interface ConformedTimelineResult {
  conformedTimeline: UnifiedTimeline;
  diffReport: NleDiffReport;
  realignedDialogueCount: number;
  realignedSfxCount: number;
  realignedAmbienceCount?: number;
  hasModifications: boolean;
}

export type TrailerAct = "act_1_hook" | "act_2_escalation" | "act_3_climax" | "outro_title_card";

export interface CandidateShot {
  shotId: string;
  episodeNumber: number;
  episodeTitle?: string;
  shotType: "establishing" | "wide" | "medium" | "two_shot" | "ots_a_b" | "ots_b_a" | "close_up" | "extreme_close_up";
  clipPath: string;
  sourceDurationSec: number;
  tensionScore: number; // 0.0 to 1.0 (from episode pacing)
  dialogueSnippet?: string;
  speakerName?: string;
  emotionScore?: number; // 0.0 to 1.0
  actionDensity?: "low" | "medium" | "high" | "peak";
  visualDescription?: string;
}

export interface TrailerCutItem {
  cutIndex: number;
  act: TrailerAct;
  shotId: string;
  episodeNumber: number;
  shotType: string;
  sourceClipPath: string;
  timelineStartSec: number;
  timelineEndSec: number;
  cutDurationSec: number;
  sourceTrimStartSec: number;
  sourceTrimEndSec: number;
  dialogue?: {
    speaker: string;
    text: string;
    startSec: number;
    durationSec: number;
  };
  audioHit?: "drone_riser" | "tension_hit" | "braam_sub_drop" | "whoosh_impact" | "title_sting" | "silence_breath";
  transitionToNext?: "impact_cut" | "flash_to_white" | "dip_to_black" | "quick_crossfade";
}

export interface TrailerPacingPlan {
  totalTargetDurationSec: number;
  actStructure: {
    act: TrailerAct;
    startSec: number;
    endSec: number;
    targetShotDurationRange: [number, number]; // [minSec, maxSec]
    intendedPacing: string;
  }[];
}

export interface TrailerGenerationOptions {
  seriesId: string;
  seriesTitle?: string;
  tagline?: string;
  releaseDateText?: string;
  targetDurationSec?: 30 | 60 | 90; // Default: 60s
  musicStyle?: "epic_orchestral" | "cyberpunk_synthwave" | "dark_thriller_drone" | "action_percussion";
  outputDir?: string;
  mockVideo?: boolean;
}

export interface TrailerAutoCutResult {
  isMock: boolean;
  seriesId: string;
  trailerTitle: string;
  totalDurationSec: number;
  targetDurationSec: number;
  cutsCount: number;
  cuts: TrailerCutItem[];
  trailerVideoPath: string;
  fcp7XmlPath: string;
  cmx3600EdlPath: string;
  manifestPath: string;
  timeline: UnifiedTimeline;
}

export type DramaticAct = "act_1_setup" | "act_2a_rising" | "midpoint_reversal" | "act_2b_escalation" | "act_3_climax" | "resolution_cliffhanger";

export interface EpisodePacingProfile {
  episodeNumber: number;
  totalEpisodes: number;
  act: DramaticAct;
  tensionScore: number; // 0.0 (calm) to 1.0 (extreme climax)
  heroShotRatio: number; // 0.15 to 0.55
  targetShotDurationSec: number; // 2.5s (fast/intense) to 5.0s (deliberate)
  actionDensity: "low" | "medium" | "high" | "peak";
  recommendedCameraGrammar: {
    lensStyle: "deliberate_telephoto" | "dynamic_wide" | "handheld_shaky" | "epic_crane";
    averageShotsPerScene: number;
    closeUpEmphasis: number; // 0.0 to 1.0
  };
  narrativeObjectives: string[];
}

export interface CharacterEvolutionState {
  characterId: string;
  characterName: string;
  wounds: string[];
  wardrobeStyle: string;
  wardrobeDamage: "pristine" | "weathered" | "torn" | "heavily_damaged";
  psychologicalDisposition: string;
  knownSecrets: string[];
  heldProps: string[];
}

export interface CrossEpisodeStateSnapshot {
  seriesId: string;
  fromEpisode: number;
  toEpisode: number;
  timestamp: string;
  characters: CharacterEvolutionState[];
  activeChekhovGuns: Array<{
    id: string;
    description: string;
    plantedEpisode: number;
    isDueForPayoff: boolean;
  }>;
  worldStateSummary: Record<string, unknown>;
}

export interface EpisodeBudgetQuota {
  episodeNumber: number;
  weight: number;
  allocatedUsd: number;
  spentUsd: number;
  reservedUsd: number;
  remainingUsd: number;
  status: "pending" | "active" | "completed" | "over_budget";
  pacingAct: string;
}

export interface SeasonBudgetPlan {
  seriesId: string;
  totalSeasonBudgetUsd: number;
  totalAllocatedUsd: number;
  totalSpentUsd: number;
  totalReservedUsd: number;
  seasonSurplusUsd: number;
  episodes: EpisodeBudgetQuota[];
}
