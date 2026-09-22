import type { Shot, Scene, ShotType, DialogueLine } from "./series-schema.js";
import type { StoryBeatRecord } from "../bible/bible-manager.js";

function makeDialogue(
  dialogueId: string,
  speakerName: string,
  characterId: string,
  text: string,
  actingInstruction?: string
): DialogueLine {
  return {
    dialogueId,
    characterId,
    speakerName,
    text,
    rawText: text,
    subtitleText: text,
    ttsText: text,
    type: "speech",
    actingInstruction,
    voiceProfileId: undefined,
    isUnresolved: false,
    durationSec: undefined,
  };
}

/**
 * Camera Motion Taxonomy for Hollywood & Cinematic AI Direction.
 */
export type CameraMovementType =
  | "static_locked_off"
  | "dolly_in_slow"
  | "dolly_out_slow"
  | "pan_horizontal"
  | "tracking_shot"
  | "orbit_360"
  | "tilt_up"
  | "tilt_down"
  | "handheld_subtle";

export interface CinematicCharacterPosition {
  characterId: string;
  name: string;
  screenSide: "left" | "right" | "center";
  audioPan: number; // -1.0 (hard left) to +1.0 (hard right)
}

export interface FoleySoundPattern {
  keywords: RegExp[];
  soundName: string;
  defaultVolume: number;
  relativeOffsetSec: number;
}

/**
 * Built-in Library of Narrative Action Verbs mapped to Foley Sound Effects.
 */
export const FOLEY_ACTION_PATTERNS: FoleySoundPattern[] = [
  {
    keywords: [/(?:bước chân|chạy|bước đi|tiến lại|dạo bước|footstep|running|walks|approaches)/i],
    soundName: "foley_footsteps_pacing",
    defaultVolume: 0.65,
    relativeOffsetSec: 0.2,
  },
  {
    keywords: [/(?:đóng sầm|mở cửa|tiếng cửa|khép cửa|cửa đóng|door slam|opens door|closes door)/i],
    soundName: "foley_door_creak_slam",
    defaultVolume: 0.75,
    relativeOffsetSec: 0.4,
  },
  {
    keywords: [/(?:rút kiếm|tiếng kim loại|vũ khí|tra kiếm|unsheathes|blade|sword clank)/i],
    soundName: "foley_blade_unsheathe",
    defaultVolume: 0.8,
    relativeOffsetSec: 0.3,
  },
  {
    keywords: [/(?:súng|tiếng đạn|bóp cò|nổ súng|gunshot|reloads|cocking gun)/i],
    soundName: "foley_gun_action_shot",
    defaultVolume: 0.85,
    relativeOffsetSec: 0.1,
  },
  {
    keywords: [/(?:ly vỡ|thủy tinh|đổ vỡ|rơi vỡ|glass shatter|breaking cup)/i],
    soundName: "foley_glass_shatter",
    defaultVolume: 0.8,
    relativeOffsetSec: 0.5,
  },
  {
    keywords: [/(?:tiếng mưa|mưa rơi|sấm sét|giông bão|rain falling|thunder crack)/i],
    soundName: "ambience_thunder_rain",
    defaultVolume: 0.6,
    relativeOffsetSec: 0.0,
  },
  {
    keywords: [/(?:thở dốc|tiếng thở|thở dài|nấc nghẹn|heavy breathing|sighs|gasps)/i],
    soundName: "foley_heavy_breath",
    defaultVolume: 0.55,
    relativeOffsetSec: 0.3,
  },
  {
    keywords: [/(?:đập bàn|va đập|nắm đấm|cú đấm|punch|body fall|slamming desk)/i],
    soundName: "foley_punch_impact",
    defaultVolume: 0.8,
    relativeOffsetSec: 0.2,
  },
  {
    keywords: [/(?:lật sách|trang giấy|bút viết|lật tài liệu|page turn|paper rustle)/i],
    soundName: "foley_paper_turn",
    defaultVolume: 0.5,
    relativeOffsetSec: 0.2,
  },
];

export interface CinematicCoverageOptions {
  sceneNumber: number;
  locationName: string;
  timeOfDay?: "day" | "night" | "golden_hour" | "dusk" | "dawn";
  mood?: string;
  leadCharacterId?: string;
  secondCharacterId?: string;
  characters?: Array<{ id: string; name: string }>;
  dialogueLines?: Array<{
    speakerId: string;
    speakerName: string;
    text: string;
    actingInstruction?: string;
  }>;
  assignedBeats?: StoryBeatRecord[];
}

/**
 * Cinematic Director Engine (Phân Hệ Đạo Diễn Điện Ảnh)
 *
 * Implements professional film directing principles:
 * - 5-shot Hollywood Coverage Grammar (Establishing, Two-Shot, OTS A->B, OTS B->A, Close-Up Reaction)
 * - 180-Degree Spatial Axis Rule preservation
 * - Camera Movement Taxonomy (dolly, tracking, pan, orbit, static)
 * - Automated Action-to-Foley sound detection
 * - Spatial Audio Panning coordinate assignment
 */
