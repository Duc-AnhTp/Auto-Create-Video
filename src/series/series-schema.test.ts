import { describe, it, expect } from "vitest";
import {
  SeriesConfigSchema,
  EpisodicScriptSchema,
  NarrativeDeltaSchema,
  type EpisodicScript,
} from "./series-schema.js";

describe("Series & Episodic Script Schemas", () => {
  it("validates a complete series configuration", () => {
    const validSeries = {
      id: "cyber-saigon-2088",
      title: "Cyber Saigon 2088",
      genre: "Cyber-noir Sci-fi",
      visualStyle: "Cinematic 35mm, dark cyber-noir, teal and amber lighting, anamorphic lens flare",
      aspectRatio: "9:16",
      fps: 30,
    };

    const parsed = SeriesConfigSchema.parse(validSeries);
    expect(parsed.id).toBe("cyber-saigon-2088");
    expect(parsed.aspectRatio).toBe("9:16");
  });

  it("validates a structured episodic film script with scenes and shots", () => {
    const validScript = {
      version: "2.0",
      seriesId: "cyber-saigon-2088",
      episodeNumber: 1,
      title: "Bóng Đêm Hẻm Số 9",
      logline: "Thám tử Minh lần theo dấu vết con chip lượng tử bị đánh cắp tại khu ổ chuột Hẻm Số 9.",
      aspectRatio: "9:16",
      bgm: "cyber_suspense",
      scenes: [
        {
          sceneNumber: 1,
          locationId: "loc_bar_hem_9",
          locationName: "Quán Bar Hẻm 9",
          timeOfDay: "night",
          charactersPresent: [{ characterId: "char_minh", wardrobeId: "w_coat" }],
          propsPresent: ["prop_chip"],
          shots: [
            {
              shotId: "sc01_sh01",
              shotType: "establishing",
              durationSec: 4.0,
              visualPrompt: "Quán bar ngầm u tối dưới mưa neon, Thám tử Minh bước vào",
              characterId: "char_minh",
              dialogue: {
                characterId: "narrator",
                speakerName: "Người dẫn chuyện",
                text: "Đêm đó, mưa axit phủ kín Sài Gòn.",
                type: "voiceover",
              },
            },
            {
              shotId: "sc01_sh02",
              shotType: "close_up",
              durationSec: 3.5,
              visualPrompt: "Minh ngồi xuống quầy bar, ánh mắt sắc lẹm nhìn người pha chế",
              characterId: "char_minh",
              referenceImage: "assets/characters/minh.jpg",
              dialogue: {
                characterId: "char_minh",
                speakerName: "Minh",
                text: "Cho tôi một ly whisky và thông tin về con chip.",
                type: "speech",
              },
            },
          ],
        },
      ],
    };

    const parsed = EpisodicScriptSchema.parse(validScript);
    expect(parsed.episodeNumber).toBe(1);
    expect(parsed.scenes[0].shots.length).toBe(2);
    expect(parsed.scenes[0].shots[1].dialogue?.text).toContain("whisky");
  });

  it("validates narrative deltas", () => {
    const delta = {
      characterStatusUpdates: [
        { id: "char_minh", status: "injured", distinguishingMarks: "Vết chém dài ở cẳng tay phải" },
      ],
      wardrobeUpdates: [{ characterId: "char_minh", wardrobeId: "w_combat_damaged" }],
      propUpdates: [{ propId: "prop_chip", newHolderId: "char_an", status: "intact" }],
      newKnowledge: [{ characterId: "char_minh", factKey: "knows_an_identity" }],
      majorEvents: ["Minh bị tập kích tại Hẻm 9", "Minh chuyển giao con chip cho An"],
    };

    const parsed = NarrativeDeltaSchema.parse(delta);
    expect(parsed.characterStatusUpdates?.[0].status).toBe("injured");
    expect(parsed.propUpdates?.[0].newHolderId).toBe("char_an");
  });
});
