import {errorMessage} from "../../../platform/workflow-error.js";
import { mkdir, copyFile, writeFile, unlink, rename } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve, basename } from "node:path";

import { runMediaCommand } from "../../../platform/processes/media-process-runner.js";
import type { EpisodicScript, Shot, ShotType } from "../../../contracts/episode.js";
import type { AudioAssemblerStore } from "../ports/audio-assembler-store.js";
import type { Config, TtsProvider } from "../../../contracts/config.js";
import {
  getDurationSec,
  concatWithSilence,
  mixSfxOntoVoice,
  mixBgmWithDucking,
  masterAudioEbuR128,
  applySpatialAudioPanning,
  type SfxMixSpec,
} from "../adapters/assets/audio-tools.js";
import { createValidMockMp3File, hasFfmpeg } from "../adapters/assets/mock-media-generator.js";
import { type UnifiedTimeline, type DialogueOverflowPolicy, exportToSrt, exportToVtt } from "../../../contracts/timeline.js";
import { exportToAss } from "../adapters/ass-subtitle-builder.js";
import { TimelineScheduler, type MeasuredTtsDurations } from "./timeline-scheduler.js";
import type { FoleyGenerator } from "../ports/foley.js";
import { log } from "../../../platform/observability/logger.js";

import { packageRoot } from "../../../platform/filesystem/package-paths.js";
import { AssetId } from "../../../contracts/asset-id.js";
import { containedPath } from "../../../platform/filesystem/containment.js";
import type {ResolvedVoicePlan} from '../../../contracts/audio-generation.js';

export interface TimelineVideoShot {
  shotId: string;
  startSec: number;
  endSec: number;
  durationSec: number;
  shotType: ShotType;
  visualPrompt: string;
  referenceImage?: string;
  characterId?: string;
  approvedClipPath?: string;
}

export interface TimelineDialogueCue {
  shotId: string;
  dialogueId?: string;
  speakerId: string;
  speakerName: string;
  text: string;
  startSec: number; // Strictly anchored to shot.startSec
  durationSec: number;
  audioPath: string;
  voiceProfileId?: string;
  actingInstruction?: string;
}

export interface TimelineSfxCue {
  name: string;
  startSec: number;
  durationSec: number;
  audioPath: string;
  volume: number;
  pan?: number;
  shotId?: string;
  actionPrompt?: string;
}

export interface MasterTimeline {
  episodeNumber: number;
  totalDurationSec: number;
  fps: number;
  videoTrack: TimelineVideoShot[];
  dialogueTrack: TimelineDialogueCue[];
  sfxTrack: TimelineSfxCue[];
  bgmTrack?: {
    audioPath: string;
    duckingWindows: Array<{ startSec: number; endSec: number }>;
    baseVolume: number;
    duckedVolume: number;
  };
}

export interface DialogueAudioResult {
  shotId: string;
  dialogueId?: string;
  speakerName: string;
  characterId: string;
  text: string;
  audioPath: string;
  durationSec: number;
}

export interface AssembleAudioOptions {
  voicePlan?: ResolvedVoicePlan[];
  attemptScope?: string;
  signal?: AbortSignal;
  checkpoint?: () => Promise<void>;
  script: EpisodicScript;
  bible: AudioAssemblerStore;
  outputDir: string;
  mockTts?: boolean;
  overflowPolicy?: DialogueOverflowPolicy;
  transitionDurationSec?: number;
  transitionType?: "cut" | "crossfade";
  sfxDir?: string;
  bgmDir?: string;
  ambienceDir?: string;
  foleyGenerator?: FoleyGenerator;
  enableFoleySynthesis?: boolean;
  cfg?: Config;
}

export interface AudioStems {
  dialogue: string;
  sfx: string;
  ambience: string;
  bgm: string;
  master: string;
}

export interface SubtitleFiles {
  srtPath: string;
  vttPath: string;
  assPath?: string;
}

export interface AssembleAudioResult {
  timeline: MasterTimeline;
  unifiedTimeline: UnifiedTimeline;
  dialogueTracks: DialogueAudioResult[];
  voiceOnlyPath: string;
  finalAudioPath: string;
  totalDurationSec: number;
  stems: AudioStems;
  subtitles: SubtitleFiles;
}

/**
 * Builds a deterministic MasterTimeline where each shot, dialogue line,
 * and SFX cue has an exact, non-drifting timecode anchor.
 */