export class CinematicDirectorEngine {
  /**
   * Generates a 5-shot coverage sequence for a scene adhering to cinema grammar.
   */
  public static generate5ShotCoverage(
    options: CinematicCoverageOptions
  ): Shot[] {
    const chars = options.characters || [];
    const charA = chars[0] || { id: "char_a", name: "Nhân vật 1" };
    const charB = chars[1] || { id: "char_b", name: "Nhân vật 2" };

    const loc = options.locationName || "Không gian điện ảnh";
    const time = options.timeOfDay || "night";
    const mood = options.mood || "căng thẳng và kịch tính";
    const scenePrefix = `s${String(options.sceneNumber).padStart(2, "0")}`;

    // Establish 180-degree axis: Character A on Left (-0.3), Character B on Right (+0.3)
    const positions: Record<string, CinematicCharacterPosition> = {
      [charA.id]: {
        characterId: charA.id,
        name: charA.name,
        screenSide: "left",
        audioPan: -0.28,
      },
      [charB.id]: {
        characterId: charB.id,
        name: charB.name,
        screenSide: "right",
        audioPan: 0.28,
      },
    };

    const shots: Shot[] = [];
    const beats = options.assignedBeats || [];
    const b1Ids = beats[0] ? [beats[0].id] : [];
    const b2Ids = beats[1] ? [beats[1].id] : [];
    const b3Ids = beats[2] ? [beats[2].id] : [];

    // ── SHOT 1: Establishing / Wide Shot (24mm, Establishing Geography) ──────
    shots.push({
      shotId: `${scenePrefix}_sh01_establishing`,
      shotType: "establishing",
      durationSec: 4.5,
      cameraMovement: "dolly_in_slow",
      characterId: charA.id,
      beatIds: b1Ids,
      visualPrompt: `Góc đại toàn cảnh (Extreme Wide Shot 24mm anamorphic lens). Toàn cảnh ${loc} vào thời điểm ${time}. Ánh sáng điện ảnh tương phản cao, không khí ${mood}. ${charA.name} và ${charB.name} xuất hiện trong không gian, thiết lập mối tương quan khoảng cách.`,
      dialogues: [],
      sfxCue: this.detectActionFoley(`Mở màn không gian tại ${loc} lúc ${time}`) || {
        name: "ambience_room_tone",
        offsetSec: 0.0,
        volume: 0.4,
      },
    });

    // ── SHOT 2: Two-Shot (35mm, Relational Geography & Interaction) ─────────
    shots.push({
      shotId: `${scenePrefix}_sh02_twoshot`,
      shotType: "medium",
      durationSec: 4.0,
      cameraMovement: "tracking_shot",
      characterId: charA.id,
      beatIds: b1Ids,
      visualPrompt: `Góc trung cảnh đôi (Two-Shot 35mm). ${charA.name} đứng bên trái khung hình đối diện với ${charB.name} ở bên phải khung hình. Duy trì trục máy quay 180 độ. Cả hai duy trì ánh mắt thăm dò lẫn nhau trong bầu không khí ${mood}.`,
      dialogues: options.dialogueLines?.[0]
        ? [
            makeDialogue(
              `${scenePrefix}_sh02_d01`,
              options.dialogueLines[0].speakerName,
              options.dialogueLines[0].speakerId,
              options.dialogueLines[0].text,
              options.dialogueLines[0].actingInstruction
            ),
          ]
        : [],
      sfxCue: this.detectActionFoley(
        options.dialogueLines?.[0]?.text || "Bước chân tiến lại gần đối phương"
      ),
    });

    // ── SHOT 3: Over-The-Shoulder (OTS A -> B, 50mm, Focus on Char B) ────────
    shots.push({
      shotId: `${scenePrefix}_sh03_ots_a_to_b`,
      shotType: "over_the_shoulder",
      durationSec: 4.0,
      cameraMovement: "static_locked_off",
      characterId: charB.id,
      beatIds: b2Ids,
      visualPrompt: `Góc quay qua vai (Over-the-Shoulder 50mm lens). Máy quay đặt sau vai của ${charA.name} (out of focus ở tiền cảnh bên trái), lấy nét sắc sảo vào biểu cảm gương mặt ${charB.name} ở hậu cảnh bên phải. Ánh sáng nhấn vào khóe mắt và đường nét gương mặt.`,
      dialogues: options.dialogueLines?.[1]
        ? [
            makeDialogue(
              `${scenePrefix}_sh03_d01`,
              options.dialogueLines[1].speakerName,
              options.dialogueLines[1].speakerId,
              options.dialogueLines[1].text,
              options.dialogueLines[1].actingInstruction
            ),
          ]
        : [],
      sfxCue: this.detectActionFoley(options.dialogueLines?.[1]?.text || ""),
    });

    // ── SHOT 4: Over-The-Shoulder (OTS B -> A, 50mm, Focus on Char A) ────────
    shots.push({
      shotId: `${scenePrefix}_sh04_ots_b_to_a`,
      shotType: "over_the_shoulder",
      durationSec: 4.0,
      cameraMovement: "static_locked_off",
      characterId: charA.id,
      beatIds: b2Ids,
      visualPrompt: `Góc quay đảo trục đối ứng qua vai (Reverse Over-the-Shoulder 50mm lens). Máy quay đặt sau vai của ${charB.name} (tiền cảnh bên phải), lấy nét rõ nét vào ${charA.name} ở hậu cảnh bên trái. Tuyệt đối không nhảy trục 180 độ.`,
      dialogues: options.dialogueLines?.[2]
        ? [
            makeDialogue(
              `${scenePrefix}_sh04_d01`,
              options.dialogueLines[2].speakerName,
              options.dialogueLines[2].speakerId,
              options.dialogueLines[2].text,
              options.dialogueLines[2].actingInstruction
            ),
          ]
        : [],
      sfxCue: this.detectActionFoley(options.dialogueLines?.[2]?.text || ""),
    });

    // ── SHOT 5: Close-Up / Reaction Shot (85mm, Emotional Climax) ───────────
    shots.push({
      shotId: `${scenePrefix}_sh05_closeup_climax`,
      shotType: "close_up",
      durationSec: 3.5,
      cameraMovement: "dolly_in_slow",
      characterId: charA.id,
      beatIds: b3Ids,
      visualPrompt: `Góc cận cảnh đặc tả (Intense Close-Up 85mm portrait lens). Máy quay tiến sát gương mặt ${charA.name}, bắt trọn ánh mắt quyết liệt và phản ứng tâm lý cao trào. Độ sâu trường ảnh nông (shallow depth of field), hậu cảnh mờ nhòe điện ảnh (creamy bokeh).`,
      dialogues: options.dialogueLines?.[3]
        ? [
            makeDialogue(
              `${scenePrefix}_sh05_d01`,
              options.dialogueLines[3].speakerName,
              options.dialogueLines[3].speakerId,
              options.dialogueLines[3].text,
              options.dialogueLines[3].actingInstruction
            ),
          ]
        : [],
      sfxCue: this.detectActionFoley(
        options.dialogueLines?.[3]?.text || "Ánh mắt kiên quyết, tiếng thở dốc nghẹn ngào"
      ),
    });

    return shots;
  }

