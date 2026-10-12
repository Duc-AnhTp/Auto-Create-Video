import {ScriptSchema as impl_ScriptSchema} from "../adapters/render/script-schema.js";
export const ScriptSchema=impl_ScriptSchema;
import {fetchImage as impl_fetchImage} from "../adapters/assets/image-fetcher.js";
export function fetchImage(...args:Parameters<typeof impl_fetchImage>):ReturnType<typeof impl_fetchImage> {return impl_fetchImage(...args);}
import {processImage as impl_processImage} from "../adapters/assets/image-processor.js";
export function processImage(...args:Parameters<typeof impl_processImage>):ReturnType<typeof impl_processImage> {return impl_processImage(...args);}
import {guessExtFromUrl as impl_guessExtFromUrl} from "../adapters/assets/image-processor.js";
export function guessExtFromUrl(...args:Parameters<typeof impl_guessExtFromUrl>):ReturnType<typeof impl_guessExtFromUrl> {return impl_guessExtFromUrl(...args);}
import {getDurationSec as impl_getDurationSec} from "../adapters/assets/audio-tools.js";
export function getDurationSec(...args:Parameters<typeof impl_getDurationSec>):ReturnType<typeof impl_getDurationSec> {return impl_getDurationSec(...args);}
import {concatWithSilence as impl_concatWithSilence} from "../adapters/assets/audio-tools.js";
export function concatWithSilence(...args:Parameters<typeof impl_concatWithSilence>):ReturnType<typeof impl_concatWithSilence> {return impl_concatWithSilence(...args);}
import {mixSfxOntoVoice as impl_mixSfxOntoVoice} from "../adapters/assets/audio-tools.js";
export function mixSfxOntoVoice(...args:Parameters<typeof impl_mixSfxOntoVoice>):ReturnType<typeof impl_mixSfxOntoVoice> {return impl_mixSfxOntoVoice(...args);}
import {mixBgmWithDucking as impl_mixBgmWithDucking} from "../adapters/assets/audio-tools.js";
export function mixBgmWithDucking(...args:Parameters<typeof impl_mixBgmWithDucking>):ReturnType<typeof impl_mixBgmWithDucking> {return impl_mixBgmWithDucking(...args);}
import {indexSfxLibrary as impl_indexSfxLibrary} from "../adapters/assets/sfx-selector.js";
export function indexSfxLibrary(...args:Parameters<typeof impl_indexSfxLibrary>):ReturnType<typeof impl_indexSfxLibrary> {return impl_indexSfxLibrary(...args);}
import {pickSfxForScene as impl_pickSfxForScene} from "../adapters/assets/sfx-selector.js";
export function pickSfxForScene(...args:Parameters<typeof impl_pickSfxForScene>):ReturnType<typeof impl_pickSfxForScene> {return impl_pickSfxForScene(...args);}
import {defaultPlayback as impl_defaultPlayback} from "../adapters/assets/sfx-selector.js";
export function defaultPlayback(...args:Parameters<typeof impl_defaultPlayback>):ReturnType<typeof impl_defaultPlayback> {return impl_defaultPlayback(...args);}
import {composeHtml as impl_composeHtml} from "../adapters/render/html-composer.js";
export function composeHtml(...args:Parameters<typeof impl_composeHtml>):ReturnType<typeof impl_composeHtml> {return impl_composeHtml(...args);}
import {resolveSceneImageRefs as impl_resolveSceneImageRefs} from "../adapters/render/html-composer.js";
export function resolveSceneImageRefs(...args:Parameters<typeof impl_resolveSceneImageRefs>):ReturnType<typeof impl_resolveSceneImageRefs> {return impl_resolveSceneImageRefs(...args);}
import {renderWithHyperframes as impl_renderWithHyperframes} from "../adapters/render/hyperframes-runner.js";
export function renderWithHyperframes(...args:Parameters<typeof impl_renderWithHyperframes>):ReturnType<typeof impl_renderWithHyperframes> {return impl_renderWithHyperframes(...args);}
import {renderFingerprint as impl_renderFingerprint} from "../adapters/artifact-cache.js";
export function renderFingerprint(...args:Parameters<typeof impl_renderFingerprint>):ReturnType<typeof impl_renderFingerprint> {return impl_renderFingerprint(...args);}
import {createValidMockMp4File as impl_createValidMockMp4File} from "../adapters/assets/mock-media-generator.js";
export function createValidMockMp4File(...args:Parameters<typeof impl_createValidMockMp4File>):ReturnType<typeof impl_createValidMockMp4File> {return impl_createValidMockMp4File(...args);}
import {hasFfmpeg as impl_hasFfmpeg} from "../adapters/assets/mock-media-generator.js";
export function hasFfmpeg(...args:Parameters<typeof impl_hasFfmpeg>):ReturnType<typeof impl_hasFfmpeg> {return impl_hasFfmpeg(...args);}
import {hashFile as impl_hashFile} from "../adapters/artifact-store.js";
export function hashFile(...args:Parameters<typeof impl_hashFile>):ReturnType<typeof impl_hashFile> {return impl_hashFile(...args);}
import {resolveVideoDimensions as impl_resolveVideoDimensions} from "../adapters/dimension-resolver.js";
export function resolveVideoDimensions(...args:Parameters<typeof impl_resolveVideoDimensions>):ReturnType<typeof impl_resolveVideoDimensions> {return impl_resolveVideoDimensions(...args);}
import {runFfmpeg as impl_runFfmpeg} from "../adapters/ffmpeg.js";
export function runFfmpeg(...args:Parameters<typeof impl_runFfmpeg>):ReturnType<typeof impl_runFfmpeg> {return impl_runFfmpeg(...args);}
import {probeAudioFile as impl_probeAudioFile} from "../adapters/media-validator.js";
export function probeAudioFile(...args:Parameters<typeof impl_probeAudioFile>):ReturnType<typeof impl_probeAudioFile> {return impl_probeAudioFile(...args);}
import {probeVideoFile as impl_probeVideoFile} from "../adapters/media-validator.js";
export function probeVideoFile(...args:Parameters<typeof impl_probeVideoFile>):ReturnType<typeof impl_probeVideoFile> {return impl_probeVideoFile(...args);}
import {buildCrossfadeStitchFilter as impl_buildCrossfadeStitchFilter} from "../adapters/shot-chaining.js";
export function buildCrossfadeStitchFilter(...args:Parameters<typeof impl_buildCrossfadeStitchFilter>):ReturnType<typeof impl_buildCrossfadeStitchFilter> {return impl_buildCrossfadeStitchFilter(...args);}
import {resolveEffectiveRenderConfig as impl_resolveEffectiveRenderConfig} from "../adapters/render-config.js";
export function resolveEffectiveRenderConfig(...args:Parameters<typeof impl_resolveEffectiveRenderConfig>):ReturnType<typeof impl_resolveEffectiveRenderConfig> {return impl_resolveEffectiveRenderConfig(...args);}
import {readReference as impl_readReference} from "../adapters/artifact-store.js";
export function readReference(...args:Parameters<typeof impl_readReference>):ReturnType<typeof impl_readReference> {return impl_readReference(...args);}
import {hashEmbedding as impl_hashEmbedding} from "../adapters/artifact-store.js";
export function hashEmbedding(...args:Parameters<typeof impl_hashEmbedding>):ReturnType<typeof impl_hashEmbedding> {return impl_hashEmbedding(...args);}
import {recordReference as impl_recordReference} from "../adapters/artifact-store.js";
export function recordReference(...args:Parameters<typeof impl_recordReference>):ReturnType<typeof impl_recordReference> {return impl_recordReference(...args);}
import {downloadVideoSafely as impl_downloadVideoSafely} from "../adapters/media-validator.js";
export function downloadVideoSafely(...args:Parameters<typeof impl_downloadVideoSafely>):ReturnType<typeof impl_downloadVideoSafely> {return impl_downloadVideoSafely(...args);}
import {isFfmpegAvailable as impl_isFfmpegAvailable} from "../adapters/ffmpeg.js";
export function isFfmpegAvailable(...args:Parameters<typeof impl_isFfmpegAvailable>):ReturnType<typeof impl_isFfmpegAvailable> {return impl_isFfmpegAvailable(...args);}
import {decomposeShotDuration as impl_decomposeShotDuration} from "../adapters/shot-chaining.js";
export function decomposeShotDuration(...args:Parameters<typeof impl_decomposeShotDuration>):ReturnType<typeof impl_decomposeShotDuration> {return impl_decomposeShotDuration(...args);}
import {extractLastFrame as impl_extractLastFrame} from "../adapters/shot-chaining.js";
export function extractLastFrame(...args:Parameters<typeof impl_extractLastFrame>):ReturnType<typeof impl_extractLastFrame> {return impl_extractLastFrame(...args);}
import {stitchPassClips as impl_stitchPassClips} from "../adapters/shot-chaining.js";
export function stitchPassClips(...args:Parameters<typeof impl_stitchPassClips>):ReturnType<typeof impl_stitchPassClips> {return impl_stitchPassClips(...args);}
import {CdlGradingEngine as impl_cdlGradingEngine_resolveCdl} from "../adapters/cdl-grading-engine.js";
export function cdlGradingEngine_resolveCdl(...args:Parameters<typeof impl_cdlGradingEngine_resolveCdl.resolveCdl>):ReturnType<typeof impl_cdlGradingEngine_resolveCdl.resolveCdl>{return impl_cdlGradingEngine_resolveCdl.resolveCdl(...args);}
import {CdlGradingEngine as impl_cdlGradingEngine_transformRgbPixel} from "../adapters/cdl-grading-engine.js";
export function cdlGradingEngine_transformRgbPixel(...args:Parameters<typeof impl_cdlGradingEngine_transformRgbPixel.transformRgbPixel>):ReturnType<typeof impl_cdlGradingEngine_transformRgbPixel.transformRgbPixel>{return impl_cdlGradingEngine_transformRgbPixel.transformRgbPixel(...args);}
import {EmotionalVoiceController as impl_emotionalVoiceController_generateSettings} from "../adapters/audio/emotional-voice-controller.js";
export function emotionalVoiceController_generateSettings(...args:Parameters<typeof impl_emotionalVoiceController_generateSettings.generateSettings>):ReturnType<typeof impl_emotionalVoiceController_generateSettings.generateSettings>{return impl_emotionalVoiceController_generateSettings.generateSettings(...args);}
import {VisemeAligner as impl_visemeAligner_alignTextToDuration} from "../adapters/audio/viseme-aligner.js";
export function visemeAligner_alignTextToDuration(...args:Parameters<typeof impl_visemeAligner_alignTextToDuration.alignTextToDuration>):ReturnType<typeof impl_visemeAligner_alignTextToDuration.alignTextToDuration>{return impl_visemeAligner_alignTextToDuration.alignTextToDuration(...args);}
import {LipSyncEngine as impl_lipSyncEngine_alignLipSync} from "../adapters/lip-sync-engine.js";
export function lipSyncEngine_alignLipSync(...args:Parameters<typeof impl_lipSyncEngine_alignLipSync.alignLipSync>):ReturnType<typeof impl_lipSyncEngine_alignLipSync.alignLipSync>{return impl_lipSyncEngine_alignLipSync.alignLipSync(...args);}
import {SceneLightingMatcher as impl_sceneLightingMatcher_harmonizeScene} from "../adapters/scene-lighting-matcher.js";
export function sceneLightingMatcher_harmonizeScene(...args:Parameters<typeof impl_sceneLightingMatcher_harmonizeScene.harmonizeScene>):ReturnType<typeof impl_sceneLightingMatcher_harmonizeScene.harmonizeScene>{return impl_sceneLightingMatcher_harmonizeScene.harmonizeScene(...args);}
import {DepthRelightingEngine as impl_depthRelightingEngine_vectorFromAngles} from "../adapters/scene-lighting-matcher.js";
export function depthRelightingEngine_vectorFromAngles(...args:Parameters<typeof impl_depthRelightingEngine_vectorFromAngles.vectorFromAngles>):ReturnType<typeof impl_depthRelightingEngine_vectorFromAngles.vectorFromAngles>{return impl_depthRelightingEngine_vectorFromAngles.vectorFromAngles(...args);}
import {DepthRelightingEngine as impl_depthRelightingEngine_synthesizeRelightingFilterGraph} from "../adapters/scene-lighting-matcher.js";
export function depthRelightingEngine_synthesizeRelightingFilterGraph(...args:Parameters<typeof impl_depthRelightingEngine_synthesizeRelightingFilterGraph.synthesizeRelightingFilterGraph>):ReturnType<typeof impl_depthRelightingEngine_synthesizeRelightingFilterGraph.synthesizeRelightingFilterGraph>{return impl_depthRelightingEngine_synthesizeRelightingFilterGraph.synthesizeRelightingFilterGraph(...args);}
import {DepthRelightingEngine as impl_depthRelightingEngine_generateComfyUiPromptDirectives} from "../adapters/scene-lighting-matcher.js";
export function depthRelightingEngine_generateComfyUiPromptDirectives(...args:Parameters<typeof impl_depthRelightingEngine_generateComfyUiPromptDirectives.generateComfyUiPromptDirectives>):ReturnType<typeof impl_depthRelightingEngine_generateComfyUiPromptDirectives.generateComfyUiPromptDirectives>{return impl_depthRelightingEngine_generateComfyUiPromptDirectives.generateComfyUiPromptDirectives(...args);}
import {DepthRelightingEngine as impl_depthRelightingEngine_computeShadingMultiplier} from "../adapters/scene-lighting-matcher.js";
export function depthRelightingEngine_computeShadingMultiplier(...args:Parameters<typeof impl_depthRelightingEngine_computeShadingMultiplier.computeShadingMultiplier>):ReturnType<typeof impl_depthRelightingEngine_computeShadingMultiplier.computeShadingMultiplier>{return impl_depthRelightingEngine_computeShadingMultiplier.computeShadingMultiplier(...args);}
import {SceneLightingMatcher as impl_sceneLightingMatcher_resolveEnvironmentPreset} from "../adapters/scene-lighting-matcher.js";
export function sceneLightingMatcher_resolveEnvironmentPreset(...args:Parameters<typeof impl_sceneLightingMatcher_resolveEnvironmentPreset.resolveEnvironmentPreset>):ReturnType<typeof impl_sceneLightingMatcher_resolveEnvironmentPreset.resolveEnvironmentPreset>{return impl_sceneLightingMatcher_resolveEnvironmentPreset.resolveEnvironmentPreset(...args);}
import {runFfprobe as impl_runFfprobe} from "../adapters/ffmpeg.js";
export function runFfprobe(...args:Parameters<typeof impl_runFfprobe>):ReturnType<typeof impl_runFfprobe>{return impl_runFfprobe(...args);}
import {exportNleTimelines as impl_exportNleTimelines} from "../adapters/assembly/nle-exporter.js";
export function exportNleTimelines(...args:Parameters<typeof impl_exportNleTimelines>):ReturnType<typeof impl_exportNleTimelines>{return impl_exportNleTimelines(...args);}
import {parseFcp7Xml as impl_parseFcp7Xml} from "../adapters/assembly/nle-ingest-parser.js";
export function parseFcp7Xml(...args:Parameters<typeof impl_parseFcp7Xml>):ReturnType<typeof impl_parseFcp7Xml>{return impl_parseFcp7Xml(...args);}
import {applyNleEditsToBible as impl_applyNleEditsToBible} from "../adapters/assembly/nle-ingest-parser.js";
export function applyNleEditsToBible(...args:Parameters<typeof impl_applyNleEditsToBible>):ReturnType<typeof impl_applyNleEditsToBible>{return impl_applyNleEditsToBible(...args);}
import {applyNleEditsToTimeline as impl_applyNleEditsToTimeline} from "../adapters/assembly/nle-ingest-parser.js";
export function applyNleEditsToTimeline(...args:Parameters<typeof impl_applyNleEditsToTimeline>):ReturnType<typeof impl_applyNleEditsToTimeline>{return impl_applyNleEditsToTimeline(...args);}
import {compareWithTimeline as impl_compareWithTimeline} from "../adapters/assembly/nle-ingest-parser.js";
export function compareWithTimeline(...args:Parameters<typeof impl_compareWithTimeline>):ReturnType<typeof impl_compareWithTimeline>{return impl_compareWithTimeline(...args);}
import {parseNleTimeline as impl_parseNleTimeline} from "../adapters/assembly/nle-ingest-parser.js";
export function parseNleTimeline(...args:Parameters<typeof impl_parseNleTimeline>):ReturnType<typeof impl_parseNleTimeline>{return impl_parseNleTimeline(...args);}
import {NleRoundTripConformer as Conformer} from '../adapters/assembly/nle-conformer.js';
export function nleRoundTripConformer_conform(...args:Parameters<typeof Conformer.conform>){return Conformer.conform(...args);}
import {CINEMATIC_LOOK_PRESETS as LOOKS} from '../adapters/cdl-grading-engine.js';
export const CINEMATIC_LOOK_PRESETS=LOOKS;
export type {CinematicPresetName} from '../adapters/cdl-grading-engine.js';
