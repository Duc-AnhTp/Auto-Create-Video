import {
  EpisodicScriptSchema,
  type EpisodicScript,
  type Scene,
  type Shot,
  type ShotType,
  type DialogueLine,
  validateScriptIntegrity,
  ScriptIntegrityError,
  migrateScriptToLatest,
} from "./series-schema.js";
import { BibleManager } from "../bible/bible-manager.js";
import { normalizeVietnameseForTts } from "../tts/vietnamese-normalizer.js";

export class ContinuityError extends Error {
  public contradictions: any[];
  constructor(message: string, contradictions: any[]) {
    super(message);
    this.name = "ContinuityError";
    this.contradictions = contradictions;
  }
}

export class ScreenplayParseError extends Error {
  public line: number;
  public column: number;
  public snippet: string;
  public fixHint: string;

  constructor(message: string, line: number, column = 1, snippet = "", fixHint = "") {
    const formatted = `[Lỗi Kịch Bản Dòng ${line}:${column}] ${message}${
      snippet ? `\n  Dòng lỗi: "${snippet}"` : ""
    }${fixHint ? `\n  Gợi ý khắc phục: ${fixHint}` : ""}`;
    super(formatted);
    this.name = "ScreenplayParseError";
    this.line = line;
    this.column = column;
    this.snippet = snippet;
    this.fixHint = fixHint;
  }
}

export interface IntermediateDialogue {
  dialogueId?: string;
  speaker: string;
  text: string;
  rawText?: string;
  subtitleText?: string;
  ttsText?: string;
  actingInstruction?: string;
  type?: "speech" | "voiceover";
}

export interface IntermediateShot {
  shotId: string;
  shotType?: ShotType;
  durationSec: number;
  visualPrompt: string;
  characterName?: string;
  dialogues: IntermediateDialogue[];
  dialogue?: IntermediateDialogue; // backward compatibility
  cameraMovement?: string;
  sfxCue?: {
    name: string;
    offsetSec?: number;
    volume?: number;
  };
}

export interface IntermediateScene {
  sceneId?: string;
  sceneNumber: number;
  locationHeader: string;
  timeOfDay?: "day" | "night" | "golden_hour" | "dusk" | "dawn";
  charactersMentioned?: string[];
  propsMentioned?: string[];
  shots: IntermediateShot[];
}

export interface IntermediateScript {
  schemaVersion?: string;
  title: string;
  episodeNumber: number;
  logline: string;
  bgm?: string;
  unresolvedCharacters?: string[];
  scenes: IntermediateScene[];
}

const NON_SPEAKER_PREFIXES = new Set([
  "HÀNH ĐỘNG",
  "GHI CHÚ",
  "MÔ TẢ",
  "CẢNH",
  "CÚ MÁY",
  "SHOT",
  "BỐI CẢNH",
  "NHÂN VẬT",
  "ĐẠO CỤ",
  "SFX",
  "BGM",
  "ACTION",
  "NOTE",
  "SCENE",
  "CAMERA",
  "VISUAL",
  "PROMPT",
  "EFFECT",
  "ÁNH SÁNG",
  "LIGHTING",
  "DIRECTIONS",
  "LOGLINE",
  "TÓM TẮT",
  "TIÊU ĐỀ",
  "TITLE",
  "TẬP",
  "EPISODE",
]);

/**
 * Parses free-form text screenplay or JSON into IntermediateScript structure.
 * Throws ScreenplayParseError with line number and snippet on invalid input.
 */
