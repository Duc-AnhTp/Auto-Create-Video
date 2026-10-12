import type { EpisodicScript, Scene } from "../../../contracts/episode.js";


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

export interface ShortDramaHookReport {
  passed: boolean;
  firstShotDurationSec: number;
  tension: number;
  isHighImpact: boolean;
  recommendation?: string;
}

export interface PacingAnalysisOptions {
  format?: "hollywood_feature" | "short_form_vertical";
  targetEpisodeDurationSec?: number; // e.g. 60 - 90s
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
  format?: "hollywood_feature" | "short_form_vertical";
  threeSecondHook?: ShortDramaHookReport;
  retentionScore?: number; // 0.0 to 1.0 (Mobile Short-form Viewer Retention Metric)
  cliffhangerDetected?: boolean;
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
  public static analyzeScriptPacing(
    script: EpisodicScript,
    options: PacingAnalysisOptions = {}
  ): EpisodePacingReport {
    let totalShots = 0;
    let totalDurationSec = 0;
    const sceneMetrics: ScenePacingMetrics[] = [];
    const warnings: string[] = [];
    const format =
      options.format ||
      (script.aspectRatio === "9:16" ? "short_form_vertical" : "hollywood_feature");

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

    // ── SHORT-FORM VERTICAL (9:16) METRICS & 3-SECOND HOOK VALIDATION ─────────
    let hookReport: ShortDramaHookReport | undefined = undefined;
    let cliffhangerDetected = false;
    let retentionScore: number | undefined = undefined;

    if (format === "short_form_vertical") {
      // 1. Check Average Shot Duration (Sweet spot: 1.8s - 2.8s, CPM 22-32)
      if (overallAsd > 3.2) {
        warnings.push(
          `Nhịp dựng phim dọc (short-form) có thời lượng cú máy trung bình dài (${overallAsd.toFixed(1)}s). Khuyến nghị rút ngắn xuống 1.8s - 2.8s (CPM 22-32 cuts/phút) để tối ưu tỷ lệ giữ chân.`
        );
      }

      // 2. 3-Second Hook Check on First Shot
      const firstShot = script.scenes[0]?.shots[0];
      if (firstShot) {
        const firstShotDuration = firstShot.durationSec || 4.0;
        const shotType = firstShot.shotType || "establishing";
        const textBlob = `${firstShot.visualPrompt || ""} ${firstShot.dialogues?.map((d) => d.text).join(" ") || ""}`.toLowerCase();
        const isActionOrClose = shotType === "action" || shotType === "close_up" || shotType === "extreme_close_up";
        const hasPunchKeyword = /(?:sốc|bất ngờ|nguy hiểm|nổ|la hét|chạy|hành động|bí ẩn|climax|hook|kịch tính|va chạm)/i.test(textBlob);
        const isHighImpact = isActionOrClose || hasPunchKeyword;
        const hookTension = isHighImpact ? 0.85 : 0.55;
        const hookPassed = firstShotDuration <= 3.2;

        hookReport = {
          passed: hookPassed,
          firstShotDurationSec: Math.round(firstShotDuration * 100) / 100,
          tension: hookTension,
          isHighImpact,
          recommendation: hookPassed
            ? undefined
            : `Cú máy mở màn kéo dài ${firstShotDuration.toFixed(1)}s (vượt mức 3.2s). Cần cắt ngắn <= 3.2s để đạt chuẩn 3-Second Hook giữ chân người xem.`,
        };

        if (!hookPassed && hookReport.recommendation) {
          warnings.push(`⚠️ [3-SECOND HOOK]: ${hookReport.recommendation}`);
        }
      }

      // 3. Micro-Cliffhanger Check on Last Shot
      const lastScene = script.scenes[script.scenes.length - 1];
      const lastShot = lastScene?.shots[lastScene.shots.length - 1];
      if (lastShot) {
        const lastTextBlob = `${lastShot.visualPrompt || ""} ${lastShot.dialogues?.map((d) => d.text).join(" ") || ""}`.toLowerCase();
        const hasCliffhangerKeyword = /(?:ngỡ ngàng|kinh hoàng|bất ngờ|sững sờ|đột ngột|cliffhanger|tiếng thét|biến mất|ai đó|phát hiện|bí mật|bỏ ngỏ|dừng lại|cháy đen)/i.test(lastTextBlob);
        const hasQuestion = lastTextBlob.includes("?") || lastTextBlob.includes("?!");
        cliffhangerDetected = hasCliffhangerKeyword || hasQuestion || lastShot.shotType === "close_up";
      }

      // 4. Viewer Retention Metric (0.0 to 1.0)
      let score = 0.5;
      if (hookReport?.passed) score += 0.25;
      else score -= 0.15;

      if (overallAsd >= 1.8 && overallAsd <= 2.8) score += 0.2;
      else if (overallAsd <= 3.2) score += 0.1;
      else score -= 0.15;

      if (cliffhangerDetected) score += 0.1;
      score += dynamismScore * 0.1;

      retentionScore = Math.max(0.1, Math.min(1.0, Math.round(score * 100) / 100));
    }

    return {
      episodeNumber: script.episodeNumber,
      totalShots,
      totalDurationSec,
      overallAverageShotDurationSec: Math.round(overallAsd * 100) / 100,
      overallCutsPerMinute: Math.round(overallCpm * 10) / 10,
      sceneMetrics,
      pacingDynamismScore: dynamismScore,
      warnings,
      format,
      threeSecondHook: hookReport,
      retentionScore,
      cliffhangerDetected,
    };
  }

  /**
   * Convenience helper explicitly analyzing short-form drama pacing.
   */
  public static analyzeShortDramaPacing(script: EpisodicScript): EpisodePacingReport {
    return this.analyzeScriptPacing(script, { format: "short_form_vertical" });
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