export function buildMasterTimeline(script: EpisodicScript, fps = 30): MasterTimeline {
  const videoTrack: TimelineVideoShot[] = [];
  const dialogueTrack: TimelineDialogueCue[] = [];
  const sfxTrack: TimelineSfxCue[] = [];

  let timelineCursor = 0;

  for (const scene of script.scenes) {
    for (const shot of scene.shots) {
      const shotDur = Math.max(1.0, shot.durationSec || 4.0);
      const startSec = timelineCursor;
      const endSec = startSec + shotDur;

      videoTrack.push({
        shotId: shot.shotId,
        startSec,
        endSec,
        durationSec: shotDur,
        shotType: shot.shotType,
        visualPrompt: shot.visualPrompt,
        referenceImage: shot.referenceImage,
        characterId: shot.characterId,
      });

      const dList =
        shot.dialogues && shot.dialogues.length > 0
          ? shot.dialogues
          : shot.dialogue
          ? [shot.dialogue]
          : [];

      let dialogueOffset = 0;
      for (const d of dList) {
        if (d.text && d.text.trim()) {
          const cueDuration =
            d.durationSec && d.durationSec > 0
              ? d.durationSec
              : Math.max(1.0, (d.ttsText || d.text).split(/\s+/).length * 0.35);

          dialogueTrack.push({
            shotId: shot.shotId,
            dialogueId: d.dialogueId,
            speakerId: d.characterId,
            speakerName: d.speakerName,
            text: d.ttsText || d.text,
            startSec: Number((startSec + dialogueOffset).toFixed(3)), // strictly anchored and sequenced
            durationSec: Number(cueDuration.toFixed(3)),
            audioPath: "",
            voiceProfileId: d.voiceProfileId,
            actingInstruction: d.actingInstruction,
          });
          dialogueOffset += cueDuration + 0.15;
        }
      }

      if (shot.sfxCue) {
        const offset = shot.sfxCue.offsetSec || 0;
        sfxTrack.push({
          name: shot.sfxCue.name,
          startSec: startSec + offset,
          durationSec: 0,
          audioPath: "",
          volume: shot.sfxCue.volume ?? 0.7,
          pan: shot.sfxCue.pan,
          shotId: shot.shotId,
          actionPrompt: shot.sfxCue.description || shot.visualPrompt,
        });
      }

      timelineCursor = endSec;
    }
  }

  return {
    episodeNumber: script.episodeNumber,
    totalDurationSec: timelineCursor,
    fps,
    videoTrack,
    dialogueTrack,
    sfxTrack,
  };
}

function parseVoiceProvider(provStr: string, fallback: TtsProvider): TtsProvider {
  if (provStr === "elevenlabs" || provStr === "lucylab" || provStr === "cosyvoice" || provStr === "f5tts") {
    return provStr;
  }
  return fallback;
}

/**
 * Resolves the effective voice ID and provider for a dialogue line.
 */
export function resolveVoiceForDialogue(
  shot: Shot,
  bible: AudioAssemblerStore,
  defaultCfg: Config
): { provider: TtsProvider; voiceId: string } {
  const dialogue = shot.dialogue;
  if (!dialogue) {
    return {
      provider: defaultCfg.ttsProvider,
      voiceId:
        defaultCfg.ttsProvider === "lucylab"
          ? defaultCfg.lucylabVoiceId || "default-voice"
          : defaultCfg.ttsProvider === "elevenlabs"
          ? defaultCfg.elevenlabsVoiceId || "default-voice"
          : defaultCfg.ttsProvider === "cosyvoice"
          ? defaultCfg.cosyvoiceVoiceId || "default"
          : "default",
    };
  }

  // 1. Check explicit voiceProfileId on dialogue
  if (dialogue.voiceProfileId) {
    if (dialogue.voiceProfileId.includes(":")) {
      const [prov, id] = dialogue.voiceProfileId.split(":");
      return {
        provider: parseVoiceProvider(prov, defaultCfg.ttsProvider),
        voiceId: id,
      };
    }
    return {
      provider: defaultCfg.ttsProvider,
      voiceId: dialogue.voiceProfileId,
    };
  }

  // 2. Check Character Record from Bible
  if (dialogue.characterId && dialogue.characterId !== "narrator") {
    const char = bible.getCharacter(dialogue.characterId);
    if (char?.voice_profile_id) {
      if (char.voice_profile_id.includes(":")) {
        const [prov, id] = char.voice_profile_id.split(":");
        return {
          provider: parseVoiceProvider(prov, defaultCfg.ttsProvider),
          voiceId: id,
        };
      }
      return {
        provider: defaultCfg.ttsProvider,
        voiceId: char.voice_profile_id,
      };
    }
  }

  // 3. Fallback to default config voice
  if (dialogue.isUnresolved) {
    log.warn(
      `[AUDIO WARNING] Nhân vật '${dialogue.speakerName}' chưa có voiceProfileId trong Story Bible. Tạm thời sử dụng giọng mặc định.`
    );
  }

  return {
    provider: defaultCfg.ttsProvider,
    voiceId:
      defaultCfg.ttsProvider === "lucylab"
        ? defaultCfg.lucylabVoiceId || "default-voice"
        : defaultCfg.ttsProvider === "elevenlabs"
        ? defaultCfg.elevenlabsVoiceId || "default-voice"
        : defaultCfg.ttsProvider === "cosyvoice"
        ? defaultCfg.cosyvoiceVoiceId || "default"
        : "default",
  };
}