export function parseRawScreenplay(rawText: string, defaultEpisode = 1): IntermediateScript {
  const trimmed = rawText.trim();
  if (!trimmed) {
    throw new ScreenplayParseError(
      "Kịch bản rỗng. Vui lòng cung cấp nội dung kịch bản văn bản hoặc JSON.",
      1,
      1,
      "",
      "Thêm tiêu đề tập phim 'TẬP 1: ...' và các phân cảnh 'CẢNH 1: ...'."
    );
  }

  // 1. JSON handling (round-trip or structured input)
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed.scenes && Array.isArray(parsed.scenes)) {
        return {
          schemaVersion: parsed.schemaVersion || "3.0",
          title: parsed.title || "Tập Phim Mới",
          episodeNumber: parsed.episodeNumber ?? defaultEpisode,
          logline: parsed.logline || parsed.title || "",
          bgm: parsed.bgm,
          unresolvedCharacters: parsed.unresolvedCharacters || [],
          scenes: parsed.scenes.map((s: any, idx: number) => {
            const sceneNum = s.sceneNumber ?? idx + 1;
            const sceneId = s.sceneId || `sc${String(sceneNum).padStart(2, "0")}`;
            return {
              sceneId,
              sceneNumber: sceneNum,
              locationHeader: s.locationName || s.locationHeader || s.locationId || `Cảnh ${sceneNum}`,
              timeOfDay: s.timeOfDay || "night",
              charactersMentioned: s.charactersMentioned || s.charactersPresent?.map((c: any) => c.characterId || c),
              propsMentioned: s.propsMentioned || s.propsPresent,
              shots: (s.shots || []).map((sh: any, shIdx: number) => {
                const shotId = sh.shotId || `${sceneId}_sh${String(shIdx + 1).padStart(2, "0")}`;
                const dialogues: IntermediateDialogue[] = [];

                // Handle multi-dialogue array
                if (Array.isArray(sh.dialogues) && sh.dialogues.length > 0) {
                  for (let dIdx = 0; dIdx < sh.dialogues.length; dIdx++) {
                    const d = sh.dialogues[dIdx];
                    dialogues.push({
                      dialogueId: d.dialogueId || `${shotId}_d${String(dIdx + 1).padStart(2, "0")}`,
                      speaker: d.speakerName || d.speaker || d.characterId || "Người dẫn chuyện",
                      text: d.text || "",
                      rawText: d.rawText || d.text || "",
                      subtitleText: d.subtitleText || d.text || "",
                      ttsText: d.ttsText || d.text || "",
                      actingInstruction: d.actingInstruction,
                      type: d.type || "speech",
                    });
                  }
                } else if (sh.dialogue) {
                  // Legacy single dialogue
                  dialogues.push({
                    dialogueId: sh.dialogue.dialogueId || `${shotId}_d01`,
                    speaker: sh.dialogue.speakerName || sh.dialogue.speaker || sh.dialogue.characterId || "Người dẫn chuyện",
                    text: sh.dialogue.text || "",
                    rawText: sh.dialogue.rawText || sh.dialogue.text || "",
                    subtitleText: sh.dialogue.subtitleText || sh.dialogue.text || "",
                    ttsText: sh.dialogue.ttsText || sh.dialogue.text || "",
                    actingInstruction: sh.dialogue.actingInstruction,
                    type: sh.dialogue.type || "speech",
                  });
                }

                return {
                  shotId,
                  shotType: sh.shotType || "medium",
                  durationSec: sh.durationSec || 4.0,
                  visualPrompt: sh.visualPrompt || "",
                  characterName: sh.characterName || sh.characterId,
                  dialogues,
                  dialogue: dialogues[0],
                  cameraMovement: sh.cameraMovement,
                  sfxCue: sh.sfxCue,
                };
              }),
            };
          }),
        };
      }
    } catch (jsonErr: any) {
      // If it looked like JSON but had syntax errors, throw descriptive error
      if (trimmed.startsWith("{") && trimmed.includes('"scenes"')) {
        throw new ScreenplayParseError(
          `Cú pháp JSON kịch bản không hợp lệ: ${jsonErr.message}`,
          1,
          1,
          trimmed.slice(0, 80),
          "Kiểm tra lại dấu đóng mở ngoặc hoặc cú pháp JSON."
        );
      }
    }
  }

  // 2. Parse text screenplay format
  let title = "Tập Phim Mới";
  let episodeNumber = defaultEpisode;
  let logline = "";
  let bgm: string | undefined;

  const lines = rawText.split(/\r?\n/);
  const scenes: IntermediateScene[] = [];
  let currentScene: IntermediateScene | null = null;
  let currentShot: IntermediateShot | null = null;
  let lineCount = 0;

  const resolveShotType = (raw: string): ShotType => {
    const s = raw.toLowerCase();
    if (s.includes("establishing") || s.includes("thiết lập")) return "establishing";
    if (s.includes("extreme") || s.includes("đại cận")) return "extreme_close_up";
    if (s.includes("close") || s.includes("cận")) return "close_up";
    if (s.includes("wide") || s.includes("toàn")) return "wide";
    if (s.includes("action") || s.includes("hành động")) return "action";
    if (s.includes("over_the_shoulder") || s.includes("qua vai") || s.includes("sau vai")) return "over_the_shoulder";
    if (s.includes("pov") || s.includes("góc nhìn")) return "pov";
    return "medium";
  };

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    const line = rawLine.trim();
    lineCount = i + 1;

    if (!line || line.startsWith("#") || line.startsWith("//")) continue;

    // Episode & Title Header: TẬP 1: BẢN HỢP ĐỒNG BÓNG ĐÊM (PILOT) or EPISODE 1: ...
    const epAndTitleMatch = line.match(/^(?:TẬP|EPISODE)\s*(\d+)\s*(?:[:\-]\s*(.+))?$/i);
    if (epAndTitleMatch) {
      episodeNumber = parseInt(epAndTitleMatch[1], 10);
      if (epAndTitleMatch[2]?.trim()) {
        title = epAndTitleMatch[2].trim();
      }
      continue;
    }

    const titleMatch = line.match(/^(?:TIÊU ĐỀ|TITLE)\s*:\s*(.+)$/i);
    if (titleMatch) {
      title = titleMatch[1].trim();
      continue;
    }

    const epMatch = line.match(/^(?:TẬP|EPISODE)\s*:\s*(\d+)/i);
    if (epMatch) {
      episodeNumber = parseInt(epMatch[1], 10);
      continue;
    }

    const loglineMatch = line.match(/^(?:TÓM TẮT|LOGLINE)\s*:\s*(.+)$/i);
    if (loglineMatch) {
      logline = loglineMatch[1].trim();
      continue;
    }

    const bgmMatch = line.match(/^(?:BGM|NHẠC NỀN)\s*:\s*(.+)$/i);
    if (bgmMatch) {
      bgm = bgmMatch[1].trim();
      continue;
    }

    // Scene header: CẢNH 1: QUÁN BAR HẺM 9 - ĐÊM or SCENE 1: ...
    const sceneMatch = line.match(/^(?:CẢNH|SCENE)\s*(\d+)\s*:\s*(.+)$/i);
    if (sceneMatch) {
      if (currentShot && currentScene) {
        currentScene.shots.push(currentShot);
        currentShot = null;
      }
      if (currentScene) {
        scenes.push(currentScene);
      }
      const sceneNum = parseInt(sceneMatch[1], 10);
      const locHeader = sceneMatch[2].trim();
      const isDay = locHeader.toLowerCase().includes("ngày") || locHeader.toLowerCase().includes("day");
      const sceneId = `sc${String(sceneNum).padStart(2, "0")}`;
      currentScene = {
        sceneId,
        sceneNumber: sceneNum,
        locationHeader: locHeader,
        timeOfDay: isDay ? "day" : "night",
        charactersMentioned: [],
        propsMentioned: [],
        shots: [],
      };
      continue;
    }

    // Scene metadata lines
    const charsMatch = line.match(/^(?:NHÂN VẬT|CHARACTERS)\s*:\s*(.+)$/i);
    if (charsMatch) {
      if (!currentScene) {
        throw new ScreenplayParseError(
          "Khai báo 'Nhân vật:' xuất hiện ngoài phân cảnh nào.",
          lineCount,
          1,
          line,
          "Khai báo 'CẢNH <số>: <BỐI CẢNH>' trước khi liệt kê nhân vật."
        );
      }
      currentScene.charactersMentioned = charsMatch[1].split(/[,;]/).map((s) => s.trim()).filter(Boolean);
      continue;
    }

    const propsMatch = line.match(/^(?:ĐẠO CỤ|PROPS)\s*:\s*(.+)$/i);
    if (propsMatch) {
      if (!currentScene) {
        throw new ScreenplayParseError(
          "Khai báo 'Đạo cụ:' xuất hiện ngoài phân cảnh nào.",
          lineCount,
          1,
          line,
          "Khai báo 'CẢNH <số>: <BỐI CẢNH>' trước khi liệt kê đạo cụ."
        );
      }
      currentScene.propsMentioned = propsMatch[1].split(/[,;]/).map((s) => s.trim()).filter(Boolean);
      continue;
    }

    // Shot header: CÚ MÁY 1 (establishing, 4s): ... or SHOT 1: ... or [SHOT 1: TOÀN CẢNH]
    const shotMatch = line.match(/^(?:\[?\s*(?:SHOT|CÚ\s+MÁY)\s*(\d+)(?:\s*\(([^)]*)\))?(?:\s*:\s*([^\]\r\n]+))?\]?)/i);
    if (shotMatch) {
      if (!currentScene) {
        throw new ScreenplayParseError(
          "Cú máy xuất hiện trước khi khai báo phân cảnh đầu tiên.",
          lineCount,
          1,
          line,
          "Thêm 'CẢNH 1: <TÊN BỐI CẢNH> - <THỜI ĐIỂM>' trước cú máy."
        );
      }
      if (currentShot) {
        currentScene.shots.push(currentShot);
      }
      const shotNum = parseInt(shotMatch[1], 10);
      const parenText = (shotMatch[2] || "").trim();
      const afterColon = (shotMatch[3] || "").trim();

      let shotType: ShotType = "medium";
      let durationSec = 4.0;
      let initialVisualPrompt = "";

      if (parenText) {
        shotType = resolveShotType(parenText);
        const durMatch = parenText.match(/([\d.]+)\s*(?:s|giây)?/i);
        if (durMatch) {
          durationSec = parseFloat(durMatch[1]);
          if (isNaN(durationSec) || durationSec <= 0) {
            throw new ScreenplayParseError(
              `Thời lượng cú máy không hợp lệ: '${durMatch[1]}'.`,
              lineCount,
              1,
              line,
              "Thời lượng phải là số dương (ví dụ: '4s', '5.5s')."
            );
          }
        }
      }

      if (afterColon) {
        const isPureTypeLabel =
          afterColon.split(/\s+/).length <= 3 &&
          (resolveShotType(afterColon) !== "medium" ||
            afterColon.toLowerCase().includes("medium") ||
            afterColon.toLowerCase().includes("trung"));
        if (isPureTypeLabel && !parenText) {
          shotType = resolveShotType(afterColon);
        } else {
          initialVisualPrompt = afterColon;
        }
      }

      const shotId = `${currentScene.sceneId}_sh${String(shotNum).padStart(2, "0")}`;
      currentShot = {
        shotId,
        shotType,
        durationSec,
        visualPrompt: initialVisualPrompt,
        dialogues: [],
      };
      continue;
    }

    // If we reach here and have no active scene or shot:
    if (!currentScene) {
      throw new ScreenplayParseError(
        `Nội dung kịch bản '${line.slice(0, 40)}' không nằm trong bất kỳ phân cảnh nào.`,
        lineCount,
        1,
        line,
        "Đảm bảo mở đầu kịch bản với 'CẢNH 1: <TÊN BỐI CẢNH> - <THỜI ĐIỂM>'."
      );
    }

    if (!currentShot) {
      throw new ScreenplayParseError(
        `Dòng nội dung '${line.slice(0, 40)}' nằm ngoài cú máy. Mọi hành động hoặc lời thoại phải thuộc một CÚ MÁY.`,
        lineCount,
        1,
        line,
        "Thêm 'CÚ MÁY <số> (<loại>, <thời lượng>s): <mô tả>' trước nội dung này."
      );
    }

    // Shot metadata fields
    const durMatch = line.match(/^(?:THỜI LƯỢNG|DURATION)\s*:\s*([\d.]+)\s*s?/i);
    if (durMatch) {
      const parsedDur = parseFloat(durMatch[1]);
      if (!isNaN(parsedDur) && parsedDur > 0) {
        currentShot.durationSec = parsedDur;
      }
      continue;
    }

    const visualMatch = line.match(/^(?:HÌNH ẢNH|VISUAL|PROMPT)\s*:\s*(.+)$/i);
    if (visualMatch) {
      currentShot.visualPrompt = visualMatch[1].trim();
      continue;
    }

    const cameraMatch = line.match(/^(?:MÁY QUAY|CAMERA)\s*:\s*(.+)$/i);
    if (cameraMatch) {
      currentShot.cameraMovement = cameraMatch[1].trim();
      continue;
    }

    const charInShotMatch = line.match(/^(?:NHÂN VẬT CHÍNH|FOCUS CHARACTER)\s*:\s*(.+)$/i);
    if (charInShotMatch) {
      currentShot.characterName = charInShotMatch[1].trim();
      continue;
    }

    const sfxMatch = line.match(/^(?:SFX|ÂM THANH)\s*:\s*(.+)$/i);
    if (sfxMatch) {
      currentShot.sfxCue = { name: sfxMatch[1].trim(), offsetSec: 0, volume: 0.7 };
      continue;
    }

    // ── Dialogue Parsing: Support Multiple Turns & Acting Instructions ──────────
    // Form 1: VOICEOVER / DẪN CHUYỆN: text
    const voMatch = line.match(/^(?:DẪN CHUYỆN|VOICEOVER|NGƯỜI DẪN CHUYỆN)\s*:\s*(.+)$/i);
    if (voMatch) {
      let rawText = voMatch[1].trim();
      let cleanText = rawText;
      if ((cleanText.startsWith('"') && cleanText.endsWith('"')) || (cleanText.startsWith("'") && cleanText.endsWith("'"))) {
        cleanText = cleanText.slice(1, -1).trim();
      }
      const dId = `${currentShot.shotId}_d${String(currentShot.dialogues.length + 1).padStart(2, "0")}`;
      const diagItem: IntermediateDialogue = {
        dialogueId: dId,
        speaker: "Người dẫn chuyện",
        text: cleanText,
        rawText: line,
        subtitleText: cleanText,
        type: "voiceover",
      };
      currentShot.dialogues.push(diagItem);
      if (!currentShot.dialogue) {
        currentShot.dialogue = diagItem;
      }
      continue;
    }

    // Form 2: Explicit prefix: THOẠI: SPEAKER (instruction): "text"
    const explicitThoaiMatch = line.match(/^THOẠI\s*:\s*(?:([A-ZÀ-Ỹa-zà-ỹ0-9_\s]+)(?:\s*\(([^)]*)\))?\s*:\s*)?(.+)$/i);
    if (explicitThoaiMatch) {
      const speaker = (explicitThoaiMatch[1] || currentShot.characterName || "Nhân vật").trim();
      const instruction = explicitThoaiMatch[2]?.trim();
      let cleanText = explicitThoaiMatch[3].trim();
      if ((cleanText.startsWith('"') && cleanText.endsWith('"')) || (cleanText.startsWith("'") && cleanText.endsWith("'"))) {
        cleanText = cleanText.slice(1, -1).trim();
      }
      const dId = `${currentShot.shotId}_d${String(currentShot.dialogues.length + 1).padStart(2, "0")}`;
      const diagItem: IntermediateDialogue = {
        dialogueId: dId,
        speaker,
        text: cleanText,
        rawText: line,
        subtitleText: cleanText,
        actingInstruction: instruction,
        type: "speech",
      };
      currentShot.dialogues.push(diagItem);
      if (!currentShot.dialogue) {
        currentShot.dialogue = diagItem;
      }
      if (!currentShot.characterName) {
        currentShot.characterName = speaker;
      }
      continue;
    }

    // Form 3: SPEAKER (acting instruction): "dialogue text with optional colons: and punctuation"
    const dialogueWithInstructionMatch = line.match(/^([A-ZÀ-Ỹa-zà-ỹ0-9_\s]+)(?:\s*\(([^)]*)\))?\s*:\s*(.+)$/);
    if (dialogueWithInstructionMatch) {
      const potentialSpeaker = dialogueWithInstructionMatch[1].trim();
      const upperSpeaker = potentialSpeaker.toUpperCase();

      if (
        !NON_SPEAKER_PREFIXES.has(upperSpeaker) &&
        potentialSpeaker.length <= 30 &&
        potentialSpeaker.split(/\s+/).length <= 4
      ) {
        let instruction = dialogueWithInstructionMatch[2]?.trim();
        let spokenText = dialogueWithInstructionMatch[3].trim();

        // Check if spoken text starts with parenthetical instruction e.g. "(thì thào) Cầm lấy con chip"
        const inlineInstructionMatch = spokenText.match(/^\(([^)]+)\)\s*(.+)$/);
        if (inlineInstructionMatch) {
          if (!instruction) instruction = inlineInstructionMatch[1].trim();
          spokenText = inlineInstructionMatch[2].trim();
        }

        // Clean outer quotation marks while preserving interior quotes & colons
        let subtitleText = spokenText;
        if (
          (subtitleText.startsWith('"') && subtitleText.endsWith('"')) ||
          (subtitleText.startsWith("'") && subtitleText.endsWith("'"))
        ) {
          subtitleText = subtitleText.slice(1, -1).trim();
        }

        const dId = `${currentShot.shotId}_d${String(currentShot.dialogues.length + 1).padStart(2, "0")}`;
        const diagItem: IntermediateDialogue = {
          dialogueId: dId,
          speaker: potentialSpeaker,
          text: subtitleText,
          rawText: line,
          subtitleText,
          actingInstruction: instruction,
          type: "speech",
        };
        currentShot.dialogues.push(diagItem);
        if (!currentShot.dialogue) {
          currentShot.dialogue = diagItem;
        }

        if (!currentShot.characterName) {
          currentShot.characterName = potentialSpeaker;
        }
        continue;
      }
    }

    // If plain text or screenplay direction under shot without speaker keyword, append to visual prompt
    if (!currentShot.visualPrompt) {
      currentShot.visualPrompt = line;
    } else {
      currentShot.visualPrompt += ` (${line})`;
    }
  }

  // Push pending items
  if (currentShot && currentScene) {
    currentScene.shots.push(currentShot);
  }
  if (currentScene) {
    scenes.push(currentScene);
  }

  // Strictly enforce at least one scene and at least one shot
  if (scenes.length === 0) {
    throw new ScreenplayParseError(
      "Không tìm thấy phân cảnh hợp lệ nào trong kịch bản.",
      1,
      1,
      rawText.slice(0, 100),
      "Kịch bản cần định dạng phân cảnh 'CẢNH 1: <BỐI CẢNH> - <THỜI ĐIỂM>'."
    );
  }

  for (const scene of scenes) {
    if (scene.shots.length === 0) {
      throw new ScreenplayParseError(
        `Cảnh ${scene.sceneNumber} (${scene.locationHeader}) không chứa cú máy nào.`,
        1,
        1,
        "",
        "Bổ sung ít nhất một 'CÚ MÁY 1 (medium, 4s): <mô tả>' cho phân cảnh này."
      );
    }
  }

  if (!logline) {
    logline = title;
  }

  return {
    schemaVersion: "3.0",
    title,
    episodeNumber,
    logline,
    bgm,
    scenes,
  };
}

