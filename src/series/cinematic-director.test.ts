import { describe, it, expect } from "vitest";
import {
  CinematicDirectorEngine,
  FOLEY_ACTION_PATTERNS,
  type CinematicCoverageOptions,
} from "./cinematic-director.js";
import { BibleManager } from "../bible/bible-manager.js";
import { StoryToScreenplayGenerator } from "./story-to-screenplay.js";

describe("CinematicDirectorEngine (Giai Đoạn 1: Cinematic Directing & Audio Foley)", () => {
  it("generates a structured 5-shot coverage conforming to Hollywood cinema grammar", () => {
    const options: CinematicCoverageOptions = {
      sceneNumber: 1,
      locationName: "Quán bar Cyber Hẻm 9",
      timeOfDay: "night",
      mood: "căng thẳng và bí ẩn",
      characters: [
        { id: "char_minh", name: "Minh" },
        { id: "char_lan", name: "Lan" },
      ],
      dialogueLines: [
        { speakerId: "char_minh", speakerName: "Minh", text: "Chúng ta bị theo dõi rồi." },
        { speakerId: "char_lan", speakerName: "Lan", text: "Tôi biết, từ lúc bước vào hẻm." },
        { speakerId: "char_minh", speakerName: "Minh", text: "Chuẩn bị rời khỏi đây ngay." },
        { speakerId: "char_lan", speakerName: "Lan", text: "Chờ đã, còn tài liệu mật thì sao?" },
      ],
      assignedBeats: [
        { id: "beat_01", name: "Phát hiện bẫy", source_unit_id: "u1" } as any,
        { id: "beat_02", name: "Đối chất", source_unit_id: "u1" } as any,
        { id: "beat_03", name: "Quyết định hành động", source_unit_id: "u1" } as any,
      ],
    };

    const shots = CinematicDirectorEngine.generate5ShotCoverage(options);
    expect(shots.length).toBe(5);

    // 1. Establishing Shot
    expect(shots[0].shotType).toBe("establishing");
    expect(shots[0].cameraMovement).toBe("dolly_in_slow");
    expect(shots[0].visualPrompt).toContain("24mm");
    expect(shots[0].beatIds).toContain("beat_01");

    // 2. Two-Shot
    expect(shots[1].shotType).toBe("medium");
    expect(shots[1].visualPrompt).toContain("Two-Shot");
    expect(shots[1].visualPrompt).toContain("180 độ");
    expect(shots[1].dialogues.length).toBe(1);
    expect(shots[1].dialogues[0].text).toBe("Chúng ta bị theo dõi rồi.");

    // 3. OTS A -> B
    expect(shots[2].shotType).toBe("over_the_shoulder");
    expect(shots[2].characterId).toBe("char_lan");
    expect(shots[2].visualPrompt).toContain("Over-the-Shoulder");
    expect(shots[2].dialogues[0].text).toBe("Tôi biết, từ lúc bước vào hẻm.");

    // 4. OTS B -> A
    expect(shots[3].shotType).toBe("over_the_shoulder");
    expect(shots[3].characterId).toBe("char_minh");
    expect(shots[3].visualPrompt).toContain("Reverse Over-the-Shoulder");
    expect(shots[3].dialogues[0].text).toBe("Chuẩn bị rời khỏi đây ngay.");

    // 5. Intense Close-Up Climax
    expect(shots[4].shotType).toBe("close_up");
    expect(shots[4].cameraMovement).toBe("dolly_in_slow");
    expect(shots[4].visualPrompt).toContain("85mm");
    expect(shots[4].dialogues[0].text).toBe("Chờ đã, còn tài liệu mật thì sao?");
  });

  it("detects kinetic action keywords and maps them to authentic Foley cues", () => {
    // Footsteps
    const sfxFoot = CinematicDirectorEngine.detectActionFoley("Hắn bước chân vội vã tiến lại gần.");
    expect(sfxFoot).toBeDefined();
    expect(sfxFoot?.name).toBe("foley_footsteps_pacing");
    expect(sfxFoot?.volume).toBeGreaterThan(0.5);

    // Door slam
    const sfxDoor = CinematicDirectorEngine.detectActionFoley("Bất ngờ cánh cửa đóng sầm lại.");
    expect(sfxDoor?.name).toBe("foley_door_creak_slam");

    // Blade unsheathe
    const sfxBlade = CinematicDirectorEngine.detectActionFoley("Thanh kiếm được rút kiếm khỏi vỏ sáng loáng.");
    expect(sfxBlade?.name).toBe("foley_blade_unsheathe");

    // Gunshot
    const sfxGun = CinematicDirectorEngine.detectActionFoley("Một tiếng nổ súng chát chúa vang lên giữa đêm.");
    expect(sfxGun?.name).toBe("foley_gun_action_shot");

    // Glass shatter
    const sfxGlass = CinematicDirectorEngine.detectActionFoley("Chiếc cốc rơi xuống sàn và ly vỡ vụn.");
    expect(sfxGlass?.name).toBe("foley_glass_shatter");

    // Thunder rain
    const sfxRain = CinematicDirectorEngine.detectActionFoley("Ngoài trời tiếng mưa rào rạt và sấm sét.");
    expect(sfxRain?.name).toBe("ambience_thunder_rain");

    // Empty text returns undefined
    expect(CinematicDirectorEngine.detectActionFoley("")).toBeUndefined();
    expect(CinematicDirectorEngine.detectActionFoley("Một buổi chiều êm ả không có gì xảy ra")).toBeUndefined();
  });

  it("enforces 180-degree axis rule on OTS shots", () => {
    const rawShots: any[] = [
      {
        shotId: "s01_sh01",
        shotType: "over_the_shoulder",
        characterId: "char_a",
        visualPrompt: "Quay qua vai về phía nhân vật A.",
      },
      {
        shotId: "s01_sh02",
        shotType: "over_the_shoulder",
        characterId: "char_b",
        visualPrompt: "Quay qua vai về phía nhân vật B.",
      },
    ];

    const chars = [
      { id: "char_a", name: "Minh" },
      { id: "char_b", name: "Lan" },
    ];

    const guardedShots = CinematicDirectorEngine.enforce180DegreeAxis(rawShots, chars);
    expect(guardedShots[0].visualPrompt).toContain("Duy trì trục máy quay 180 độ nhất quán: nhân vật chính diện ở bên trái");
    expect(guardedShots[1].visualPrompt).toContain("Duy trì trục máy quay 180 độ nhất quán: nhân vật chính diện ở bên phải");
  });

  it("calculates spatial audio stereo pan based on character positions", () => {
    expect(CinematicDirectorEngine.calculateSpeakerAudioPan("char_a", "char_a", "char_b")).toBe(-0.25);
    expect(CinematicDirectorEngine.calculateSpeakerAudioPan("char_b", "char_a", "char_b")).toBe(0.25);
    expect(CinematicDirectorEngine.calculateSpeakerAudioPan("narrator", "char_a", "char_b")).toBe(0.0);
  });

  it("StoryToScreenplayGenerator supports cinematicCoverage option generating 5-shot coverage grammar", async () => {
    const bible = new BibleManager(":memory:", { allowMemoryFallback: true });
    bible.upsertSeriesMetadata({
      id: "series_cinematic",
      title: "Điệp Vụ Sài Gòn",
      visual_style: "Cinematic Neo-Noir",
    });
    bible.upsertCharacter({
      id: "char_minh",
      name: "Minh",
      series_id: "series_cinematic",
      role: "protagonist",
    });
    bible.upsertCharacter({
      id: "char_an",
      name: "An",
      series_id: "series_cinematic",
      role: "supporting",
    });

    const generator = new StoryToScreenplayGenerator(bible);
    const result = await generator.generateScreenplay({
      seriesId: "series_cinematic",
      storyText: 'Minh bước vào căn phòng tối. "Chúng ta không còn nhiều thời gian." An gật đầu.',
      cinematicCoverage: true,
      skipAudit: true,
    });

    expect(result.rawScreenplay).toContain("Two-Shot 35mm");
    expect(result.rawScreenplay).toContain("Over-the-Shoulder 50mm lens");
    expect(result.rawScreenplay).toContain("Reverse Over-the-Shoulder 50mm lens");
    expect(result.rawScreenplay).toContain("180 độ");
    expect(result.script.scenes.length).toBeGreaterThanOrEqual(1);
    expect(result.script.scenes[0].shots.length).toBe(5);
  });
});
