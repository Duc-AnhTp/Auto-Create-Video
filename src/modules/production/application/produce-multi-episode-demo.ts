import type {MultiEpisodeDemoStore} from '../ports/multi-episode-demo-store.js';
import { WorkflowError } from "../../../platform/workflow-error.js";

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { SeasonArcController, type EpisodePacingProfile, type CrossEpisodeStateSnapshot } from "../domain/season-arc-controller.js";
import { SeasonBudgetAllocator, type SeasonBudgetPlan } from "../domain/season-budget-allocator.js";
import { CanonInvariantValidator, AutoBridgeGenerator } from "../../story/index.js";

import { CharacterTurnaroundBridge } from "./character-turnaround-bridge.js";
import { CinematicPostPipeline } from "../../media/index.js";
import { sceneLightingMatcher_harmonizeScene } from "../../media/index.js";
import { emotionalVoiceController_generateSettings } from "../../media/index.js";

import { lipSyncEngine_alignLipSync } from "../../media/index.js";
import { SeasonTrailerAutoCutter, type TrailerAutoCutResult } from "../../media/index.js";
import { createValidMockMp4File } from "../../media/index.js";
import { log } from "../../../platform/observability/logger.js";

export interface MultiEpisodeRunnerOptions {
  seriesId: string;
  totalEpisodes?: number;
  fromEpisode?: number;
  toEpisode?: number;
  seasonBudgetUsd?: number;
  outputBaseDir?: string;
  provider?: string;
  mockVideo?: boolean;
  enable4kPost?: boolean;
  enableAutoBridge?: boolean;
  enableLightingHarmonization?: boolean;
  enableEmotionalVoice?: boolean;
  enableLipSync?: boolean;
  generateSeasonTrailer?: boolean;
  trailerTargetDurationSec?: 30 | 60 | 90;
  trailerTagline?: string;
  customChapterTitles?: string[];
  customNovelTexts?: string[];
}

export interface EpisodeProductionRecord {
  episodeNumber: number;
  title: string;
  act: string;
  tensionScore: number;
  allocatedBudgetUsd: number;
  actualSpentUsd: number;
  status: "SUCCESS" | "WARN" | "FAIL" | "SKIPPED";
  canonViolationsCount: number;
  autoBridgeApplied: boolean;
  masterVideoPath?: string;
  final4kDeliveryPath?: string;
  lightingHarmonized?: boolean;
  lipSyncAligned?: boolean;
  durationSec: number;
  crossEpisodeState: CrossEpisodeStateSnapshot;
}

export interface SeasonProductionManifest {
  isMock: boolean;
  seriesId: string;
  timestamp: string;
  totalEpisodes: number;
  completedEpisodes: number;
  seasonBudget: SeasonBudgetPlan;
  episodes: EpisodeProductionRecord[];
  trailerResult?: TrailerAutoCutResult;
  manifestPath: string;
}

/**
 * Multi-Episode Season Production Runner.
 *
 * Coordinates continuous, automated multi-episode season production batches:
 * 1. Plans Season 3-Act Narrative Arc & Pacing Curves.
 * 2. Dynamically allocates Season Budget quotas per episode based on dramatic tension.
 * 3. Enforces Cross-Episode State Transfer (wounds, wardrobe degradation, prop custody).
 * 4. Executes Pre-Execution Canon Invariant Validation & Auto-Bridge Healing.
 * 5. Runs Multi-Angle Turnaround Pack Anchoring & Video Generation.
 * 6. Executes 4K Super-Resolution, CDL Grading & Broadcast QC Conformance.
 * 7. Records budget spend, reallocates surplus, and advances narrative continuity.
 */
export class ProduceMultiEpisodeDemo {
  private bible: MultiEpisodeDemoStore;

  constructor(bible:MultiEpisodeDemoStore){this.bible=bible;}

  public getBible(): MultiEpisodeDemoStore {
    return this.bible;
  }

  /**
   * Releases resources and closes Story Bible database handle.
   */
  