export interface NormalizerOptions {
  seriesId?: string;
  skipAudit?: boolean;
  strictCharacters?: boolean;
  characterMapping?: Record<string, string>; // Map raw speaker name -> Story Bible characterId
}

/**
 * Enriches intermediate screenplay using persistent Story Bible context.
 * Identifies characters, assigns voiceProfileIds, flags unresolved characters,
 * and composes detailed master visual prompts.
 */
export function enrichWithBibleContext(
  parsed: IntermediateScript,
  bible: BibleManager,
  options: NormalizerOptions = {}
): EpisodicScript {
  const series = bible.getSeriesMetadata();
  const seriesStyle = series?.visual_style || "Cinematic 35mm, atmospheric lighting, photorealistic 8k";
  const aspectRatio = series?.aspect_ratio || "9:16";

  const allCharacters = bible.listCharacters();
  const allLocations = bible.listLocations();
  const allProps = bible.listKeyProps();

  const unresolvedSet = new Set<string>();

  // Helper to match character by name or id, respecting explicit options.characterMapping
  const findCharacter = (nameOrId: string) => {
    const raw = nameOrId.trim();
    if (options.characterMapping && options.characterMapping[raw]) {
      const mappedId = options.characterMapping[raw];
      const found = allCharacters.find((c) => c.id === mappedId);
      if (found) return found;
    }

    const q = raw.toLowerCase();
    return allCharacters.find(
      (c) => c.id.toLowerCase() === q || c.name.toLowerCase() === q || c.name.toLowerCase().includes(q)
    );
  };

  // Helper to match location by name or id
  const findLocation = (header: string) => {
    const q = header.toLowerCase();
    return allLocations.find(
      (l) => l.id.toLowerCase() === q || q.includes(l.name.toLowerCase()) || q.includes(l.id.toLowerCase())
    );
  };

  // Helper to match prop by name or id
  const findProp = (nameOrId: string) => {
    const q = nameOrId.toLowerCase().trim();
    return allProps.find(
      (p) => p.id.toLowerCase() === q || p.name.toLowerCase() === q || p.name.toLowerCase().includes(q)
    );
  };

  const enrichedScenes: Scene[] = parsed.scenes.map((scene) => {
    const matchedLoc = findLocation(scene.locationHeader);
    const locationId = matchedLoc ? matchedLoc.id : `loc_scene_${scene.sceneNumber}`;
    const locationName = matchedLoc ? matchedLoc.name : scene.locationHeader;
    const locationVisual = matchedLoc ? matchedLoc.visual_summary : scene.locationHeader;
    const locationAtmo = matchedLoc?.atmospheric_rules ? `, ${matchedLoc.atmospheric_rules}` : "";

    // Resolve characters present in scene
    const charsPresent: Array<{ characterId: string; wardrobeId?: string }> = [];
    if (scene.charactersMentioned) {
      for (const rawName of scene.charactersMentioned) {
        const c = findCharacter(rawName);
        if (c) {
          if (!charsPresent.some((cp) => cp.characterId === c.id)) {
            charsPresent.push({
              characterId: c.id,
              wardrobeId: c.current_wardrobe_id || undefined,
            });
          }
        } else if (rawName.toLowerCase() !== "người dẫn chuyện") {
          unresolvedSet.add(rawName);
        }
      }
    }

    // Resolve props present in scene
    const propsPresent: string[] = [];
    if (scene.propsMentioned) {
      for (const rawProp of scene.propsMentioned) {
        const p = findProp(rawProp);
        if (p) propsPresent.push(p.id);
      }
    }

    // Enrich shots
    const enrichedShots: Shot[] = scene.shots.map((shot) => {
      // Find main character for the shot
      let mainChar = shot.characterName ? findCharacter(shot.characterName) : undefined;
      if (!mainChar && shot.dialogues.length > 0) {
        const firstSpeech = shot.dialogues.find((d) => d.type !== "voiceover" && d.speaker !== "Người dẫn chuyện");
        if (firstSpeech) {
          mainChar = findCharacter(firstSpeech.speaker);
        }
      }

      // Add main character to scene.charactersPresent if found
      if (mainChar && !charsPresent.some((cp) => cp.characterId === mainChar!.id)) {
        charsPresent.push({
          characterId: mainChar.id,
          wardrobeId: mainChar.current_wardrobe_id || undefined,
        });
      }

      // Wardrobe details
      let wardrobeDetails = "";
      let wardrobeRefImage: string | undefined;
      if (mainChar?.current_wardrobe_id) {
        const w = bible.getWardrobe(mainChar.current_wardrobe_id);
        if (w) {
          wardrobeDetails = `, mặc [${w.outfit_name}: ${w.visual_description}]`;
          wardrobeRefImage = w.reference_image_path;
        }
      }

      // Character physical summary & distinguishing marks
      let charDetails = "";
      if (mainChar) {
        const marks = mainChar.distinguishing_marks ? ` (Đặc điểm nhận dạng: ${mainChar.distinguishing_marks})` : "";
        charDetails = ` Nhân vật ${mainChar.name} (${mainChar.visual_summary}${marks}${wardrobeDetails}).`;
      }

      // Compose Master Visual Prompt: Art Style + Location + Character/Props + Action Framing
      const shotFramingPrefix = shot.shotType
        ? `[Cú máy: ${shot.shotType}${shot.cameraMovement ? ` - ${shot.cameraMovement}` : ""}] `
        : "";
      const masterVisualPrompt = `${seriesStyle}. Bối cảnh: ${locationName} (${locationVisual}${locationAtmo}).${charDetails} ${shotFramingPrefix}${shot.visualPrompt}`.trim();

      // Resolve Reference Image: Priority Character Face > Wardrobe Image > Location Image
      let referenceImage: string | undefined = undefined;
      if (mainChar?.face_reference_image) {
        referenceImage = mainChar.face_reference_image;
      } else if (wardrobeRefImage) {
        referenceImage = wardrobeRefImage;
      } else if (matchedLoc?.reference_image_path) {
        referenceImage = matchedLoc.reference_image_path;
      }

      // Enrich all dialogues in the shot
      const enrichedDialogues: DialogueLine[] = [];
      for (let dIdx = 0; dIdx < shot.dialogues.length; dIdx++) {
        const d = shot.dialogues[dIdx];
        const isVoiceover = d.type === "voiceover" || d.speaker === "Người dẫn chuyện";
        const char = isVoiceover ? undefined : findCharacter(d.speaker);

        let charId = "narrator";
        let isUnresolved = false;

        if (!isVoiceover) {
          if (char) {
            charId = char.id;
          } else {
            charId = `unresolved_${d.speaker.toLowerCase().replace(/[^a-z0-9]+/g, "_")}`;
            isUnresolved = true;
            unresolvedSet.add(d.speaker);
          }
        }

        const voiceProfile = isVoiceover ? undefined : char?.voice_profile_id;
        const dialogueId = d.dialogueId || `${shot.shotId}_d${String(dIdx + 1).padStart(2, "0")}`;
        const subtitleText = d.subtitleText || d.text;
        const ttsText = d.ttsText || normalizeVietnameseForTts(subtitleText);

        enrichedDialogues.push({
          dialogueId,
          characterId: charId,
          speakerName: char ? char.name : d.speaker,
          text: ttsText,
          rawText: d.rawText || d.text,
          subtitleText,
          ttsText,
          actingInstruction: d.actingInstruction,
          type: isVoiceover ? "voiceover" : "speech",
          voiceProfileId: voiceProfile,
          isUnresolved,
        });
      }

      return {
        shotId: shot.shotId,
        shotType: shot.shotType || "medium",
        durationSec: shot.durationSec,
        visualPrompt: masterVisualPrompt,
        referenceImage,
        characterId: mainChar?.id,
        dialogues: enrichedDialogues,
        dialogue: enrichedDialogues[0], // for legacy callers
        cameraMovement: shot.cameraMovement,
        sfxCue: shot.sfxCue
          ? {
              name: shot.sfxCue.name,
              offsetSec: shot.sfxCue.offsetSec ?? 0,
              volume: shot.sfxCue.volume ?? 0.7,
            }
          : undefined,
      };
    });

    return {
      sceneId: scene.sceneId || `sc${String(scene.sceneNumber).padStart(2, "0")}`,
      sceneNumber: scene.sceneNumber,
      locationId,
      locationName,
      timeOfDay: scene.timeOfDay || "night",
      mood: scene.timeOfDay,
      charactersPresent: charsPresent,
      propsPresent,
      shots: enrichedShots,
    };
  });

  const unresolvedList = Array.from(unresolvedSet);

  if (options.strictCharacters && unresolvedList.length > 0) {
    throw new ScriptIntegrityError(
      `Phát hiện các nhân vật chưa được đăng ký trong Story Bible: [${unresolvedList.join(
        ", "
      )}]. Vui lòng đăng ký nhân vật hoặc cung cấp characterMapping.`,
      unresolvedList.map((c) => ({
        type: "UNRESOLVED_CHARACTER",
        severity: "error",
        location: `Script normalization`,
        message: `Nhân vật '${c}' chưa có trong Story Bible.`,
      }))
    );
  }

  return {
    schemaVersion: "3.0",
    version: "3.0",
    seriesId: series?.id || "episodic-series",
    episodeNumber: parsed.episodeNumber,
    title: parsed.title,
    logline: parsed.logline,
    aspectRatio,
    fps: series?.fps || 30,
    bgm: parsed.bgm,
    unresolvedCharacters: unresolvedList,
    scenes: enrichedScenes,
  };
}