/**
 * Ensures an audio clip is padded to match the exact target duration (e.g. shot.durationSec),
 * preventing cumulative audio/video timeline drift.
 */
export async function padAudioToDuration(inputPath: string, targetDurationSec: number): Promise<string> {
  let currentDur = targetDurationSec;
  try {
    currentDur = await getDurationSec(inputPath);
  } catch {
    return inputPath;
  }

  // If already long enough (within 50ms), no padding needed
  if (currentDur >= targetDurationSec - 0.05) {
    return inputPath;
  }

  const paddedPath = inputPath.replace(/\.mp3$/, "_padded.mp3");
  const silenceSec = targetDurationSec - currentDur;

  try {
    await runMediaCommand("ffmpeg", [
      "-y",
      "-i",
      inputPath,
      "-af",
      `apad=whole_dur=${targetDurationSec}`,
      "-t",
      String(targetDurationSec),
      "-c:a",
      "libmp3lame",
      "-b:a",
      "192k",
      paddedPath,
    ]);

    return paddedPath;
  } catch {
    // Fallback: concat with generated mock silence
    try {
      const silencePath = inputPath.replace(/\.mp3$/, "_silence.mp3");
      await createValidMockMp3File(silencePath, silenceSec);
      await concatWithSilence([inputPath, silencePath], 0.0, paddedPath);
      return paddedPath;
    } catch {
      return inputPath;
    }
  }
}

/**
 * Multi-Character Audio Assembler for Episodic AI Series.
 */
export class EpisodeAudioAssembler {
  private cfg: Config;
  private sfxDir: string;
  private bgmDir: string;
  private ambienceDir: string;
  private foleyGenerator?: FoleyGenerator;

  constructor(
    options: {
      cfg: Config;
      createTts:(provider:TtsProvider,voiceId:string,mockTts:boolean)=>import("../../../contracts/tts.js").TtsClient;
      sfxDir?: string;
      bgmDir?: string;
      ambienceDir?: string;
      foleyGenerator?: FoleyGenerator;
      resolveActingInstruction?: (text:string,provider:TtsProvider,explicit?:string)=>string|undefined;
      normalizeTtsText?: (text:string,provider:TtsProvider)=>string;
      hashReference?: (path:string,signal?:AbortSignal)=>Promise<string|null>;
    }
  ) {
    this.cfg = options.cfg;
    this.createTts = options.createTts;
    this.sfxDir = options.sfxDir ?? join(packageRoot,"assets", "sfx");
    this.bgmDir = options.bgmDir ?? join(packageRoot,"assets", "bgm");
    this.ambienceDir = options.ambienceDir ?? join(packageRoot,"assets", "ambience");
    this.foleyGenerator = options.foleyGenerator;
    this.hashReference = options.hashReference;
    this.resolveActingInstruction=options.resolveActingInstruction??((_text,_provider,explicit)=>explicit);
    this.normalizeTtsText=options.normalizeTtsText??(text=>text);
  }

