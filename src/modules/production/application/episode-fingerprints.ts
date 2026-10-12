import {canonicalizeJson as importedCanonicalize} from '../domain/spec-hasher.js';
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import type { EpisodeFingerprintsStore } from "../ports/episode-fingerprints-store.js";
import { type NarrativeDelta } from "../../../contracts/story.js";
import { type EpisodicScript, type Shot } from "../../../contracts/episode.js";
export function computeAudioFingerprint(
  script: EpisodicScript,
  transitionDurationSec = 0.0,
  options?: {
    mockTts?: boolean;
    ttsEngine?: string;
    ttsProvider?: string;
    elevenlabsVoiceId?: string;
    elevenlabsModelId?: string;
    lucylabVoiceId?: string;
    voiceConfigs?: Record<string, unknown>;
    resolvedVoicePlan?: import('../../../contracts/audio-generation.js').ResolvedVoicePlan[];
  }
): string {
  const hash = createHash("sha256");
  hash.update('audio-fingerprint-v2');
  if(options?.resolvedVoicePlan)hash.update(JSON.stringify(importedCanonicalize(options.resolvedVoicePlan)));
  hash.update(script.bgm || "none");
  hash.update(String(transitionDurationSec));
  hash.update(`mockTts:${Boolean(options?.mockTts)}`);
  const provider = options?.ttsProvider ?? "elevenlabs";
  hash.update(`provider:${provider}`);
  if (options?.ttsEngine) hash.update(`engine:${options.ttsEngine}`);
  const elVoice = options?.elevenlabsVoiceId;
  if (elVoice) hash.update(`elevenlabsVoice:${elVoice}`);
  const elModel = options?.elevenlabsModelId;
  if (elModel) hash.update(`elevenlabsModel:${elModel}`);
  const lucyVoice = options?.lucylabVoiceId;
  if (lucyVoice) hash.update(`lucylabVoice:${lucyVoice}`);
  if (options?.voiceConfigs) hash.update(`voices:${JSON.stringify(options.voiceConfigs)}`);
  for (const scene of script.scenes) {
    for (const shot of scene.shots) {
      hash.update(`${shot.shotId}:${shot.durationSec}`);
      if (shot.sfxCue) {
        hash.update(`${shot.shotId}:${shot.sfxCue.name}:${shot.sfxCue.offsetSec}:${shot.sfxCue.volume}:${shot.sfxCue.pan ?? 0}:${shot.sfxCue.description ?? ""}`);
      }
      for (const d of shot.dialogues) {
        hash.update(
          `${d.dialogueId}:${d.characterId}:${d.speakerName}:${d.ttsText || d.text}:${d.voiceProfileId || ""}:${d.actingInstruction || ""}`
        );
      }
    }
  }
  return hash.digest("hex");
}

export function computeShotSpecHash(
  shot: Shot,
  aspectRatio: string,
  provider: string,
  modelName = "default",
  referenceImageHash?: string
): string {
  const hash = createHash("sha256");
  hash.update(shot.visualPrompt);
  hash.update(shot.characterId || "");
  hash.update(String(shot.durationSec));
  hash.update(aspectRatio);
  hash.update(provider);
  hash.update(modelName);
  hash.update(shot.shotType || "medium");
  hash.update(referenceImageHash || shot.referenceImage || "");
  return hash.digest("hex");
}

export function computeFileSha256(filePath: string): Promise<string> {
  return new Promise<string>((res, rej) => {
    const hash = createHash("sha256");
    const stream = createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => res(hash.digest("hex")));
    stream.on("error", (err) => rej(err));
  });
}

