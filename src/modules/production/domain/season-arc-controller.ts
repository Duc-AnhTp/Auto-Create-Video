import type {DramaticAct,EpisodePacingProfile,CharacterEvolutionState,CrossEpisodeStateSnapshot} from '../../../contracts/media-features.js';
export type {DramaticAct,EpisodePacingProfile,CharacterEvolutionState,CrossEpisodeStateSnapshot} from '../../../contracts/media-features.js';
import type { SeasonArcControllerStore } from "../ports/season-arc-controller-store.js";










/**
 * Season Narrative Arc & Pacing Controller.
 *
 * Implements Hollywood 3-Act Season Structural Theory:
 * 1. Act 1 (Episodes 1-2 / 10-25%): Exposition, Inciting Incident, Tension 0.3 - 0.5.
 * 2. Act 2A (Episodes 3-4 / 25-50%): Complications, Rising Stakes, Tension 0.5 - 0.7.
 * 3. Midpoint (Episode 5 / 50%): Shocking Reversal / False Victory, Tension 0.85.
 * 4. Act 2B (Episodes 6-7 / 50-75%): Dark Night of the Soul, Escalation, Tension 0.7 - 0.9.
 * 5. Act 3 (Episodes 8-9 / 75-90%): Climax & Final Confrontation, Tension 1.0 (Peak).
 * 6. Resolution (Episode 10 / 90-100%): Denouement & Cliffhanger, Tension 0.6.
 *
 * Also manages Cross-Episode State Transfer ensuring character injuries,
 * wardrobe damage, secret revelations, and prop transfers persist seamlessly.
 */
export class SeasonArcController {
  /**
   * Computes the narrative pacing and dramatic intensity profile for an episode within a season.
   */
  public static getEpisodePacingProfile(
    episodeNumber: number,
    totalEpisodes: number = 10
  ): EpisodePacingProfile {
    const progress = (episodeNumber - 0.5) / Math.max(1, totalEpisodes);

    let act: DramaticAct;
    let tensionScore: number;
    let heroShotRatio: number;
    let targetShotDurationSec: number;
    let actionDensity: EpisodePacingProfile["actionDensity"];
    let lensStyle: EpisodePacingProfile["recommendedCameraGrammar"]["lensStyle"];
    let averageShotsPerScene: number;
    let closeUpEmphasis: number;
    const objectives: string[] = [];

    if (progress < 0.22) {
      act = "act_1_setup";
      tensionScore = 0.35 + progress * 0.5; // ~0.35 - 0.46
      heroShotRatio = 0.20;
      targetShotDurationSec = 4.8;
      actionDensity = "low";
      lensStyle = "deliberate_telephoto";
      averageShotsPerScene = 4;
      closeUpEmphasis = 0.45;
      objectives.push("Thiết lập thế giới, giới thiệu nhân vật chính, tạo biến cố khởi đầu");
    } else if (progress < 0.45) {
      act = "act_2a_rising";
      tensionScore = 0.50 + (progress - 0.22) * 0.9; // ~0.50 - 0.70
      heroShotRatio = 0.30;
      targetShotDurationSec = 4.0;
      actionDensity = "medium";
      lensStyle = "dynamic_wide";
      averageShotsPerScene = 5;
      closeUpEmphasis = 0.55;
      objectives.push("Dấn thân vào thử thách, xung đột đồng minh, nâng cao tiền cược");
    } else if (progress < 0.55) {
      act = "midpoint_reversal";
      tensionScore = 0.85; // Sharp spike
      heroShotRatio = 0.45;
      targetShotDurationSec = 3.2;
      actionDensity = "high";
      lensStyle = "handheld_shaky";
      averageShotsPerScene = 7;
      closeUpEmphasis = 0.70;
      objectives.push("Đột biến điểm giữa: Tiết lộ bí mật chấn động, đảo ngược tình thế");
    } else if (progress < 0.75) {
      act = "act_2b_escalation";
      tensionScore = 0.70 + (progress - 0.55) * 1.0; // ~0.70 - 0.90
      heroShotRatio = 0.35;
      targetShotDurationSec = 3.6;
      actionDensity = "high";
      lensStyle = "dynamic_wide";
      averageShotsPerScene = 6;
      closeUpEmphasis = 0.65;
      objectives.push("Đêm tối tâm hồn, mất mát to lớn, đối thủ tổng phản công");
    } else if (progress < 0.90) {
      act = "act_3_climax";
      tensionScore = 1.0; // Peak intensity
      heroShotRatio = 0.55;
      targetShotDurationSec = 2.6; // Rapid dynamic editing
      actionDensity = "peak";
      lensStyle = "epic_crane";
      averageShotsPerScene = 9;
      closeUpEmphasis = 0.80;
      objectives.push("Trận chiến đỉnh điểm: Quyết chiến một mất một còn, giải quyết xung đột gốc");
    } else {
      act = "resolution_cliffhanger";
      tensionScore = 0.60;
      heroShotRatio = 0.25;
      targetShotDurationSec = 4.5;
      actionDensity = "medium";
      lensStyle = "deliberate_telephoto";
      averageShotsPerScene = 4;
      closeUpEmphasis = 0.50;
      objectives.push("Hạ màn cảm xúc, khép lại hành trình mùa này, hé lộ cú hích Cliffhanger mùa sau");
    }

    return {
      episodeNumber,
      totalEpisodes,
      act,
      tensionScore: parseFloat(tensionScore.toFixed(2)),
      heroShotRatio,
      targetShotDurationSec,
      actionDensity,
      recommendedCameraGrammar: {
        lensStyle,
        averageShotsPerScene,
        closeUpEmphasis,
      },
      narrativeObjectives: objectives,
    };
  }

