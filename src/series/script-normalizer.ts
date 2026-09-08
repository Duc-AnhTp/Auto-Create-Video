import {
  EpisodicScriptSchema,
  type EpisodicScript,
  type Scene,
  type Shot,
  type ShotType,
  type DialogueLine,
} from "./series-schema.js";
import { BibleManager } from "../bible/bible-manager.js";
import { normalizeVietnameseForTts } from "../tts/vietnamese-normalizer.js";
import { escapeRegex } from "../bible/continuity-auditor.js";

export class ContinuityError extends Error {
  public contradictions: any[];
  constructor(message: string, contradictions: any[]) {
    super(message);
    this.name = "ContinuityError";
    this.contradictions = contradictions;
  }
}

export interface IntermediateShot {
  shotId: string;
  shotType?: ShotType;
  durationSec: number;
  visualPrompt: string;
  characterName?: string;
  dialogue?: {
    speaker: string;
    text: string;
    type?: "speech" | "voiceover";
  };
  cameraMovement?: string;
  sfxCue?: {
    name: string;
    offsetSec?: number;
    volume?: number;
  };
}

export interface IntermediateScene {
  sceneNumber: number;
  locationHeader: string;
  timeOfDay?: "day" | "night" | "golden_hour" | "dusk" | "dawn";
  charactersMentioned?: string[];
  propsMentioned?: string[];
  shots: IntermediateShot[];
}

export interface IntermediateScript {
  title: string;
  episodeNumber: number;
  logline: string;
  bgm?: string;
  scenes: IntermediateScene[];
}

/**
 * Parses free-form text screenplay or JSON into IntermediateScript structure.
 */