  private createTts:(provider:TtsProvider,voiceId:string,mockTts:boolean)=>import("../../../contracts/tts.js").TtsClient;
  private resolveActingInstruction:(text:string,provider:TtsProvider,explicit?:string)=>string|undefined;
  private normalizeTtsText:(text:string,provider:TtsProvider)=>string;
  private hashReference?: (path:string,signal?:AbortSignal)=>Promise<string|null>;
  public async resolveVoicePlan(script:EpisodicScript,bible:AudioAssemblerStore,signal?:AbortSignal):Promise<ResolvedVoicePlan[]> {
    const plan:ResolvedVoicePlan[]=[];const references=new Map<string,string|null>();
    for(const scene of script.scenes)for(const shot of scene.shots)for(const dialogue of shot.dialogues){
      const voice=resolveVoiceForDialogue({...shot,dialogue},bible,this.cfg);
      const profile=voice.provider==='f5tts'?this.cfg.f5ttsVoiceProfiles?.[voice.voiceId]:undefined;
      const referenceAudio=voice.provider==='f5tts'?(typeof profile==='string'?profile:profile?.refAudio??this.cfg.f5ttsRefAudio):undefined;
      if(referenceAudio&&!this.hashReference)throw new Error('REFERENCE_HASHER_REQUIRED');
      if(referenceAudio&&!references.has(referenceAudio))references.set(referenceAudio,await this.hashReference!(referenceAudio,signal));
      plan.push({dialogueId:dialogue.dialogueId,...voice,modelId:voice.provider==='elevenlabs'?this.cfg.elevenlabsModelId:undefined,referenceAudio,referenceAudioSha256:referenceAudio?references.get(referenceAudio)??undefined:undefined,referenceText:voice.provider==='f5tts'?(typeof profile==='object'?profile.refText??this.cfg.f5ttsRefText:this.cfg.f5ttsRefText):undefined,text:this.normalizeTtsText(dialogue.ttsText??dialogue.text,voice.provider),actingInstruction:this.resolveActingInstruction(dialogue.ttsText??dialogue.text,voice.provider,dialogue.actingInstruction),speed:1});
    }
    return plan;
  }

  public getCfg(): Config {
    return this.cfg;
  }

