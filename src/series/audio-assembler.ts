import { mkdir, writeFile, copyFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { EpisodicScript, Shot } from "./series-schema.js";
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

const __dirname = dirname(fileURLToPath(import.meta.url));

export interface DialogueAudioResult {
  shotId: string;
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
  sfxDir?: string;
  bgmDir?: string;
  cfg?: Config;
}

export interface AssembleAudioResult {
  dialogueTracks: DialogueAudioResult[];
  voiceOnlyPath: string;
  finalAudioPath: string;
  totalDurationSec: number;
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
      voiceId: defaultCfg.ttsProvider === "lucylab" ? defaultCfg.lucylabVoiceId! : defaultCfg.elevenlabsVoiceId!,
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
  return {
    provider: defaultCfg.ttsProvider,
    voiceId: defaultCfg.ttsProvider === "lucylab" ? (defaultCfg.lucylabVoiceId || "default-voice") : (defaultCfg.elevenlabsVoiceId || "default-voice"),
  };
}

/**
 * Multi-Character Audio Assembler for Episodic AI Series.
 */
export class AudioAssembler {
  private cfg: Config;
  private sfxDir: string;
  private bgmDir: string;

  constructor(options: { cfg?: Config; sfxDir?: string; bgmDir?: string } = {}) {
    this.cfg = options.cfg ?? loadConfig({ validateProvider: false });
    this.sfxDir = options.sfxDir ?? join(__dirname, "..", "..", "assets", "sfx");
    this.bgmDir = options.bgmDir ?? join(__dirname, "..", "..", "assets", "bgm");
  }

  /**
   * Generates all dialogue audio tracks for an episode and mixes them with SFX and BGM.
   */
  public async assembleEpisodeAudio(options: AssembleAudioOptions): Promise<AssembleAudioResult> {
    const { script, bible, outputDir, mockTts } = options;
    const audioDir = join(outputDir, "audio");
    await mkdir(audioDir, { recursive: true });

    const dialogueTracks: DialogueAudioResult[] = [];
    const voicePaths: string[] = [];

    // 1. Generate dialogue audio per shot that contains speech
    for (const scene of script.scenes) {
      for (const shot of scene.shots) {
        if (!shot.dialogue || !shot.dialogue.text.trim()) continue;

        const outPath = join(audioDir, `dialogue-${shot.shotId}.mp3`);
        const { provider, voiceId } = resolveVoiceForDialogue(shot, bible, this.cfg);

        if (mockTts) {
          // In mock mode, write a dummy mp3 header or mock file
          const words = shot.dialogue.text.trim().split(/\s+/).length;
          const estimatedDur = Math.max(1.5, Math.round((words / 2.6) * 10) / 10);
          await writeFile(outPath, Buffer.from(`MOCK_AUDIO_DUR_${estimatedDur}`));
          dialogueTracks.push({
            shotId: shot.shotId,
            speakerName: shot.dialogue.speakerName,
            characterId: shot.dialogue.characterId,
            text: shot.dialogue.text,
            audioPath: outPath,
            durationSec: estimatedDur,
          });
          voicePaths.push(outPath);
          continue;
        }

        // Real TTS synthesis
        if (provider === "lucylab") {
          const client = new LucylabClient({
            apiKey: this.cfg.lucylabApiKey || "mock-key",
            voiceId,
            endpoint: this.cfg.lucylabEndpoint,
          });
          await client.generate(shot.dialogue.text, outPath);
        } else {
          const client = new ElevenLabsClient({
            apiKey: this.cfg.elevenlabsApiKey || "mock-key",
            voiceId,
            endpoint: this.cfg.elevenlabsEndpoint,
          });
          await client.generate(shot.dialogue.text, outPath);
        }

        let dur = 3.0;
        try {
          dur = await getDurationSec(outPath);
        } catch {
          // If ffprobe is unavailable, estimate from word count
          dur = Math.max(1.5, (shot.dialogue.text.split(/\s+/).length / 2.6));
        }

        dialogueTracks.push({
          shotId: shot.shotId,
          speakerName: shot.dialogue.speakerName,
          characterId: shot.dialogue.characterId,
          text: shot.dialogue.text,
          audioPath: outPath,
          durationSec: dur,
        });
        voicePaths.push(outPath);
      }
    }

    const voiceOnlyPath = join(audioDir, "voice-combined.mp3");
    let totalDurationSec = 0;

    if (voicePaths.length > 0 && !mockTts) {
      try {
        await concatWithSilence(voicePaths, 0.4, voiceOnlyPath);
        totalDurationSec = await getDurationSec(voiceOnlyPath);
      } catch {
        // Fallback
        totalDurationSec = dialogueTracks.reduce((acc, d) => acc + d.durationSec + 0.4, 0);
      }
    } else {
      totalDurationSec = dialogueTracks.reduce((acc, d) => acc + d.durationSec + 0.4, 5.0);
      await writeFile(voiceOnlyPath, Buffer.from(`MOCK_VOICE_COMBINED_${totalDurationSec}`));
    }

    // 2. Mix SFX cues
    const voiceWithSfxPath = join(audioDir, "voice-sfx.mp3");
    const sfxList: SfxMixSpec[] = [];
    let timelineCursor = 0;

    for (const scene of script.scenes) {
      for (const shot of scene.shots) {
        if (shot.sfxCue) {
          const sfxPath = join(this.sfxDir, shot.sfxCue.name.endsWith(".mp3") ? shot.sfxCue.name : `${shot.sfxCue.name}.mp3`);
          if (existsSync(sfxPath)) {
            sfxList.push({
              path: sfxPath,
              startSec: timelineCursor + (shot.sfxCue.offsetSec || 0),
              volume: shot.sfxCue.volume || 0.7,
            });
          }
        }
        timelineCursor += shot.durationSec;
      }
    }

    if (sfxList.length > 0 && !mockTts) {
      try {
        await mixSfxOntoVoice(voiceOnlyPath, sfxList, voiceWithSfxPath);
      } catch {
        await copyFile(voiceOnlyPath, voiceWithSfxPath);
      }
    } else {
      await copyFile(voiceOnlyPath, voiceWithSfxPath);
    }

    // 3. Mix Background Music (BGM) with Auto-Ducking
    const finalAudioPath = join(audioDir, "master-soundtrack.mp3");
    const bgmCandidate = script.bgm;

    if (bgmCandidate && bgmCandidate !== "none" && !mockTts) {
      let resolvedBgmPath: string | null = null;
      const direct = resolve(outputDir, bgmCandidate);
      const inBgmDir = join(this.bgmDir, bgmCandidate.endsWith(".mp3") ? bgmCandidate : `${bgmCandidate}.mp3`);

      if (existsSync(direct)) resolvedBgmPath = direct;
      else if (existsSync(inBgmDir)) resolvedBgmPath = inBgmDir;
      else if (existsSync(bgmCandidate)) resolvedBgmPath = bgmCandidate;

      if (resolvedBgmPath) {
        try {
          await mixBgmWithDucking(voiceWithSfxPath, resolvedBgmPath, finalAudioPath);
        } catch {
          await copyFile(voiceWithSfxPath, finalAudioPath);
        }
      } else {
        await copyFile(voiceWithSfxPath, finalAudioPath);
      }
    } else {
      await copyFile(voiceWithSfxPath, finalAudioPath);
    }

    return {
      dialogueTracks,
      voiceOnlyPath,
      finalAudioPath,
      totalDurationSec,
    };
  }
}