export function parseRawScreenplay(rawText: string, defaultEpisode = 1): IntermediateScript {
  const trimmed = rawText.trim();
  // 1. If it is already valid JSON, parse and check
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed.scenes && Array.isArray(parsed.scenes)) {
        return {
          title: parsed.title || "Tập Phim Mới",
          episodeNumber: parsed.episodeNumber ?? defaultEpisode,
          logline: parsed.logline || parsed.title || "",
          bgm: parsed.bgm,
          scenes: parsed.scenes.map((s: any, idx: number) => ({
            sceneNumber: s.sceneNumber ?? idx + 1,
            locationHeader: s.locationName || s.locationHeader || s.locationId || `Cảnh ${idx + 1}`,
            timeOfDay: s.timeOfDay || "night",
            charactersMentioned: s.charactersMentioned || s.charactersPresent?.map((c: any) => c.characterId || c),
            propsMentioned: s.propsMentioned || s.propsPresent,
            shots: (s.shots || []).map((sh: any, shIdx: number) => ({
              shotId: sh.shotId || `sc${idx + 1}_sh${shIdx + 1}`,
              shotType: sh.shotType || "medium",
              durationSec: sh.durationSec || 4.0,
              visualPrompt: sh.visualPrompt || "",
              characterName: sh.characterName || sh.characterId,
              dialogue: sh.dialogue
                ? {
                    speaker: sh.dialogue.speakerName || sh.dialogue.characterId || "Người dẫn chuyện",
                    text: sh.dialogue.text,
                    type: sh.dialogue.type || "speech",
                  }
                : undefined,
              cameraMovement: sh.cameraMovement,
              sfxCue: sh.sfxCue,
            })),
          })),
        };
      }
    } catch {
      // Fall through to text parsing
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

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith("#") || line.startsWith("//")) continue;

    // Header fields
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

    // Scene header: CẢNH 1: ... or SCENE 1: ...
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
      currentScene = {
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
    if (charsMatch && currentScene) {
      currentScene.charactersMentioned = charsMatch[1].split(/[,;]/).map((s) => s.trim()).filter(Boolean);
      continue;
    }

    const propsMatch = line.match(/^(?:ĐẠO CỤ|PROPS)\s*:\s*(.+)$/i);
    if (propsMatch && currentScene) {
      currentScene.propsMentioned = propsMatch[1].split(/[,;]/).map((s) => s.trim()).filter(Boolean);
      continue;
    }

    // Shot header: [SHOT 1: TOÀN CẢNH] or SHOT 1: ...
    const shotMatch = line.match(/^(?:\[?\s*SHOT\s*(\d+)(?:\s*:\s*([^\]]+))?\]?)/i);
    if (shotMatch) {
      if (!currentScene) {
        currentScene = {
          sceneNumber: 1,
          locationHeader: "Bối Cảnh Chung",
          timeOfDay: "night",
          shots: [],
        };
      }
      if (currentShot) {
        currentScene.shots.push(currentShot);
      }
      const shotNum = parseInt(shotMatch[1], 10);
      const shotTypeRaw = (shotMatch[2] || "").toLowerCase();
      let shotType: ShotType = "medium";
      if (shotTypeRaw.includes("toàn") || shotTypeRaw.includes("wide") || shotTypeRaw.includes("establishing")) {
        shotType = shotTypeRaw.includes("establishing") ? "establishing" : "wide";
      } else if (shotTypeRaw.includes("cận") || shotTypeRaw.includes("close")) {
        shotType = shotTypeRaw.includes("extreme") ? "extreme_close_up" : "close_up";
      } else if (shotTypeRaw.includes("hành động") || shotTypeRaw.includes("action")) {
        shotType = "action";
      } else if (shotTypeRaw.includes("vai") || shotTypeRaw.includes("over_the_shoulder")) {
        shotType = "over_the_shoulder";
      }

      currentShot = {
        shotId: `sc${currentScene.sceneNumber}_sh${shotNum}`,
        shotType,
        durationSec: 4.0,
        visualPrompt: "",
      };
      continue;
    }

    // Shot details
    if (currentShot) {
      const durMatch = line.match(/^(?:THỜI LƯỢNG|DURATION)\s*:\s*([\d.]+)\s*s?/i);
      if (durMatch) {
        currentShot.durationSec = parseFloat(durMatch[1]);
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

      // Voiceover / Dialogue:
      const voMatch = line.match(/^(?:DẪN CHUYỆN|VOICEOVER|NGƯỜI DẪN CHUYỆN)\s*:\s*(.+)$/i);
      if (voMatch) {
        currentShot.dialogue = {
          speaker: "Người dẫn chuyện",
          text: voMatch[1].trim(),
          type: "voiceover",
        };
        continue;
      }

      const dialogueMatch = line.match(/^(?:THOẠI\s*:\s*)?([A-ZÀ-Ỹa-zà-ỹ0-9_\s]+)\s*:\s*["']?([^"']+)["']?$/);
      if (dialogueMatch) {
        const speaker = dialogueMatch[1].trim();
        const text = dialogueMatch[2].trim();
        currentShot.dialogue = {
          speaker,
          text,
          type: "speech",
        };
        if (!currentShot.characterName) {
          currentShot.characterName = speaker;
        }
        continue;
      }

      // If plain text under shot without keyword, append to visual prompt
      if (!currentShot.visualPrompt) {
        currentShot.visualPrompt = line;
      }
    }
  }

  // Push pending items
  if (currentShot && currentScene) {
    currentScene.shots.push(currentShot);
  }
  if (currentScene) {
    scenes.push(currentScene);
  }

  // If no scenes detected (e.g. single paragraph of text), wrap in a single scene with shots
  if (scenes.length === 0) {
    scenes.push({
      sceneNumber: 1,
      locationHeader: "Bối Cảnh Chính",
      timeOfDay: "night",
      shots: [
        {
          shotId: "sc01_sh01",
          shotType: "establishing",
          durationSec: 5.0,
          visualPrompt: rawText.slice(0, 300),
          dialogue: {
            speaker: "Người dẫn chuyện",
            text: rawText.slice(0, 150),
            type: "voiceover",
          },
        },
      ],
    });
  }

  if (!logline) {
    logline = title;
  }

  return {
    title,
    episodeNumber,
    logline,
    bgm,
    scenes,
  };
}

/**
 * Enriches intermediate screenplay using persistent Story Bible context.
 */