export function extractNarrativeDeltaFromScript(
  script: {
    seriesId?: string;
    episodeNumber?: number;
    title?: string;
    logline?: string;
    characterStatusUpdates?: Array<{ id: string; status: string; notes?: string; distinguishingMarks?: string }>;
    propTransfers?: Array<{ propId?: string; prop_id?: string; newHolderId?: string; new_holder_id?: string; toCharacterId?: string; reason?: string }>;
    newKnowledge?: Array<{ characterId?: string; character_id?: string; factKey?: string; fact_key?: string; notes?: string }>;
    scenes?: any[];
  },
  bible: EpisodeFingerprintsStore,
  seriesId?: string
): NarrativeDelta {
  const targetSeriesId = seriesId || script.seriesId;
  const majorEvents: string[] = [];
  if (script.logline) {
    majorEvents.push(script.logline);
  }

  const locationsVisited = new Set<string>();
  const charactersAppeared = new Set<string>();
  const wardrobeMap = new Map<string, string>();
  const propsUsed = new Set<string>();

  for (const scene of script.scenes || []) {
    const loc = `${scene.locationName || "Chưa rõ"} (${scene.timeOfDay || "DAY"})`;
    locationsVisited.add(loc);

    // Extract significant action or dialogue from scene
    const keyShots = (scene.shots || []).filter(
      (s: any) => (s.dialogues && s.dialogues.length > 0) || s.visualPrompt
    );
    if (keyShots.length > 0) {
      const primaryShot = keyShots[0];
      const dialogueSummary =
        primaryShot.dialogues && primaryShot.dialogues[0]?.text
          ? `: "${primaryShot.dialogues[0].text.slice(0, 80)}"`
          : "";
      const action = primaryShot.visualPrompt || "";
      majorEvents.push(
        `Cảnh ${scene.sceneNumber || 1} (${scene.locationName || "Scene"}): ${action.slice(0, 100)}${dialogueSummary}`
      );
    }

    for (const char of scene.charactersPresent || []) {
      const charId = typeof char === "string" ? char : char?.characterId;
      if (charId) {
        charactersAppeared.add(charId);
        if (typeof char === "object" && char.wardrobeId) {
          wardrobeMap.set(charId, char.wardrobeId);
        }
      }
    }

    for (const propId of scene.propsPresent || []) {
      if (propId) {
        propsUsed.add(propId);
      }
    }
  }

  // 1. Detect dynamic character status changes (injuries, deaths, healing)
  const scriptStatusOverrides = new Map<string, { status: string; notes?: string }>();
  if (script.characterStatusUpdates && Array.isArray(script.characterStatusUpdates)) {
    for (const u of script.characterStatusUpdates) {
      if (u.id && u.status) scriptStatusOverrides.set(u.id, u);
    }
  }

  const visualActionText = (script.scenes || [])
    .flatMap((sc: any) => [
      sc.locationName || "",
      sc.description || "",
      ...(sc.shots || []).map((sh: any) => sh.visualPrompt || ""),
    ])
    .join(" ")
    .toLowerCase();

  const characterStatusUpdates: Array<{ id: string; status: string; notes?: string }> = [];
  for (const charId of charactersAppeared) {
    const existing = targetSeriesId ? bible.getCharacter(charId, targetSeriesId) : bible.getCharacter(charId);
    if (existing) {
      // Anti-resurrection gate: if character is deceased, do not reset status to alive
      if (existing.status === "deceased") {
        continue;
      }

      let determinedStatus: string = existing.status || "alive";
      let notes = `Tham gia tập ${script.episodeNumber ?? "?"}: ${script.title ?? ""}`;

      if (scriptStatusOverrides.has(charId)) {
        const ov = scriptStatusOverrides.get(charId)!;
        determinedStatus = ov.status;
        if (ov.notes) notes = ov.notes;
      } else {
        const charNameLower = (existing.name || "").toLowerCase();

        // Fix #1: Global check prevents actual death detection in the same episode.
        // E.g. if the script says "Lan tưởng Minh đã chết" but later "Minh hy sinh",
        // the global `isHypotheticalOrNegated` blocked the actual death status.
        // Instead, we check for explicit positive death keywords first, and only
        // override them if they appear *exclusively* in a hypothetical context.
        const isHypotheticalOnly =
          (visualActionText.includes(`tưởng ${charNameLower} đã chết`) ||
            visualActionText.includes(`${charNameLower} thoát chết`) ||
            visualActionText.includes(`${charNameLower} không chết`)) &&
          !visualActionText.includes(`${charNameLower} hy sinh`) &&
          !visualActionText.includes(`${charNameLower} tử vong`);

        if (!isHypotheticalOnly) {
          if (
            visualActionText.includes(`${charNameLower} hy sinh`) ||
            visualActionText.includes(`${charNameLower} tử vong`) ||
            visualActionText.includes(`${charNameLower} đã chết`)
          ) {
            determinedStatus = "deceased";
            notes = `Hy sinh trong tập ${script.episodeNumber ?? "?"}`;
          } else if (
            visualActionText.includes(`${charNameLower} bị thương`) ||
            visualActionText.includes(`${charNameLower} trúng đạn`) ||
            visualActionText.includes(`${charNameLower} gãy tay`) ||
            visualActionText.includes(`${charNameLower} bất tỉnh`)
          ) {
            determinedStatus = "injured";
            notes = `Bị thương trong tập ${script.episodeNumber ?? "?"}`;
          } else if (
            existing.status === "injured" &&
            (visualActionText.includes(`${charNameLower} hồi phục`) ||
              visualActionText.includes(`${charNameLower} đã khỏi`) ||
              visualActionText.includes(`chữa lành cho ${charNameLower}`))
          ) {
            determinedStatus = "alive";
            notes = `Hồi phục trong tập ${script.episodeNumber ?? "?"}`;
          }
        }
      }

      characterStatusUpdates.push({
        id: charId,
        status: determinedStatus,
        notes,
      });
    }
  }

  const wardrobeUpdates: Array<{ character_id: string; wardrobe_id: string }> = [];
  for (const [charId, wId] of wardrobeMap.entries()) {
    // Check if wardrobe exists in Bible and belongs to character before recording delta
    const wardrobe = bible.getWardrobe(wId);
    if (wardrobe && wardrobe.character_id === charId) {
      wardrobeUpdates.push({
        character_id: charId,
        wardrobe_id: wId,
      });
    }
  }

  // 2. Detect prop transfers & holder changes
  const propTransfers: Array<{
    prop_id: string;
    new_holder_id: string;
    from_holder_id?: string;
    reason?: string;
  }> = [];

  if (script.propTransfers && Array.isArray(script.propTransfers)) {
    for (const pt of script.propTransfers) {
      const propId = pt.propId || pt.prop_id;
      const newHolder = pt.toCharacterId || pt.newHolderId || pt.new_holder_id;
      if (propId && newHolder) {
        const prop = targetSeriesId ? bible.getKeyProp(propId, targetSeriesId) : bible.getKeyProp(propId);
        if (prop) {
          propTransfers.push({
            prop_id: propId,
            new_holder_id: newHolder,
            from_holder_id: prop.current_holder_id || undefined,
            reason: pt.reason || `Chuyển giao trong tập ${script.episodeNumber ?? "?"}`,
          });
        }
      }
    }
  } else {
    // In-memory prop holder map: tracks the current holder within this episode
    // without relying on mid-episode DB reads (which reflect only the pre-episode state).
    const inMemoryPropHolder = new Map<string, string | null>();
    // Episode-scoped character record cache: characters appearing across multiple scenes
    // are looked up only once, reducing DB calls from O(scenes × chars) to O(unique chars).
    const episodeCharCache = new Map<string, any>();

    for (const scene of script.scenes || []) {
      // 2a. Support structured scene-level propTransfers or events (Finding 15)
      const sceneStructuredTransfers: any[] = [];
      if (Array.isArray(scene.propTransfers)) {
        sceneStructuredTransfers.push(...scene.propTransfers);
      }
      if (Array.isArray(scene.events)) {
        for (const ev of scene.events) {
          if ((ev as any)?.type === "prop_transfer" || (ev as any)?.eventType === "prop_transfer") {
            sceneStructuredTransfers.push(ev);
          }
        }
      }

      if (sceneStructuredTransfers.length > 0) {
        for (const st of sceneStructuredTransfers) {
          const pId = st.propId || st.prop_id;
          const newHolder = st.toCharacterId || st.newHolderId || st.new_holder_id || st.recipientId;
          if (pId && newHolder) {
            const currentHolder =
              inMemoryPropHolder.get(pId) ??
              ((targetSeriesId ? bible.getKeyProp(pId, targetSeriesId) : bible.getKeyProp(pId))?.current_holder_id ?? null);
            if (newHolder !== currentHolder) {
              propTransfers.push({
                prop_id: pId,
                new_holder_id: newHolder,
                from_holder_id: currentHolder || undefined,
                reason: st.reason || `Chuyển giao có cấu trúc trong Cảnh ${scene.sceneNumber || 1}`,
              });
              inMemoryPropHolder.set(pId, newHolder);
            }
          }
        }
      }

      if (
        scene.propsPresent &&
        scene.propsPresent.length > 0 &&
        scene.charactersPresent &&
        scene.charactersPresent.length > 0
      ) {
        // Fix #3: scText is computed once per scene, outside the props loop,
        // preventing redundant string concatenation for every prop.
        const scText = (scene.shots || [])
          .map((s: any) => s.visualPrompt || "")
          .join(" ")
          .toLowerCase();

        const presentIds = (scene.charactersPresent || [])
          .map((c: any) => (typeof c === "string" ? c : c?.characterId))
          .filter(Boolean) as string[];
        // Populate episode-scoped cache for any character not yet seen this episode.
        for (const cId of presentIds) {
          if (!episodeCharCache.has(cId)) {
            const cRec = targetSeriesId
              ? bible.getCharacter(cId, targetSeriesId)
              : bible.getCharacter(cId);
            episodeCharCache.set(cId, cRec);
          }
        }

        for (const pId of scene.propsPresent) {
          // If already transferred in structured events for this scene, skip heuristic
          if (sceneStructuredTransfers.some((st) => (st.propId || st.prop_id) === pId)) {
            continue;
          }

          // Use in-memory holder if we already tracked a transfer this episode,
          // otherwise fall back to the database value (pre-episode state).
          const prop = targetSeriesId
            ? bible.getKeyProp(pId, targetSeriesId)
            : bible.getKeyProp(pId);

          let currentHolder: string | null;
          if (inMemoryPropHolder.has(pId)) {
            currentHolder = inMemoryPropHolder.get(pId) ?? null;
          } else {
            currentHolder = prop?.current_holder_id ?? null;
            inMemoryPropHolder.set(pId, currentHolder);
          }

          // Finding 6: Check for specific prop name mentions in shots to prevent false positives
          const pName = (prop?.name || "").toLowerCase();
          const isSinglePropInScene = scene.propsPresent.length === 1;
          const propMentionedInScene =
            isSinglePropInScene ||
            (pName && scText.includes(pName)) ||
            scText.includes(pId.toLowerCase());

          if (!propMentionedInScene) {
            continue;
          }

          let recipientCharId: string | null = null;

          // 1. Look for specific recipient character in visual prompts
          for (const sh of scene.shots || []) {
            const prompt = (sh.visualPrompt || "").toLowerCase();
            // If multiple props are present in the scene, ensure this shot mentions this prop
            if (!isSinglePropInScene && pName && !prompt.includes(pName) && !prompt.includes(pId.toLowerCase())) {
              continue;
            }

            const holderRec = currentHolder ? episodeCharCache.get(currentHolder) : null;
            const holderName = (holderRec?.name || currentHolder || "").toLowerCase();
            const isHolderAction =
              holderName &&
              (prompt.includes(`${holderName} cầm lấy`) ||
                prompt.includes(`${holderName} cầm`) ||
                prompt.includes(`${holderName} cất`) ||
                prompt.includes(`${holderName} giữ`));

            for (const cId of presentIds) {
              if (cId === currentHolder) continue;
              const cRec = episodeCharCache.get(cId);
              const cName = (cRec?.name || cId).toLowerCase();

              // If this is an action performed by the current holder, don't misattribute to another character
              // unless there is an explicit transfer preposition towards cName
              if (
                isHolderAction &&
                !prompt.includes(`cho ${cName}`) &&
                !prompt.includes(`đến ${cName}`) &&
                !prompt.includes(`trao`) &&
                !prompt.includes(`giao`)
              ) {
                continue;
              }

              if (
                prompt.includes(`cho ${cName}`) ||
                prompt.includes(`đến ${cName}`) ||
                prompt.includes(`${cName} nhận`) ||
                prompt.includes(`${cName} cầm`) ||
                prompt.includes(`${cName} giữ`) ||
                prompt.includes(`${cName} cất`)
              ) {
                recipientCharId = cId;
                break;
              }
            }
            if (recipientCharId) break;
          }

          // 2. Fallback: only trigger on unambiguous transfer phrases.
          // Finding 5: Exclude non-transfer idioms like "đưa ra quyết định", "đưa mắt", "đưa tin".
          if (!recipientCharId) {
            const isNonTransferPhrase = /(?:đưa ra|đưa mắt|đưa tin|đưa tiễn|đưa đón|trao đổi)/i.test(scText);
            const hasUnambiguousTransfer =
              /(?:trao|bàn giao|chuyển giao|tặng|giao lại|chuyền).{0,30}(?:cho|tận tay|lại)?/i.test(scText) ||
              /(?:đưa).{0,30}(?:cho|tận tay|tay cho|qua cho)/i.test(scText);

            if (hasUnambiguousTransfer && (!isNonTransferPhrase || /(?:đưa|trao).{0,30}cho/i.test(scText))) {
              // Priority 1: Match explicit recipient character name in scene text
              for (const cId of presentIds) {
                if (cId === currentHolder) continue;
                const cRec = episodeCharCache.get(cId);
                const cName = (cRec?.name || cId).toLowerCase();
                const escapedName = cName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
                const transferToRegex = new RegExp(
                  `(?:cho|tận tay|tới|giao|trao|chuyển)\\s+(?:cho\\s+)?(?:anh|chị|cô|bác|chú|em)?\\s*${escapedName}`,
                  "i"
                );
                if (
                  transferToRegex.test(scText) ||
                  scText.includes(`cho ${cName}`) ||
                  scText.includes(`tận tay ${cName}`) ||
                  scText.includes(`${cName} nhận`) ||
                  scText.includes(`${cName} cầm`)
                ) {
                  recipientCharId = cId;
                  break;
                }
              }

              // Priority 2: If no explicit name match, only attribute if there is exactly ONE other character in the scene
              if (!recipientCharId) {
                const otherPresent = presentIds.filter((cId: string) => cId !== currentHolder);
                if (otherPresent.length === 1) {
                  recipientCharId = otherPresent[0];
                }
              }
            }
          }

          if (recipientCharId && recipientCharId !== currentHolder) {
            propTransfers.push({
              prop_id: pId,
              new_holder_id: recipientCharId,
              from_holder_id: currentHolder || undefined,
              reason: `Chuyển giao cho ${recipientCharId} trong Cảnh ${scene.sceneNumber || 1}`,
            });
            // Update in-memory holder so subsequent scenes in this episode see the new state.
            inMemoryPropHolder.set(pId, recipientCharId);
          }
        }
      }
    }
  }

  // 3. Detect new character knowledge / revealed secrets
  const newKnowledge: Array<{ character_id: string; fact_key: string; notes?: string }> = [];
  if (script.newKnowledge && Array.isArray(script.newKnowledge)) {
    for (const k of script.newKnowledge) {
      const charId = k.characterId || k.character_id;
      const factKey = k.factKey || k.fact_key;
      if (charId && factKey) {
        newKnowledge.push({
          character_id: charId,
          fact_key: factKey,
          notes: k.notes,
        });
      }
    }
  }

  const worldStateUpdates: Record<string, unknown> = {
    last_episode_number: script.episodeNumber,
    last_episode_title: script.title,
    locations_visited: Array.from(locationsVisited),
    props_active: Array.from(propsUsed),
  };

  return {
    major_events: majorEvents.length > 0 ? majorEvents : [script.logline || `Hoàn thành tập ${script.episodeNumber ?? 1}`],
    character_status_updates: characterStatusUpdates,
    character_wardrobe_updates: wardrobeUpdates,
    prop_transfers: propTransfers,
    new_knowledge: newKnowledge,
    world_state_updates: worldStateUpdates,
  };
}