  /**
   * Generates all dialogue audio tracks for an episode, separates tracks into individual stems
   * (dialogue, sfx, ambience, bgm), mixes them into master soundtrack, and formats subtitles.
   */
  public async assembleEpisodeAudio(options: AssembleAudioOptions): Promise<AssembleAudioResult> {
    const { script, bible, outputDir, mockTts } = options;
    for (const scene of script.scenes) for (const shot of scene.shots) {
      AssetId.parse(shot.shotId);
      for (const dialogue of shot.dialogues ?? (shot.dialogue ? [shot.dialogue] : [])) {
        if (dialogue.dialogueId) AssetId.parse(dialogue.dialogueId);
      }
    }
    await mkdir(outputDir, {recursive:true});
    const audioDir = containedPath(outputDir, join(outputDir, "audio"));
    const stemsDir = containedPath(outputDir, join(audioDir, "stems"));
    await mkdir(stemsDir, { recursive: true });

    // ── STEP 1: Pre-Synthesize / Pre-Measure TTS Before Finalizing Timeline ───
    const measuredTtsDurations: MeasuredTtsDurations = {};
    const dialogueTracks: DialogueAudioResult[] = [];
    const synthesizedFilesByShotId = new Map<string, string[]>();
    const dialogueAudioMap = new Map<string, string>();

    for (const scene of script.scenes) {
      for (const shot of scene.shots) {
        const dList =
          shot.dialogues && shot.dialogues.length > 0
            ? shot.dialogues
            : shot.dialogue
            ? [shot.dialogue]
            : [];

        const shotFiles: string[] = [];

        for (let i = 0; i < dList.length; i++) {
          const dialogue = dList[i];
          const turnId = dialogue.dialogueId || `${shot.shotId}_d${String(i + 1).padStart(2, "0")}`;
          AssetId.parse(turnId);
          const turnPath = containedPath(outputDir, join(audioDir, `dialogue-${turnId}.mp3`));
          const textToSpeak = dialogue.ttsText || dialogue.text;

          const mockShot: Shot = {
            shotId: shot.shotId,
            shotType: shot.shotType,
            durationSec: shot.durationSec,
            visualPrompt: shot.visualPrompt,
            dialogues: [dialogue],
            dialogue,
            beatIds: shot.beatIds || [],
          };
          const resolved=options.voicePlan?.find(voice=>voice.dialogueId===turnId);
          const { provider, voiceId } = resolved ?? resolveVoiceForDialogue(mockShot, bible, this.cfg);

          let measuredDur = 1.5;
          if (mockTts) {
            const words = textToSpeak.trim().split(/\s+/).length;
            measuredDur = Math.max(1.0, Math.round((words / 2.6) * 10) / 10);
            await createValidMockMp3File(turnPath, measuredDur);
          } else {
            const client = this.createTts(provider,voiceId,options.mockTts===true);
            await options.checkpoint?.();
            await client.generate(resolved?.text??textToSpeak,turnPath,undefined,{seriesId:script.seriesId,attemptKey:options.attemptScope?`${options.attemptScope}:${turnId}`:undefined,voiceProfileId:voiceId,normalizedText:Boolean(resolved),actingInstruction:resolved?.actingInstruction??dialogue.actingInstruction,speed:resolved?.speed,signal:options.signal});

            measuredDur = await getDurationSec(turnPath);
          }

          measuredTtsDurations[turnId] = measuredDur;
          shotFiles.push(turnPath);
          dialogueAudioMap.set(turnId, turnPath);
          if (dialogue.dialogueId) {
            dialogueAudioMap.set(dialogue.dialogueId, turnPath);
          }

          dialogueTracks.push({
            shotId: shot.shotId,
            dialogueId: turnId,
            speakerName: dialogue.speakerName,
            characterId: dialogue.characterId,
            text: dialogue.text,
            audioPath: turnPath,
            durationSec: measuredDur,
          });
        }

        if (shotFiles.length > 0) {
          synthesizedFilesByShotId.set(shot.shotId, shotFiles);
        }
      }
    }

    // ── STEP 2: Schedule Unified Timeline Based on Measured Audio Durations ───
    const transitionType =
      options.transitionType ??
      (options.transitionDurationSec && options.transitionDurationSec > 0 ? "crossfade" : "cut");

    const unifiedTimeline = TimelineScheduler.schedule(script, measuredTtsDurations, {
      fps: script.fps ?? 30,
      overflowPolicy: options.overflowPolicy ?? "extend_shot",
      transitionDurationSec: options.transitionDurationSec ?? 0.0,
      transitionType,
    });

    for (const cue of unifiedTimeline.dialogueTrack) {
      const aPath = dialogueAudioMap.get(cue.dialogueId);
      if (aPath) {
        cue.audioPath = aPath;
      }
    }

    // Apply Spatial Audio Panning to dialogue turn stems when pan is configured
    if (!mockTts && (await hasFfmpeg())) {
      for (const cue of unifiedTimeline.dialogueTrack) {
        if (cue.pan && Math.abs(cue.pan) >= 0.05) {
          const origAudio = dialogueAudioMap.get(cue.dialogueId) || cue.audioPath;
          if (origAudio && existsSync(origAudio)) {
            const baseFileName = basename(origAudio, ".mp3");
            const pannedPath = join(audioDir, `${baseFileName}_panned.mp3`);
            try {
              await applySpatialAudioPanning(origAudio, pannedPath, cue.pan);
              if (existsSync(pannedPath)) {
                dialogueAudioMap.set(cue.dialogueId, pannedPath);
                cue.audioPath = pannedPath;
              }
            } catch (panErr: unknown) {
              log.warn(`[SPATIAL AUDIO] Không thể pan giọng thoại '${cue.dialogueId}': ${errorMessage(panErr)}`);
            }
          }
        }
      }
    }

    // ── STEP 3: Assemble Stem 1 - Dialogue Track ──────────────────────────────
    const shotDialoguePaddedPaths: string[] = [];

    for (const vShot of unifiedTimeline.videoTrack) {
      const rawTurnFiles = synthesizedFilesByShotId.get(vShot.shotId) || [];
      const turnFiles = rawTurnFiles.map((f) => {
        const baseFileName = basename(f, ".mp3");
        const pannedCandidate = join(audioDir, `${baseFileName}_panned.mp3`);
        return existsSync(pannedCandidate) ? pannedCandidate : f;
      });
      const shotCombinedPath = join(audioDir, `dialogue-${vShot.shotId}_combined.mp3`);

      if (turnFiles.length === 0) {
        // Non-dialogue shot: create exact silence block for shot duration
        const silentPath = join(audioDir, `silent-${vShot.shotId}.mp3`);
        await createValidMockMp3File(silentPath, vShot.durationSec);
        shotDialoguePaddedPaths.push(silentPath);
      } else if (turnFiles.length === 1) {
        const paddedPath = await padAudioToDuration(turnFiles[0], vShot.durationSec);
        shotDialoguePaddedPaths.push(paddedPath);
      } else {
        // Multi-turn dialogue: concat turns with 0.15s silence gap, then pad to shot duration
        if (!mockTts) {
          try {
            await concatWithSilence(turnFiles, 0.15, shotCombinedPath);
          } catch (err: unknown) {
            throw new Error(`Ghép các lượt thoại cho shot [${vShot.shotId}] thất bại: ${errorMessage(err)}`);
          }
        } else {
          const totalDur = turnFiles.length * 1.5;
          await createValidMockMp3File(shotCombinedPath, Math.min(totalDur, vShot.durationSec));
        }
        const paddedPath = await padAudioToDuration(shotCombinedPath, vShot.durationSec);
        shotDialoguePaddedPaths.push(paddedPath);
      }
    }

    const stemDialoguePath = join(stemsDir, "stem_dialogue.mp3");
    if (shotDialoguePaddedPaths.length > 0 && !mockTts) {
      try {
        if (transitionType === "crossfade" && (options.transitionDurationSec ?? 0) > 0) {
          const dialogueMixList: SfxMixSpec[] = [];
          for (const cue of unifiedTimeline.dialogueTrack) {
            const turnAudio = dialogueAudioMap.get(cue.dialogueId) || cue.audioPath;
            if (turnAudio && existsSync(turnAudio)) {
              dialogueMixList.push({
                path: turnAudio,
                startSec: cue.startSec,
                volume: cue.volume ?? 1.0,
              });
            }
          }
          await createValidMockMp3File(stemDialoguePath, unifiedTimeline.targetTotalDurationSec);
          if (dialogueMixList.length > 0) {
            const tempMixedPath = `${stemDialoguePath}.tmp_${Date.now()}_${Math.random().toString(36).slice(2, 7)}.mp3`;
            await mixSfxOntoVoice(stemDialoguePath, dialogueMixList, tempMixedPath);
            if (existsSync(stemDialoguePath)) {
              await unlink(stemDialoguePath).catch(() => {});
            }
            try {
              await rename(tempMixedPath, stemDialoguePath);
            } catch {
              await copyFile(tempMixedPath, stemDialoguePath);
              await unlink(tempMixedPath).catch(() => {});
            }
          }
        } else {
          await concatWithSilence(shotDialoguePaddedPaths, 0.0, stemDialoguePath);
        }
      } catch (err: unknown) {
        throw new Error(`Ghép toàn bộ stem dialogue thất bại: ${errorMessage(err)}`);
      }
    } else {
      await createValidMockMp3File(stemDialoguePath, unifiedTimeline.targetTotalDurationSec);
    }

    // ── STEP 4: Assemble Stem 2 - SFX Track ───────────────────────────────────
    const stemSfxPath = join(stemsDir, "stem_sfx.mp3");
    const sfxList: SfxMixSpec[] = [];

    // Map approved clip paths by shotId from videoTrack for Foley sync
    const shotClipMap = new Map<string, string>();
    for (const v of unifiedTimeline.videoTrack) {
      if (v.approvedClipPath) {
        shotClipMap.set(v.shotId, v.approvedClipPath);
      }
    }

    const effectiveFoleyGen = options.foleyGenerator || this.foleyGenerator;

    for (const cue of unifiedTimeline.sfxTrack) {
      let resolvedSfx: string | null = null;
      const sfxPath = join(this.sfxDir, cue.name.endsWith(".mp3") ? cue.name : `${cue.name}.mp3`);
      if (existsSync(sfxPath)) {
        resolvedSfx = sfxPath;
      } else {
        const generatedSfxPath = join(audioDir, `sfx_${cue.name.replace(/[^a-zA-Z0-9_-]/g, "_")}.mp3`);
        if (existsSync(generatedSfxPath)) {
          resolvedSfx = generatedSfxPath;
        } else if (effectiveFoleyGen) {
          const videoClip = (cue.shotId ? shotClipMap.get(cue.shotId) : undefined) || "placeholder.mp4";
          const actionText = cue.actionPrompt || cue.name;
          try {
            await options.checkpoint?.();
            await effectiveFoleyGen.generateFoley(videoClip, actionText, generatedSfxPath, {
              durationSec: cue.durationSec || 2.5,
              volume: cue.volume,
            });
            if (existsSync(generatedSfxPath)) {
              resolvedSfx = generatedSfxPath;
            }
          } catch (foleyErr: unknown) {
            log.warn(`[FOLEY GENERATOR] Không thể sinh Foley cho '${cue.name}': ${errorMessage(foleyErr)}`);
          }
        }

        if (!resolvedSfx && (mockTts || !(await hasFfmpeg()))) {
          await createValidMockMp3File(generatedSfxPath, cue.durationSec || 2.0);
          resolvedSfx = generatedSfxPath;
        }
      }

      if (resolvedSfx && existsSync(resolvedSfx)) {
        let finalSfxPath = resolvedSfx;
        // Check if cue has spatial pan
        if (cue.pan && Math.abs(cue.pan) >= 0.05 && !mockTts) {
          const pannedCandidate = finalSfxPath.replace(
            /\.mp3$/,
            `_panned_${cue.pan > 0 ? "r" : "l"}.mp3`
          );
          try {
            await applySpatialAudioPanning(finalSfxPath, pannedCandidate, cue.pan);
            if (existsSync(pannedCandidate)) {
              finalSfxPath = pannedCandidate;
            }
          } catch (panErr: unknown) {
            log.warn(`[SPATIAL AUDIO] Không thể pan SFX '${cue.name}': ${errorMessage(panErr)}`);
          }
        }

        sfxList.push({
          path: finalSfxPath,
          startSec: cue.startSec,
          volume: cue.volume,
        });
        cue.audioPath = finalSfxPath;
      }
    }

    // Generate SFX stem
    await createValidMockMp3File(stemSfxPath, unifiedTimeline.targetTotalDurationSec);
    if (sfxList.length > 0 && !mockTts) {
      try {
        const tempSfxPath = `${stemSfxPath}.tmp_${Date.now()}_${Math.random().toString(36).slice(2, 7)}.mp3`;
        await mixSfxOntoVoice(stemSfxPath, sfxList, tempSfxPath);
        if (existsSync(stemSfxPath)) {
          await unlink(stemSfxPath).catch(() => {});
        }
        try {
          await rename(tempSfxPath, stemSfxPath);
        } catch {
          await copyFile(tempSfxPath, stemSfxPath);
          await unlink(tempSfxPath).catch(() => {});
        }
      } catch (error) { log.warn("[audio-assembler] Non-fatal operation failed: "+errorMessage(error)); }
    }

    // ── STEP 5: Assemble Stem 3 - Ambience Track ──────────────────────────────
    const stemAmbiencePath = join(stemsDir, "stem_ambience.mp3");
    await createValidMockMp3File(stemAmbiencePath, unifiedTimeline.targetTotalDurationSec);

    // ── STEP 6: Assemble Stem 4 - BGM Track with Auto-Ducking ─────────────────
    const stemBgmPath = join(stemsDir, "stem_bgm.mp3");
    const bgmCandidate = script.bgm;
    let resolvedBgmPath: string | null = null;

    if (bgmCandidate && bgmCandidate !== "none") {
      const direct = resolve(outputDir, bgmCandidate);
      const inBgmDir = join(
        this.bgmDir,
        bgmCandidate.endsWith(".mp3") ? bgmCandidate : `${bgmCandidate}.mp3`
      );

      if (existsSync(direct)) resolvedBgmPath = direct;
      else if (existsSync(inBgmDir)) resolvedBgmPath = inBgmDir;
      else if (existsSync(bgmCandidate)) resolvedBgmPath = bgmCandidate;
    }

    if (resolvedBgmPath && !mockTts) {
      try {
        await mixBgmWithDucking(stemDialoguePath, resolvedBgmPath, stemBgmPath);
      } catch {
        await createValidMockMp3File(stemBgmPath, unifiedTimeline.targetTotalDurationSec);
      }
    } else {
      await createValidMockMp3File(stemBgmPath, unifiedTimeline.targetTotalDurationSec);
    }

    // ── STEP 7: Master Soundtrack Mixdown ─────────────────────────────────────
    const masterSoundtrackPath = join(audioDir, "master-soundtrack.mp3");
    const voiceWithSfxPath = join(audioDir, "voice-sfx.mp3");

    if (sfxList.length > 0 && !mockTts) {
      try {
        await mixSfxOntoVoice(stemDialoguePath, sfxList, voiceWithSfxPath);
      } catch {
        await copyFile(stemDialoguePath, voiceWithSfxPath);
      }
    } else {
      await copyFile(stemDialoguePath, voiceWithSfxPath);
    }

    if (resolvedBgmPath && !mockTts) {
      try {
        await mixBgmWithDucking(voiceWithSfxPath, resolvedBgmPath, masterSoundtrackPath);
      } catch {
        await copyFile(voiceWithSfxPath, masterSoundtrackPath);
      }
    } else {
      await copyFile(voiceWithSfxPath, masterSoundtrackPath);
    }

    // Apply EBU R128 mastering to master soundtrack
    const soundtrackMasterWav = join(audioDir, "soundtrack_master.wav");
    if (!mockTts) {
      try {
        const masteredMp3 = join(audioDir, "master-soundtrack-ebu128.mp3");
        await masterAudioEbuR128(masterSoundtrackPath, masteredMp3, {
          targetLufs: -14.0,
          truePeak: -1.0,
          lra: 7.0,
        });
        if (existsSync(masteredMp3)) {
          await copyFile(masteredMp3, masterSoundtrackPath);
          await unlink(masteredMp3).catch(() => {});
        }
      } catch (masterErr: unknown) {
        log.warn(`  [EBU R128] Không thể chuẩn hóa loudness MP3: ${errorMessage(masterErr) || masterErr}`);
      }

      try {
        await masterAudioEbuR128(masterSoundtrackPath, soundtrackMasterWav, {
          targetLufs: -23.0,
          truePeak: -1.0,
          lra: 11.0,
        });
      } catch (wavErr: unknown) {
        log.warn(`  [EBU R128] Fallback copy cho broadcast WAV: ${errorMessage(wavErr) || wavErr}`);
        try {
          await copyFile(masterSoundtrackPath, soundtrackMasterWav);
        } catch (error) { log.warn("[audio-assembler] Non-fatal operation failed: "+errorMessage(error)); }
      }
    } else {
      try {
        await copyFile(masterSoundtrackPath, soundtrackMasterWav);
      } catch (error) { log.warn("[audio-assembler] Non-fatal operation failed: "+errorMessage(error)); }
    }

    // Measure actual master audio duration
    const actualAudioDur = await getDurationSec(masterSoundtrackPath);

    // ── STEP 8: Subtitle Export (SRT, WebVTT & Kinetic ASS) ─────────────────
    const srtPath = join(outputDir, "subtitles.srt");
    const vttPath = join(outputDir, "subtitles.vtt");
    const assPath = join(outputDir, "subtitles.ass");
    const srtContent = exportToSrt(unifiedTimeline.subtitleTrack);
    const vttContent = exportToVtt(unifiedTimeline.subtitleTrack);
    const isPortrait = script.aspectRatio !== "16:9";
    const assContent = exportToAss(unifiedTimeline.subtitleTrack, {
      aspectRatio: script.aspectRatio === "16:9" ? "16:9" : "9:16",
      style: isPortrait ? "short_drama_punch" : "karaoke",
      safeTitleAvoidance: isPortrait,
      enablePeakImpactLinking: true,
    });
    await writeFile(srtPath, srtContent, "utf8");
    await writeFile(vttPath, vttContent, "utf8");
    await writeFile(assPath, assContent, "utf8");

    // ── STEP 9: Finalize Timeline Stems & Metrics ─────────────────────────────
    unifiedTimeline.stems = {
      dialogue: stemDialoguePath,
      sfx: stemSfxPath,
      ambience: stemAmbiencePath,
      bgm: stemBgmPath,
      master: masterSoundtrackPath,
    };

    unifiedTimeline.metrics.audioDurationSec = actualAudioDur;
    unifiedTimeline.metrics.driftSec = Math.abs(
      unifiedTimeline.metrics.audioDurationSec - unifiedTimeline.metrics.videoDurationSec
    );
    unifiedTimeline.metrics.isWithinTolerance =
      unifiedTimeline.metrics.driftSec <= unifiedTimeline.metrics.toleranceSec;

    // Backward compatible MasterTimeline
    const legacyTimeline = buildMasterTimeline(script, unifiedTimeline.fps);
    legacyTimeline.totalDurationSec = unifiedTimeline.targetTotalDurationSec;

    return {
      timeline: legacyTimeline,
      unifiedTimeline,
      dialogueTracks,
      voiceOnlyPath: stemDialoguePath,
      finalAudioPath: masterSoundtrackPath,
      totalDurationSec: unifiedTimeline.targetTotalDurationSec,
      stems: {
        dialogue: stemDialoguePath,
        sfx: stemSfxPath,
        ambience: stemAmbiencePath,
        bgm: stemBgmPath,
        master: masterSoundtrackPath,
      },
      subtitles: {
        srtPath,
        vttPath,
        assPath,
      },
    };
  }
}