export function enrichWithBibleContext(
  parsed: IntermediateScript,
  bible: BibleManager
): EpisodicScript {
  const series = bible.getSeriesMetadata();
  const seriesStyle = series?.visual_style || "Cinematic 35mm, atmospheric lighting, photorealistic 8k";
  const aspectRatio = series?.aspect_ratio || "9:16";

  const allCharacters = bible.listCharacters();
  const allLocations = bible.listLocations();
  const allProps = bible.listKeyProps();

  // Helper to match character by name or id
  const findCharacter = (nameOrId: string) => {
    const q = nameOrId.toLowerCase().trim();
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

    // Resolve characters present
    const charsPresent: Array<{ characterId: string; wardrobeId?: string }> = [];
    if (scene.charactersMentioned) {
      for (const rawName of scene.charactersMentioned) {
        const c = findCharacter(rawName);
        if (c) {
          charsPresent.push({
            characterId: c.id,
            wardrobeId: c.current_wardrobe_id,
          });
        }
      }
    }

    // Resolve props present
    const propsPresent: string[] = [];
    if (scene.propsMentioned) {
      for (const rawProp of scene.propsMentioned) {
        const p = findProp(rawProp);
        if (p) propsPresent.push(p.id);
      }
    }

    // Enrich shots
    const enrichedShots: Shot[] = scene.shots.map((shot) => {
      let mainChar = shot.characterName ? findCharacter(shot.characterName) : undefined;
      // If shot has dialogue and speaker is not narrator, infer main character
      if (!mainChar && shot.dialogue && shot.dialogue.type === "speech" && shot.dialogue.speaker !== "Người dẫn chuyện") {
        mainChar = findCharacter(shot.dialogue.speaker);
      }

      // Add character to scene.charactersPresent if not already there
      if (mainChar && !charsPresent.some((cp) => cp.characterId === mainChar!.id)) {
        charsPresent.push({
          characterId: mainChar.id,
          wardrobeId: mainChar.current_wardrobe_id,
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

      // Character physical summary & distinguishing marks (persistent scars/items)
      let charDetails = "";
      if (mainChar) {
        const marks = mainChar.distinguishing_marks ? ` (Đặc điểm nhận dạng: ${mainChar.distinguishing_marks})` : "";
        charDetails = ` Nhân vật ${mainChar.name} (${mainChar.visual_summary}${marks}${wardrobeDetails}).`;
      }

      // Compose Master Visual Prompt: Art Style + Location + Character/Props + Action Framing
      const shotFramingPrefix = shot.shotType ? `[Cú máy: ${shot.shotType}${shot.cameraMovement ? ` - ${shot.cameraMovement}` : ""}] ` : "";
      const masterVisualPrompt = `${seriesStyle}. Bối cảnh: ${locationName} (${locationVisual}${locationAtmo}).${charDetails} ${shotFramingPrefix}${shot.visualPrompt}`.trim();

      // Resolve Reference Image: Priority Character Face Reference > Wardrobe Image > Location Image
      let referenceImage: string | undefined = undefined;
      if (mainChar?.face_reference_image) {
        referenceImage = mainChar.face_reference_image;
      } else if (wardrobeRefImage) {
        referenceImage = wardrobeRefImage;
      } else if (matchedLoc?.reference_image_path) {
        referenceImage = matchedLoc.reference_image_path;
      }

      // Enrich Dialogue
      let enrichedDialogue: DialogueLine | undefined = undefined;
      if (shot.dialogue) {
        const isVoiceover = shot.dialogue.type === "voiceover" || shot.dialogue.speaker === "Người dẫn chuyện";
        const charId = isVoiceover ? "narrator" : (mainChar ? mainChar.id : "char_unknown");
        const voiceProfile = isVoiceover ? undefined : mainChar?.voice_profile_id;

        enrichedDialogue = {
          characterId: charId,
          speakerName: shot.dialogue.speaker,
          text: normalizeVietnameseForTts(shot.dialogue.text),
          type: isVoiceover ? "voiceover" : "speech",
          voiceProfileId: voiceProfile,
        };
      }

      return {
        shotId: shot.shotId,
        shotType: shot.shotType || "medium",
        durationSec: shot.durationSec,
        visualPrompt: masterVisualPrompt,
        referenceImage,
        characterId: mainChar?.id,
        dialogue: enrichedDialogue,
        cameraMovement: shot.cameraMovement,
        sfxCue: shot.sfxCue,
      };
    });

    return {
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

  return {
    version: "2.0",
    seriesId: series?.id || "episodic-series",
    episodeNumber: parsed.episodeNumber,
    title: parsed.title,
    logline: parsed.logline,
    aspectRatio,
    bgm: parsed.bgm,
    scenes: enrichedScenes,
  };
}

export interface NormalizerOptions {
  skipAudit?: boolean;
}

/**
 * High-level function to normalize a raw screenplay, cross-reference the Story Bible,
 * perform continuity audit, and return a validated EpisodicScript.
 */
export async function normalizeScript(
  rawText: string,
  bible: BibleManager,
  options: NormalizerOptions = {}
): Promise<EpisodicScript> {
  // 1. Parse raw text/json
  const intermediate = parseRawScreenplay(rawText);

  // 2. Cross-reference & enrich with Bible context
  const enriched = enrichWithBibleContext(intermediate, bible);

  // 3. Validate schema
  const validated = EpisodicScriptSchema.parse(enriched);

  // 4. Perform Continuity Audit unless explicitly skipped
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