  /**
   * Executes multi-episode batch season production.
   */
  public async runSeason(options: MultiEpisodeRunnerOptions): Promise<SeasonProductionManifest> {
    if (!options.mockVideo && process.env.NODE_ENV !== "test") throw new WorkflowError("DEMO_ONLY", "DEMO_ONLY: Use SeasonOrchestrator for production", "failed");
    const { seriesId } = options;
    const totalEpisodes = options.totalEpisodes || 5;
    const fromEp = options.fromEpisode || 1;
    const toEp = options.toEpisode || totalEpisodes;
    const seasonBudgetUsd = options.seasonBudgetUsd || 100.0;
    const outputBase = options.outputBaseDir || join("data", "series", seriesId, "season_production");
    await mkdir(outputBase, { recursive: true });

    log.info(`[MULTI-EPISODE RUNNER] Khởi chạy sản xuất Mùa Phim cho Series [${seriesId}] (Tập ${fromEp} -> ${toEp} / Tổng ${totalEpisodes} tập)...`);

    // Ensure series metadata
    let meta = this.bible.getSeriesMetadata(seriesId);
    if (!meta) {
      this.bible.upsertSeriesMetadata({
        id: seriesId,
        title: `Series ${seriesId}`,
        aspect_ratio: "16:9",
        visual_style: "Cinematic 35mm Hollywood standard",
      });
      meta = this.bible.getSeriesMetadata(seriesId);
    }

    // 1. Plan Season Narrative Arc & Dynamic Budget Distribution
    let budgetPlan = SeasonBudgetAllocator.planSeasonBudget(seriesId, seasonBudgetUsd, totalEpisodes);
    const episodeRecords: EpisodeProductionRecord[] = [];

    // Ensure characters exist in Story Bible
    const chars = this.bible.listCharacters(seriesId);
    if (chars.length === 0) {
      this.bible.upsertCharacter({
        id: `char_${seriesId}_lead`,
        name: "Minh",
        series_id: seriesId,
        role: "protagonist",
        visual_summary: "Áo khoác da đen, quần rằn ri",
      });
      this.bible.upsertCharacter({
        id: `char_${seriesId}_ally`,
        name: "Lan",
        series_id: seriesId,
        role: "supporting",
        visual_summary: "Trang phục chiến thuật màu xám",
      });
    }

    let priorStateSnapshot: CrossEpisodeStateSnapshot | null = null;

    // 2. Continuous Multi-Episode Production Loop
    for (let epNum = fromEp; epNum <= toEp; epNum++) {
      const pacing = SeasonArcController.getEpisodePacingProfile(epNum, totalEpisodes);
      const quota = budgetPlan.episodes.find((e) => e.episodeNumber === epNum);
      const allocatedBudget = quota?.allocatedUsd || 10.0;

      const epTitle =
        options.customChapterTitles?.[epNum - 1] ||
        `Tập ${epNum}: ${pacing.act === "midpoint_reversal" ? "Khúc Quanh Chấn Động" : pacing.act === "act_3_climax" ? "Trận Đánh Quyết Định" : "Hành Trình Bắt Đầu"}`;

      log.info(`\n============================================================`);
      log.info(`[MULTI-EPISODE RUNNER] 🎬 Đang sản xuất Tập ${epNum}/${totalEpisodes}: "${epTitle}"`);
      log.info(`  • Hồi cốt truyện: [${pacing.act}] | Điểm kịch tính (Tension): ${pacing.tensionScore}/1.0`);
      log.info(`  • Hạn mức ngân sách tập: $${allocatedBudget.toFixed(2)} USD`);
      log.info(`============================================================`);

      const epOutputDir = join(outputBase, `ep_${String(epNum).padStart(2, "0")}`);
      await mkdir(epOutputDir, { recursive: true });

      // ── Step A: Cross-Episode State Propagation ──
      if (epNum > 1 && !priorStateSnapshot) {
        priorStateSnapshot = SeasonArcController.extractCrossEpisodeState(this.bible, seriesId, epNum - 1);
      }

      let continuityContext = "";
      if (priorStateSnapshot) {
        continuityContext = SeasonArcController.formatContinuityContextPrompt(priorStateSnapshot);
      }

      // ── Step B: Screenplay Synthesis & Canon Invariant Validation ──
      const rawScript = this.generateEpisodeScreenplay(epTitle, epNum, pacing, continuityContext);
      let validation = CanonInvariantValidator.validate(rawScript, this.bible, seriesId, epNum);
      let autoBridgeApplied = false;
      let finalScript = rawScript;

      if (validation.status !== "PASS" && options.enableAutoBridge !== false && validation.repairableCount > 0) {
        log.info(`[MULTI-EPISODE RUNNER] Tự động khắc phục vi phạm Canon bằng Phân Cảnh Bắc Cầu cho Tập ${epNum}...`);
        const repairRes = AutoBridgeGenerator.validateAndAutoRepair(rawScript, this.bible, seriesId, epNum, {
          persistToBible: false,
        });
        finalScript = repairRes.repairedScript;
        validation = repairRes.validationReport;
        autoBridgeApplied = repairRes.appliedBridges.length > 0;
      }

      await writeFile(join(epOutputDir, "screenplay.txt"), finalScript, "utf8");

      // ── Step C: Multi-Angle Turnaround Anchoring & Video Generation ──
      const allChars = this.bible.listCharacters(seriesId);
      for (const char of allChars) {
        await CharacterTurnaroundBridge.getOrGenerateTurnaroundPack(char.id, seriesId, this.bible, {
          autoGenerate: true,
          provider: "mock",
          allowMock: true,
          outputDir: join(outputBase, "turnaround_packs", char.id),
        });
      }

      const masterVideoPath = join(epOutputDir, `master_ep_${epNum}.mp4`);
      const plannedDurationSec = pacing.actionDensity === "peak" ? 18 : 15;
      await createValidMockMp4File(masterVideoPath, plannedDurationSec);

      // ── Step D: Neural Emotional Dialogue & Lip-Sync Alignment ──
      let lipSyncAligned = false;
      if (options.enableEmotionalVoice !== false) {
        log.info(`[MULTI-EPISODE RUNNER] Tối ưu hóa SSML thoại cảm xúc & Khớp khẩu hình Lip-Sync cho Tập ${epNum}...`);
        const leadChar = allChars[0];
        const dialogueText = `Chúng ta không thể lùi bước trong cuộc chiến Tập ${epNum}!`;

        const voiceSettings = emotionalVoiceController_generateSettings(dialogueText, {
          characterName: leadChar?.name || "Minh",
          characterRole: "protagonist",
          sceneTensionScore: pacing.tensionScore,
        });

        const dialogueAudioPath = join(epOutputDir, "mock_dialogue.mp3");
        const lipSyncRes = await lipSyncEngine_alignLipSync(
          masterVideoPath,
          dialogueAudioPath,
          dialogueText,
          join(epOutputDir, "lipsync_lead_cu.mp4"),
          { allowMockFallback: true, fps: 24 }
        );
        lipSyncAligned = lipSyncRes.syncConfidenceScore > 0.85;
      }

      // ── Step E: Scene-to-Scene Visual Style Transfer & Lighting Harmonization ──
      let lightingHarmonized = false;
      if (options.enableLightingHarmonization !== false) {
        log.info(`[MULTI-EPISODE RUNNER] Đồng nhất ánh sáng & Color Match CDF cho các cú máy Tập ${epNum}...`);
        const lightingRes = sceneLightingMatcher_harmonizeScene({
          sceneId: `scene_ep${epNum}_main`,
          targetEnvironmentPreset: pacing.tensionScore > 0.8 ? "cyberpunk_night" : "golden_hour",
          keyLightAzimuthDeg: pacing.tensionScore > 0.8 ? -60 : 45,
          keyLightElevationDeg: 30,
          shots: [
            { shotId: `ep${epNum}_shot_1_wide`, shotType: "establishing", averageRgb: [180, 140, 95] },
            { shotId: `ep${epNum}_shot_2_two`, shotType: "two_shot", averageRgb: [175, 138, 98] },
            { shotId: `ep${epNum}_shot_3_ots_ab`, shotType: "ots_a_b", averageRgb: [165, 145, 120] },
            { shotId: `ep${epNum}_shot_4_ots_ba`, shotType: "ots_b_a", averageRgb: [170, 142, 115] },
            { shotId: `ep${epNum}_shot_5_cu`, shotType: "close_up", averageRgb: [160, 130, 90] },
          ],
        });
        lightingHarmonized = lightingRes.sceneConsistencyScore > 0.8;
      }

      // ── Step F: 4K Post-Processing Pipeline (Option 2 Integration) ──
      let final4kPath: string | undefined;
      if (options.enable4kPost !== false) {
        const postRes = await CinematicPostPipeline.executePostPipeline({
          seriesId,
          episodeNumber: epNum,
          inputMasterVideoPath: masterVideoPath,
          outputDir: join(epOutputDir, "4k_cinematic_post"),
          resolutionStandard: "4k",
          aspectRatio: "16:9",
          filmGrainIntensity: 0.15,
          cdlPreset: pacing.tensionScore > 0.8 ? "teal_orange" : "kodak_2383",
          enableSpatialFoley: true,
          enableBroadcastConformance: true,
          mockFallback: true,
        });
        final4kPath = postRes.artifacts.finalDeliveryMasterPath;
      }

      // ── Step G: Calculate Spend & Update Cross-Episode State ──
      // In production/mock, calculate actual spend based on shots and tension
      const actualSpend = 0;
      budgetPlan = SeasonBudgetAllocator.recordEpisodeSpend(budgetPlan, epNum, actualSpend);

      // Simulate narrative evolution: in climax/intense episodes, record character wound/damage
      if (pacing.tensionScore >= 0.85 && allChars[0]) {
        // Demo narrative state remains isolated from production canon.

      }

      // Snapshot state for next episode
      priorStateSnapshot = SeasonArcController.extractCrossEpisodeState(this.bible, seriesId, epNum);

      episodeRecords.push({
        episodeNumber: epNum,
        title: epTitle,
        act: pacing.act,
        tensionScore: pacing.tensionScore,
        allocatedBudgetUsd: allocatedBudget,
        actualSpentUsd: actualSpend,
        status: validation.fatalCount > 0 ? "FAIL" : validation.violations.length > 0 ? "WARN" : "SUCCESS",
        canonViolationsCount: validation.violations.length,
        autoBridgeApplied,
        masterVideoPath,
        final4kDeliveryPath: final4kPath,
        lightingHarmonized,
        lipSyncAligned,
        durationSec: plannedDurationSec,
        crossEpisodeState: priorStateSnapshot,
      });

      log.info(`[MULTI-EPISODE RUNNER] ✓ Hoàn thành sản xuất Tập ${epNum}. Đã chi: $${actualSpend} USD.`);
    }

    // ── Step H: Season Trailer Auto-Cut ──
    let trailerResult: TrailerAutoCutResult | undefined;
    if (options.generateSeasonTrailer !== false) {
      log.info(`\n============================================================`);
      log.info(`[MULTI-EPISODE RUNNER] 🎞️ Khởi động Trình Cắt Ghép Trailer Teaser Mùa Phim (60s)...`);
      log.info(`============================================================`);

      const candidates = SeasonTrailerAutoCutter.extractCandidatesFromEpisodes(episodeRecords);
      trailerResult = await SeasonTrailerAutoCutter.generateSeasonTrailer(candidates, {
        seriesId,
        seriesTitle: meta?.title || `Series ${seriesId}`,
        tagline: options.trailerTagline || "Định Mệnh Đã Được Định Đoạt",
        targetDurationSec: options.trailerTargetDurationSec || 60,
        outputDir: join(outputBase, "season_trailer"),
        mockVideo: true,
      });
    }

    const manifestPath = join(outputBase, "season_manifest.json");
    const manifest: SeasonProductionManifest = {
      seriesId,
      isMock: true,
      timestamp: new Date().toISOString(),
      totalEpisodes,
      completedEpisodes: episodeRecords.length,
      seasonBudget: budgetPlan,
      episodes: episodeRecords,
      trailerResult,
      manifestPath,
    };

    await writeFile(manifestPath, JSON.stringify(manifest, null, 2), "utf8");
    log.info(`\n🎉 [MULTI-EPISODE RUNNER] Đã hoàn tất sản xuất toàn bộ Mùa Phim (${episodeRecords.length} tập)!`);
    log.info(`  • Tổng chi phí thực tế: $${budgetPlan.totalSpentUsd} / $${seasonBudgetUsd} USD.`);
    log.info(`  • Hồ sơ Mùa Phim lưu tại: ${manifestPath}`);

    return manifest;
  }

  /**
   * Helper: Formats episode screenplay adhering to the pacing profile and continuity context.
   */
  private generateEpisodeScreenplay(
    title: string,
    episodeNumber: number,
    pacing: EpisodePacingProfile,
    continuityContext: string
  ): string {
    return `
TIÊU ĐỀ TẬP: ${title.toUpperCase()}
HỒI CỐT TRUYỆN: ${pacing.act.toUpperCase()} (Tension: ${pacing.tensionScore})

${continuityContext}

CẢNH 1: KHỞI ĐẦU PHÂN ĐOẠN - NGÀY
[establishing] Không gian mở ra với nhịp điệu ${pacing.actionDensity}.
Minh xuất hiện trong trang phục sẵn sàng chiến đấu.
MINH: Chúng ta không thể lùi bước ở tập này.

CẢNH 2: TÂM ĐIỂM HÀNH ĐỘNG - ĐÊM
Lan tiếp cận Minh với tín hiệu cảnh báo.
LAN: Đội tuần tra đối phương đang ập tới.
${pacing.tensionScore >= 0.85 ? "[climax] Trận phục kích bùng nổ dữ dội!" : "Hai bên trao đổi thông tin bí mật."}
    `.trim();
  }
}
