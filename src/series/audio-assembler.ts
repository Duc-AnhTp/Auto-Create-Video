import { mkdir, copyFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import type { EpisodicScript, Shot, ShotType } from "./series-schema.js";
import { BibleManager } from "../bible/bible-manager.js";
import { loadConfig, type Config } from "../config.js";
import { LucylabClient } from "../tts/lucylab-client.js";
import { ElevenLabsClient } from "../tts/elevenlabs-client.js";
import {
  getDurationSec,
  concatWithSilence,
  mixSfxOntoVoice,
  mixBgmWithDucking,
  type SfxMixSpec,
} from "../assets/audio-tools.js";
import { createValidMockMp3File } from "../assets/mock-media-generator.js";
import {
  type UnifiedTimeline,
  type DialogueOverflowPolicy,
  exportToSrt,
  exportToVtt,
} from "./timeline-schema.js";
import { TimelineScheduler, type MeasuredTtsDurations } from "./timeline-scheduler.js";
import { log } from "../utils/logger.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

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
}

export interface TimelineSfxCue {
  name: string;
  startSec: number;
  durationSec: number;
  audioPath: string;
  volume: number;
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
  script: EpisodicScript;
  bible: BibleManager;
  outputDir: string;
  mockTts?: boolean;
  overflowPolicy?: DialogueOverflowPolicy;
  transitionDurationSec?: number;
  transitionType?: "cut" | "crossfade";
  sfxDir?: string;
  bgmDir?: string;
  ambienceDir?: string;
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

/**
 * Resolves the effective voice ID and provider for a dialogue line.
 */
export function resolveVoiceForDialogue(
  shot: Shot,
  bible: BibleManager,
  defaultCfg: Config
): { provider: "lucylab" | "elevenlabs"; voiceId: string } {
  const dialogue = shot.dialogue;
  if (!dialogue) {
    return {
      provider: defaultCfg.ttsProvider,
      voiceId:
        defaultCfg.ttsProvider === "lucylab"
          ? defaultCfg.lucylabVoiceId!
          : defaultCfg.elevenlabsVoiceId!,
    };
  }

  // 1. Check explicit voiceProfileId on dialogue
  if (dialogue.voiceProfileId) {
    if (dialogue.voiceProfileId.includes(":")) {
      const [prov, id] = dialogue.voiceProfileId.split(":");
      return {
        provider: prov === "elevenlabs" ? "elevenlabs" : "lucylab",
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
          provider: prov === "elevenlabs" ? "elevenlabs" : "lucylab",
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
        : defaultCfg.elevenlabsVoiceId || "default-voice",
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
    const proc = spawn("ffmpeg", [
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
    await new Promise<void>((resolve, reject) => {
      proc.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exit ${code}`))));
      proc.on("error", reject);
    });
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
export class AudioAssembler {
  private cfg: Config;
  private sfxDir: string;
  private bgmDir: string;
  private ambienceDir: string;

  constructor(
    options: { cfg?: Config; sfxDir?: string; bgmDir?: string; ambienceDir?: string } = {}
  ) {
    this.cfg = options.cfg ?? loadConfig({ validateProvider: false });
    this.sfxDir = options.sfxDir ?? join(__dirname, "..", "..", "assets", "sfx");
    this.bgmDir = options.bgmDir ?? join(__dirname, "..", "..", "assets", "bgm");
    this.ambienceDir = options.ambienceDir ?? join(__dirname, "..", "..", "assets", "ambience");
  }

  /**
   * Generates all dialogue audio tracks for an episode, separates tracks into individual stems
   * (dialogue, sfx, ambience, bgm), mixes them into master soundtrack, and formats subtitles.
   */
  public async assembleEpisodeAudio(options: AssembleAudioOptions): Promise<AssembleAudioResult> {
    const { script, bible, outputDir, mockTts } = options;
    const audioDir = join(outputDir, "audio");
    const stemsDir = join(audioDir, "stems");
    await mkdir(stemsDir, { recursive: true });

    // ── STEP 1: Pre-Synthesize / Pre-Measure TTS Before Finalizing Timeline ───
    const measuredTtsDurations: MeasuredTtsDurations = {};
    const dialogueTracks: DialogueAudioResult[] = [];
    const synthesizedFilesByShotId = new Map<string, string[]>();

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
          const turnPath = join(audioDir, `dialogue-${turnId}.mp3`);
          const textToSpeak = dialogue.ttsText || dialogue.text;

          const mockShot: Shot = {
            shotId: shot.shotId,
            shotType: shot.shotType,
            durationSec: shot.durationSec,
            visualPrompt: shot.visualPrompt,
            dialogues: [dialogue],
            dialogue,
          };
          const { provider, voiceId } = resolveVoiceForDialogue(mockShot, bible, this.cfg);

          let measuredDur = 1.5;
          if (mockTts) {
            const words = textToSpeak.trim().split(/\s+/).length;
            measuredDur = Math.max(1.0, Math.round((words / 2.6) * 10) / 10);
            await createValidMockMp3File(turnPath, measuredDur);
          } else {
            if (provider === "lucylab") {
              const client = new LucylabClient({
                apiKey: this.cfg.lucylabApiKey || "mock-key",
                voiceId,
                endpoint: this.cfg.lucylabEndpoint || "https://api.lucylab.ai",
                pollIntervalMs: this.cfg.lucylabPollIntervalMs ?? 1000,
                pollTimeoutMs: this.cfg.lucylabPollTimeoutMs ?? 60000,
              });
              await client.generate(textToSpeak, turnPath);
            } else {
              const client = new ElevenLabsClient({
                apiKey: this.cfg.elevenlabsApiKey || "mock-key",
                voiceId,
                modelId: this.cfg.elevenlabsModelId || "eleven_multilingual_v2",
                endpoint: this.cfg.elevenlabsEndpoint || "https://api.elevenlabs.io/v1",
              });
              await client.generate(textToSpeak, turnPath);
            }

            try {
              measuredDur = await getDurationSec(turnPath);
            } catch {
              measuredDur = Math.max(1.0, textToSpeak.split(/\s+/).length / 2.6);
            }
          }

          measuredTtsDurations[turnId] = measuredDur;
          shotFiles.push(turnPath);

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
    const unifiedTimeline = TimelineScheduler.schedule(script, measuredTtsDurations, {
      fps: script.fps ?? 30,
      overflowPolicy: options.overflowPolicy ?? "extend_shot",
      transitionDurationSec: options.transitionDurationSec ?? 0.0,
      transitionType: options.transitionType ?? "cut",
    });

    // ── STEP 3: Assemble Stem 1 - Dialogue Track ──────────────────────────────
    const shotDialoguePaddedPaths: string[] = [];

    for (const vShot of unifiedTimeline.videoTrack) {
      const turnFiles = synthesizedFilesByShotId.get(vShot.shotId) || [];
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
          } catch {
            await createValidMockMp3File(shotCombinedPath, vShot.durationSec);
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
        await concatWithSilence(shotDialoguePaddedPaths, 0.0, stemDialoguePath);
      } catch {
        await createValidMockMp3File(stemDialoguePath, unifiedTimeline.targetTotalDurationSec);
      }
    } else {
      await createValidMockMp3File(stemDialoguePath, unifiedTimeline.targetTotalDurationSec);
    }

    // ── STEP 4: Assemble Stem 2 - SFX Track ───────────────────────────────────
    const stemSfxPath = join(stemsDir, "stem_sfx.mp3");
    const sfxList: SfxMixSpec[] = [];

    for (const cue of unifiedTimeline.sfxTrack) {
      const sfxPath = join(this.sfxDir, cue.name.endsWith(".mp3") ? cue.name : `${cue.name}.mp3`);
      if (existsSync(sfxPath)) {
        sfxList.push({
          path: sfxPath,
          startSec: cue.startSec,
          volume: cue.volume,
        });
        cue.audioPath = sfxPath;
      }
    }

    // Generate SFX stem
    await createValidMockMp3File(stemSfxPath, unifiedTimeline.targetTotalDurationSec);
    if (sfxList.length > 0 && !mockTts) {
      try {
        await mixSfxOntoVoice(stemSfxPath, sfxList, stemSfxPath);
      } catch {
        // keep silence stem
      }
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

    // Measure actual master audio duration
    let actualAudioDur = unifiedTimeline.targetTotalDurationSec;
    try {
      actualAudioDur = await getDurationSec(masterSoundtrackPath);
    } catch {
      actualAudioDur = unifiedTimeline.targetTotalDurationSec;
    }

    // ── STEP 8: Subtitle Export (SRT & WebVTT) ────────────────────────────────
    const srtPath = join(outputDir, "subtitles.srt");
    const vttPath = join(outputDir, "subtitles.vtt");
    const srtContent = exportToSrt(unifiedTimeline.subtitleTrack);
    const vttContent = exportToVtt(unifiedTimeline.subtitleTrack);
    await writeFile(srtPath, srtContent, "utf8");
    await writeFile(vttPath, vttContent, "utf8");

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
      },
    };
  }
}
