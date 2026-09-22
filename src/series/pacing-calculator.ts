import type { EpisodicScript, Scene, Shot } from "./series-schema.js";
import type { UnifiedTimeline } from "./timeline-schema.js";

export interface ScenePacingMetrics {
  sceneId: string;
  sceneNumber: number;
  shotCount: number;
  totalDurationSec: number;
  averageShotDurationSec: number;
  cutsPerMinute: number;
  estimatedTension: number; // 0.0 to 1.0
  pacingCategory: "rapid_action" | "conversational" | "atmospheric_slow";
}

export interface EpisodePacingReport {
  episodeNumber: number;
  totalShots: number;
  totalDurationSec: number;
  overallAverageShotDurationSec: number;
  overallCutsPerMinute: number;
  sceneMetrics: ScenePacingMetrics[];
  pacingDynamismScore: number; // 0.0 (flat) to 1.0 (dynamic rollercoaster)
  warnings: string[];
}

/**
 * Dynamic Visual Pacing & Tension Calculator (Giai Đoạn 2: Visual Pacing Engine)
 *
 * Quantifies film editing rhythm, cuts-per-minute (CPM), average shot duration (ASD),
 * and tension curves to guarantee broadcast-level narrative engagement.
 */
export class DynamicPacingCalculator {
  /**
   * Analyzes an EpisodicScript and generates an EpisodePacingReport.
   */
  public static analyzeScriptPacing(script: EpisodicScript): EpisodePacingReport {
    let totalShots = 0;
    let totalDurationSec = 0;
    const sceneMetrics: ScenePacingMetrics[] = [];
    const warnings: string[] = [];

    for (let i = 0; i < script.scenes.length; i++) {
      const scene = script.scenes[i];
      const shotCount = scene.shots.length;
      let sceneDur = 0;
      for (const s of scene.shots) {
        sceneDur += s.durationSec || 4.0;
      }

      totalShots += shotCount;
      totalDurationSec += sceneDur;

      const asd = shotCount > 0 ? sceneDur / shotCount : 4.0;
      const cpm = sceneDur > 0 ? (shotCount / (sceneDur / 60)) : 15.0;

      // Estimate tension from scene mood, shot types, and position in episode
      const tension = this.calculateSceneTension(scene, i, script.scenes.length);

      let category: ScenePacingMetrics["pacingCategory"] = "conversational";
      if (asd <= 3.2 || cpm >= 18.0) {
        category = "rapid_action";
      } else if (asd >= 4.8 || cpm <= 12.0) {
        category = "atmospheric_slow";
      }

      // Check pacing mismatch warnings
      if (tension >= 0.8 && asd > 4.5) {
        warnings.push(
          `Cảnh ${scene.sceneNumber} mang tính chất cao trào (căng thẳng ${(tension * 100).toFixed(0)}%) nhưng thời lượng shot trung bình quá dài (${asd.toFixed(1)}s). Nên cắt ngắn shot dưới 3.8s để tăng kịch tính.`
        );
      }
      if (tension <= 0.4 && asd < 2.8) {
        warnings.push(
          `Cảnh ${scene.sceneNumber} là cảnh thiết lập tĩnh nhưng nhịp cắt quá dồn dập (${cpm.toFixed(1)} cuts/phút). Nên kéo dài shot để người xem tiếp thu bối cảnh.`
        );
      }

      sceneMetrics.push({
        sceneId: scene.sceneId || `sc${String(scene.sceneNumber).padStart(2, "0")}`,
        sceneNumber: scene.sceneNumber,
        shotCount,
        totalDurationSec: sceneDur,
        averageShotDurationSec: asd,
        cutsPerMinute: cpm,
        estimatedTension: tension,
        pacingCategory: category,
      });
    }

    const overallAsd = totalShots > 0 ? totalDurationSec / totalShots : 4.0;
    const overallCpm = totalDurationSec > 0 ? (totalShots / (totalDurationSec / 60)) : 15.0;

    // Calculate Pacing Dynamism (standard deviation of scene tension)
    const avgTension =
      sceneMetrics.reduce((acc, m) => acc + m.estimatedTension, 0) /
      Math.max(1, sceneMetrics.length);
    const variance =
      sceneMetrics.reduce((acc, m) => acc + Math.pow(m.estimatedTension - avgTension, 2), 0) /
      Math.max(1, sceneMetrics.length);
    const stdDev = Math.sqrt(variance);
    // Scale standard deviation to 0.0 - 1.0 (stdDev of 0.25+ is highly dynamic)
    const dynamismScore = Math.min(1.0, Math.round((stdDev / 0.3) * 100) / 100);

    return {
      episodeNumber: script.episodeNumber,
      totalShots,
      totalDurationSec,
      overallAverageShotDurationSec: Math.round(overallAsd * 100) / 100,
      overallCutsPerMinute: Math.round(overallCpm * 10) / 10,
      sceneMetrics,
      pacingDynamismScore: dynamismScore,
      warnings,
    };
  }

  /**
   * Calculates tension based on scene position, shot types, and keywords in mood/description.
   */
  public static calculateSceneTension(
    scene: Scene,
    sceneIndex: number,
    totalScenes: number
  ): number {
    let baseTension = 0.5;

    // Position weighting: climax typically at 70% - 90% of story arc
    const progress = totalScenes > 1 ? sceneIndex / (totalScenes - 1) : 0.5;
    if (progress >= 0.65 && progress <= 0.9) {
      baseTension += 0.25; // Pre-climax & Climax
    } else if (progress < 0.25) {
      baseTension -= 0.15; // Establishing Opening
    }

    // Keyword detection
    const textBlob = `${scene.locationName} ${scene.mood || ""} ${scene.description || ""}`.toLowerCase();
    if (/(?:chiến đấu|xung đột|nguy hiểm|sống còn|bùng nổ|cao trào|climax|combat|fight|crisis)/i.test(textBlob)) {
      baseTension += 0.2;
    } else if (/(?:yên ả|thanh bình|tĩnh mịch|hồi tưởng|nghỉ ngơi|calm|peaceful|quiet)/i.test(textBlob)) {
      baseTension -= 0.2;
    }

    // Shot types factor: count action/close-ups vs wide/establishing
    let actionCloseCount = 0;
    let wideEstCount = 0;
    for (const s of scene.shots) {
      if (s.shotType === "action" || s.shotType === "close_up" || s.shotType === "extreme_close_up") {
        actionCloseCount++;
      } else if (s.shotType === "establishing" || s.shotType === "wide") {
        wideEstCount++;
      }
    }

    if (scene.shots.length > 0) {
      const actionRatio = actionCloseCount / scene.shots.length;
      const wideRatio = wideEstCount / scene.shots.length;
      baseTension += actionRatio * 0.15 - wideRatio * 0.1;
    }

    return Math.max(0.1, Math.min(1.0, Math.round(baseTension * 100) / 100));
  }
}