  /**
   * Scans text or visual descriptions to automatically detect kinetic action verbs
   * and maps them to an authentic Foley SFX cue.
   */
  public static detectActionFoley(text: string): { name: string; offsetSec: number; volume: number } | undefined {
    if (!text || text.trim().length === 0) return undefined;
    for (const pattern of FOLEY_ACTION_PATTERNS) {
      for (const kw of pattern.keywords) {
        if (kw.test(text)) {
          return {
            name: pattern.soundName,
            offsetSec: pattern.relativeOffsetSec,
            volume: pattern.defaultVolume,
          };
        }
      }
    }
    return undefined;
  }

  /**
   * Enforces 180-degree axis rule across an array of shots in a scene.
   * Ensures that character screen sides remain consistent across consecutive shots.
   */
  public static enforce180DegreeAxis(shots: Shot[], characters: Array<{ id: string; name: string }>): Shot[] {
    if (shots.length === 0 || characters.length < 2) return shots;
    const charAId = characters[0].id;
    const charBId = characters[1].id;

    return shots.map((shot) => {
      let prompt = shot.visualPrompt;
      if (shot.shotType === "over_the_shoulder") {
        if (shot.characterId === charAId) {
          // A is in focus (left of frame), B is shoulder foreground (right)
          if (!prompt.includes("trục") && !prompt.includes("180")) {
            prompt += " Duy trì trục máy quay 180 độ nhất quán: nhân vật chính diện ở bên trái, vai tiền cảnh ở bên phải.";
          }
        } else if (shot.characterId === charBId) {
          // B is in focus (right of frame), A is shoulder foreground (left)
          if (!prompt.includes("trục") && !prompt.includes("180")) {
            prompt += " Duy trì trục máy quay 180 độ nhất quán: nhân vật chính diện ở bên phải, vai tiền cảnh ở bên trái.";
          }
        }
      }
      return {
        ...shot,
        visualPrompt: prompt,
      };
    });
  }

  /**
   * Computes spatial audio stereo pan (-1.0 to +1.0) based on speaker ID and scene positioning.
   */
  public static calculateSpeakerAudioPan(
    speakerCharacterId: string,
    leadCharacterId?: string,
    secondCharacterId?: string
  ): number {
    if (!speakerCharacterId) return 0.0;
    if (speakerCharacterId === leadCharacterId) {
      return -0.25; // Subtle left panning
    }
    if (speakerCharacterId === secondCharacterId) {
      return 0.25; // Subtle right panning
    }
    return 0.0; // Center
  }
}
