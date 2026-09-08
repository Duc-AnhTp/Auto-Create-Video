import { describe, it, expect, beforeEach } from "vitest";
import {
  AudioAssembler,
  resolveVoiceForDialogue,
} from "./audio-assembler.js";
import { BibleManager } from "../bible/bible-manager.js";
import type { EpisodicScript, Shot } from "./series-schema.js";

describe("AudioAssembler (Multi-Character Voice Routing & Soundtrack Assembly)", () => {
  let bible: BibleManager;

  beforeEach(() => {
    bible = new BibleManager(":memory:");
    bible.upsertCharacter({
      id: "char_minh",
      name: "Minh",
      role: "protagonist",
      visual_summary: "Thám tử Minh",
      personality_traits: ["lạnh lùng"],
      voice_profile_id: "elevenlabs:voice_minh_123",
      status: "alive",
    });

    bible.upsertCharacter({
      id: "char_an",
      name: "An",
      role: "supporting",
      visual_summary: "Hacker An",
      personality_traits: ["thông minh"],
      voice_profile_id: "lucylab:voice_an_456",
      status: "alive",
    });
  });

  it("resolves multi-character voice profiles correctly from Story Bible", () => {
    const mockCfg: any = {
      ttsProvider: "lucylab",
      lucylabVoiceId: "default_lucy",
      elevenlabsVoiceId: "default_eleven",
    };

    const shotMinh: Shot = {
      shotId: "sh01",
      durationSec: 4.0,
      visualPrompt: "Minh nói chuyện",
      dialogue: {
        characterId: "char_minh",
        speakerName: "Minh",
        text: "Xin chào",
        type: "speech",
      },
    };

    const resMinh = resolveVoiceForDialogue(shotMinh, bible, mockCfg);
    expect(resMinh.provider).toBe("elevenlabs");
    expect(resMinh.voiceId).toBe("voice_minh_123");

    const shotAn: Shot = {
      shotId: "sh02",
      durationSec: 3.0,
      visualPrompt: "An trả lời",
      dialogue: {
        characterId: "char_an",
        speakerName: "An",
        text: "Chào anh Minh",
        type: "speech",
      },
    };

    const resAn = resolveVoiceForDialogue(shotAn, bible, mockCfg);
    expect(resAn.provider).toBe("lucylab");
    expect(resAn.voiceId).toBe("voice_an_456");

    // Narrator
    const shotNarrator: Shot = {
      shotId: "sh03",
      durationSec: 4.0,
      visualPrompt: "Khung cảnh đêm",
      dialogue: {
        characterId: "narrator",
        speakerName: "Người dẫn chuyện",
        text: "Đêm đó trời đổ mưa.",
        type: "voiceover",
      },
    };

    const resNarrator = resolveVoiceForDialogue(shotNarrator, bible, mockCfg);
    expect(resNarrator.provider).toBe("lucylab");
    expect(resNarrator.voiceId).toBe("default_lucy");
  });

  it("assembles mock episode audio successfully without external API calls", async () => {
    const assembler = new AudioAssembler();
    const script: EpisodicScript = {
      version: "2.0",
      seriesId: "series_test",
      episodeNumber: 1,
      title: "Tập 1",
      logline: "Logline 1",
      aspectRatio: "9:16",
      scenes: [
        {
          sceneNumber: 1,
          locationId: "loc_bar",
          locationName: "Bar Hẻm 9",
          timeOfDay: "night",
          charactersPresent: [{ characterId: "char_minh" }],
          propsPresent: [],
          shots: [
            {
              shotId: "sc01_sh01",
              durationSec: 4.0,
              visualPrompt: "Minh đứng ở quầy bar",
              dialogue: {
                characterId: "char_minh",
                speakerName: "Minh",
                text: "Tôi cần thông tin.",
                type: "speech",
              },
            },
          ],
        },
      ],
    };

    const result = await assembler.assembleEpisodeAudio({
      script,
      bible,
      outputDir: "output/test-series-audio",
      mockTts: true,
    });

    expect(result.dialogueTracks.length).toBe(1);
    expect(result.dialogueTracks[0].shotId).toBe("sc01_sh01");
    expect(result.dialogueTracks[0].speakerName).toBe("Minh");
    expect(result.totalDurationSec).toBeGreaterThanOrEqual(1.5);
    expect(result.finalAudioPath).toContain("master-soundtrack.mp3");
  });
});