/**
 * High-level function to normalize a raw screenplay, cross-reference the Story Bible,
 * perform continuity audit, validate integrity, and return a validated EpisodicScript.
 */
export async function normalizeScript(
  rawText: string,
  bible: BibleManager,
  options: NormalizerOptions = {}
): Promise<EpisodicScript> {
  // 1. Parse raw text/json (throws ScreenplayParseError on malformed text)
  const intermediate = parseRawScreenplay(rawText);

  // 2. Cross-reference & enrich with Bible context
  const enriched = enrichWithBibleContext(intermediate, bible, options);

  // 3. Validate schema
  const validated = EpisodicScriptSchema.parse(enriched);

  // 4. Validate script deep integrity
  const knownCharacters = bible.listCharacters().map((c) => c.id);
  const knownLocations = bible.listLocations().map((l) => l.id);
  const knownProps = bible.listKeyProps().map((p) => p.id);

  const integrityReport = validateScriptIntegrity(validated, {
    knownCharacterIds: knownCharacters,
    knownLocationIds: knownLocations,
    knownPropIds: knownProps,
    strict: options.strictCharacters,
  });

  if (!integrityReport.isValid) {
    throw new ScriptIntegrityError(
      `Kịch bản không vượt qua kiểm tra tính toàn vẹn: ${integrityReport.issues
        .filter((i) => i.severity === "error")
        .map((i) => i.message)
        .join("; ")}`,
      integrityReport.issues
    );
  }

  // 5. Perform Continuity Audit unless explicitly skipped
  if (!options.skipAudit) {
    const auditRes = await bible.auditDraftScript(validated.episodeNumber, rawText);
    if (auditRes.audit_status === "FAIL") {
      throw new ContinuityError(
        `Kịch bản tập ${validated.episodeNumber} vi phạm tính nhất quán cốt truyện nghiêm trọng: ${auditRes.summary}`,
        auditRes.contradictions
      );
    }
  }

  return validated;
}