  /**
   * Captures character continuity and world state from Episode N to propagate into Episode N+1.
   */
  public static extractCrossEpisodeState(
    bible: SeasonArcControllerStore,
    seriesId: string,
    currentEpisode: number
  ): CrossEpisodeStateSnapshot {
    const characters = bible.listCharacters(seriesId);
    const props = bible.listKeyProps(seriesId);
    const chekhovGuns = bible.listChekhovGuns(seriesId);

    const characterStates: CharacterEvolutionState[] = characters.map((c) => {
      // Find state events affecting this character up to currentEpisode
      const events = bible.listStateEvents({ seriesId, entityType: "character", entityId: c.id });
      const pastEvents = events.filter((e) => e.episode_number <= currentEpisode);

      const wounds: string[] = [];
      let damage: CharacterEvolutionState["wardrobeDamage"] = "pristine";
      let disposition = "Bình thản";

      for (const ev of pastEvents) {
        if (ev.event_type === "status_change") {
          let state: Record<string, unknown> = {};
          try {
            const parsed = JSON.parse(ev.to_state_json);
            if (parsed && typeof parsed === "object") state = parsed as Record<string, unknown>;
          } catch { state = {}; /* Legacy state events may contain a plain status string. */ }

          const wound = state.distinguishing_marks ?? state.wound ?? state.injury;
          if (typeof wound === "string" && wound.trim()) {
            wounds.push(wound.trim());
            damage = "torn";
          } else if (/(?:vết thương|wound|injur)/iu.test(ev.to_state_json)) {
            wounds.push(ev.to_state_json);
            damage = "torn";
          }

          const wardrobeDamage = state.wardrobeDamage ?? state.wardrobe_damage;
          if (wardrobeDamage === "pristine" || wardrobeDamage === "weathered" || wardrobeDamage === "torn" || wardrobeDamage === "heavily_damaged") {
            damage = wardrobeDamage;
          }

          const currentDisposition = state.disposition ?? state.mood ?? state.status;
          if (typeof currentDisposition === "string") disposition = currentDisposition;
          else if (Object.keys(state).length === 0) disposition = ev.to_state_json;
        }
      }

      // Check current held props
      const heldProps = props.filter((p) => p.current_holder_id === c.id).map((p) => p.name);

      // Known secrets
      const knowledge = bible.getCharacterKnowledge(c.id, currentEpisode);
      const knownSecrets = knowledge.map((k) => k.fact_key);

      return {
        characterId: c.id,
        characterName: c.name,
        wounds,
        wardrobeStyle: c.current_wardrobe_id || "Trang phục tiêu chuẩn",
        wardrobeDamage: damage,
        psychologicalDisposition: disposition,
        knownSecrets,
        heldProps,
      };
    });

    const activeGuns = chekhovGuns.map((g) => {
      const isDue = g.payoff_episode ? g.payoff_episode <= currentEpisode + 1 : false;
      return {
        id: g.id,
        description: g.description,
        plantedEpisode: g.planted_at_episode,
        isDueForPayoff: isDue,
      };
    });

    return {
      seriesId,
      fromEpisode: currentEpisode,
      toEpisode: currentEpisode + 1,
      timestamp: new Date().toISOString(),
      characters: characterStates,
      activeChekhovGuns: activeGuns,
      worldStateSummary: {
        episodeConcluded: currentEpisode,
        totalActiveCharacters: characters.filter((c) => c.status !== "deceased").length,
      },
    };
  }

  /**
   * Injects cross-episode character continuity prompts into screenplay context.
   */
  public static formatContinuityContextPrompt(snapshot: CrossEpisodeStateSnapshot): string {
    const lines: string[] = [];
    lines.push(`=== TÍNH LIÊN TỤC TRẠNG THÁI XUYÊN TẬP (TỪ TẬP ${snapshot.fromEpisode} SANG TẬP ${snapshot.toEpisode}) ===`);

    for (const c of snapshot.characters) {
      const woundText = c.wounds.length > 0 ? `Vết thương còn lại: [${c.wounds.join("; ")}]` : "Không có thương tích";
      const propText = c.heldProps.length > 0 ? `Đang giữ đạo cụ: [${c.heldProps.join(", ")}]` : "Không giữ đạo cụ quan trọng";
      const damText = c.wardrobeDamage !== "pristine" ? `Trang phục: ${c.wardrobeStyle} (Tình trạng: ${c.wardrobeDamage})` : `Trang phục: ${c.wardrobeStyle}`;

      lines.push(`• Nhân vật ${c.characterName}:`);
      lines.push(`   - ${woundText}`);
      lines.push(`   - ${damText}`);
      lines.push(`   - Tâm lý/Cảm xúc hiện tại: ${c.psychologicalDisposition}`);
      lines.push(`   - ${propText}`);
    }

    const dueGuns = snapshot.activeChekhovGuns.filter((g) => g.isDueForPayoff);
    if (dueGuns.length > 0) {
      lines.push(`\n=== CHI TIẾT SÚNG CHEKHOV CẦN ĐƯỢC GIẢI QUYẾT TRONG TẬP NÀY ===`);
      for (const g of dueGuns) {
        lines.push(`* [${g.id}]: ${g.description} (Đã cài cắm từ Tập ${g.plantedEpisode})`);
      }
    }

    return lines.join("\n");
  }
}
