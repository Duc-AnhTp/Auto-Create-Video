import type {
  BibleManager,
  SeriesPlanRecord,
  PlannedEpisodeRecord,
  CoverageLedgerRecord,
  SourceWorkRecord,
  SourceUnitRecord,
  StoryBeatRecord,
  StoryThreadRecord,
  CharacterRecord,
} from "../bible/bible-manager.js";
import { CoverageLedgerManager, type AdaptationDecision } from "./coverage-ledger.js";

export type PacingPreset = "fast" | "standard" | "contemplative";

export interface PacingProfile {
  preset: PacingPreset;
  targetDurationPerEpisodeSec: number;
  averageShotDurationSec: number;
  estimatedScenesPerEpisode: number;
  estimatedShotsPerScene: number;
  beatsPerEpisodeRecommendation: number;
}

export const PACING_PROFILES: Record<PacingPreset, PacingProfile> = {
  fast: {
    preset: "fast",
    targetDurationPerEpisodeSec: 90,
    averageShotDurationSec: 3.5,
    estimatedScenesPerEpisode: 4,
    estimatedShotsPerScene: 4,
    beatsPerEpisodeRecommendation: 5,
  },
  standard: {
    preset: "standard",
    targetDurationPerEpisodeSec: 150,
    averageShotDurationSec: 4.5,
    estimatedScenesPerEpisode: 3,
    estimatedShotsPerScene: 4,
    beatsPerEpisodeRecommendation: 3,
  },
  contemplative: {
    preset: "contemplative",
    targetDurationPerEpisodeSec: 240,
    averageShotDurationSec: 6.0,
    estimatedScenesPerEpisode: 3,
    estimatedShotsPerScene: 3,
    beatsPerEpisodeRecommendation: 2,
  },
};

export interface SeriesPlannerOptions {
  seriesId: string;
  sourceId: string;
  planId?: string;
  revision?: number;
  targetEpisodes?: number;
  targetDurationPerEpisodeSec?: number;
  targetTotalDurationSec?: number;
  pacingPreset?: PacingPreset;
  status?: "draft" | "approved" | "active" | "stale";
}

export interface PlanGenerationResult {
  plan: SeriesPlanRecord;
  episodes: PlannedEpisodeRecord[];
  coverageLedgers: CoverageLedgerRecord[];
  warnings: string[];
  suggestedAdjustments?: string[];
  summary: {
    totalUnits: number;
    totalBeats: number;
    totalMandatoryBeats: number;
    pacingPreset: PacingPreset;
    targetEpisodes: number;
    estimatedTotalDurationSec: number;
  };
}

/**
 * SeriesPlanner
 *
 * Engine for multi-episode adaptation planning. Takes master source works,
 * structural units, and story beats, and intelligently partitions them into
 * a cinematic series plan with coherent narrative arcs (goal, opening, development,
 * climax, ending), cross-episode state continuity, and coverage accounting.
 */
export class SeriesPlanner {
  private bible: BibleManager;

  constructor(bible: BibleManager) {
    this.bible = bible;
  }

  /**
   * Plans the complete series adaptation and persists plan, episodes,
   * and coverage ledger records in the Story Bible.
   */
  public async planSeries(options: SeriesPlannerOptions): Promise<PlanGenerationResult> {
    const { seriesId, sourceId } = options;
    const sourceWork = this.bible.getSourceWork(sourceId);
    if (!sourceWork) {
      throw new Error(`Source work '${sourceId}' not found in Story Bible.`);
    }

    const units = this.bible.listSourceUnits(sourceId);
    if (units.length === 0) {
      throw new Error(`Source work '${sourceId}' contains no indexed source units.`);
    }

    const beats = this.bible.listStoryBeats(seriesId);
    const threads = this.bible.listStoryThreads(seriesId);
    const characters = this.bible.listCharacters(seriesId);

    const warnings: string[] = [];
    const suggestedAdjustments: string[] = [];

    // 1. Determine Pacing and Episode Count
    const pacingPreset: PacingPreset = options.pacingPreset || "standard";
    const pacingProfile = PACING_PROFILES[pacingPreset];

    let targetDurationSec =
      options.targetDurationPerEpisodeSec || pacingProfile.targetDurationPerEpisodeSec;

    let targetEpisodes = options.targetEpisodes;

    if (!targetEpisodes) {
      if (options.targetTotalDurationSec && options.targetTotalDurationSec > 0) {
        targetEpisodes = Math.max(
          1,
          Math.round(options.targetTotalDurationSec / targetDurationSec)
        );
      } else {
        // Recommend episode count based on source units & mandatory beats
        const mandatoryBeats = beats.filter((b) => b.is_mandatory === 1);
        const beatWeight = mandatoryBeats.length > 0 ? mandatoryBeats.length : beats.length;
        const unitWeight = units.length;
        const estimatedCount = Math.max(
          1,
          Math.ceil(
            Math.max(unitWeight * 0.7, beatWeight / pacingProfile.beatsPerEpisodeRecommendation)
          )
        );
        targetEpisodes = Math.min(Math.max(estimatedCount, 1), 24);
      }
    }

    // Check compression/duration conflicts
    if (units.length >= 6 && targetEpisodes <= 2) {
      warnings.push(
        `High compression: ${units.length} chapters condensed into ${targetEpisodes} episodes. Subplots may need aggressive trimming.`
      );
      suggestedAdjustments.push(
        `Consider expanding to ${Math.min(units.length, 6)} episodes for better narrative breathing room.`
      );
    }

    const mandatoryBeats = beats.filter((b) => b.is_mandatory === 1);
    if (mandatoryBeats.length > targetEpisodes * 6) {
      warnings.push(
        `Dense narrative: ${mandatoryBeats.length} mandatory beats across ${targetEpisodes} episodes (~${(
          mandatoryBeats.length / targetEpisodes
        ).toFixed(1)} beats/ep) exceeds recommended ${pacingProfile.beatsPerEpisodeRecommendation} beats/ep for ${pacingPreset} pacing.`
      );
      suggestedAdjustments.push(
        `Increase target duration from ${targetDurationSec}s to ${Math.round(
          targetDurationSec * 1.5
        )}s or add more episodes.`
      );
    }

    const planId = options.planId || `plan_${seriesId}_${Date.now().toString(36)}`;
    const revision = options.revision || 1;

    // 2. Distribute Units and Beats across Episodes
    const episodeAllocations = this.allocateUnitsToEpisodes(units, targetEpisodes);

    // 3. Build Episode Arcs and State Transitions
    const plannedEpisodes: PlannedEpisodeRecord[] = [];
    const coverageEntries: Array<Omit<CoverageLedgerRecord, "id" | "created_at">> = [];

    let currentState: Record<string, unknown> = {
      world_status: "established",
      known_characters: characters.map((c) => c.name),
      unresolved_threads: threads.filter((t) => t.status === "open").map((t) => t.id),
      active_locations: [],
    };

    for (let epIndex = 0; epIndex < targetEpisodes; epIndex++) {
      const episodeNumber = epIndex + 1;
      const allocatedUnits = episodeAllocations[epIndex] || [];
      const unitIds = allocatedUnits.map((u) => u.id);

      // Collect beats within these units
      const episodeBeats = beats.filter(
        (b) => b.source_unit_id && unitIds.includes(b.source_unit_id)
      );

      // Structural Arcs (Goal, Opening, Development, Climax, Ending)
      const arc = this.synthesizeEpisodeArc({
        episodeNumber,
        totalEpisodes: targetEpisodes,
        allocatedUnits,
        beats: episodeBeats,
        characters,
        sourceWork,
      });

      // Calculate state changes
      const stateOut: Record<string, unknown> = {
        ...currentState,
        episode_completed: episodeNumber,
        resolved_beats: episodeBeats.map((b) => b.id),
        story_milestone: arc.ending,
      };

      const plannedEpId = `plan_ep_${planId}_e${String(episodeNumber).padStart(2, "0")}`;

      const plannedEp: PlannedEpisodeRecord = {
        id: plannedEpId,
        plan_id: planId,
        series_id: seriesId,
        episode_number: episodeNumber,
        title: arc.title,
        logline: arc.logline,
        goal: arc.goal,
        opening: arc.opening,
        development: arc.development,
        climax: arc.climax,
        ending: arc.ending,
        target_duration_sec: targetDurationSec,
        state_in_json: JSON.stringify(currentState),
        planned_state_out_json: JSON.stringify(stateOut),
        dependencies_json: JSON.stringify(
          episodeNumber > 1
            ? [`plan_ep_${planId}_e${String(episodeNumber - 1).padStart(2, "0")}`]
            : []
        ),
        estimated_scenes: pacingProfile.estimatedScenesPerEpisode,
        estimated_shots:
          pacingProfile.estimatedScenesPerEpisode * pacingProfile.estimatedShotsPerScene,
        created_at: new Date().toISOString(),
      };

      plannedEpisodes.push(plannedEp);

      // Record coverage for each allocated unit
      for (const unit of allocatedUnits) {
        let decision: AdaptationDecision = "kept";
        let rationale = `Đưa chương '${unit.title}' vào Tập ${episodeNumber}.`;

        if (allocatedUnits.length > 1) {
          decision = "compressed";
          rationale = `Cô đọng nội dung chương '${unit.title}' để kết hợp vào Tập ${episodeNumber} (${allocatedUnits.length} chương/tập).`;
        } else if (targetEpisodes > units.length) {
          decision = "expanded";
          rationale = `Mở rộng chi tiết điện ảnh cho chương '${unit.title}' trong Tập ${episodeNumber}.`;
        }

        coverageEntries.push({
          plan_id: planId,
          series_id: seriesId,
          source_id: sourceId,
          source_unit_id: unit.id,
          source_block_id: null,
          episode_number: episodeNumber,
          scene_number: null,
          adaptation_decision: decision,
          rationale,
          mandatory_beat_id: null,
        });
      }

      // Record coverage for all beats in this episode
      for (const b of episodeBeats) {
        coverageEntries.push({
          plan_id: planId,
          series_id: seriesId,
          source_id: sourceId,
          source_unit_id: b.source_unit_id || allocatedUnits[0]?.id || "unknown",
          source_block_id: null,
          episode_number: episodeNumber,
          scene_number: null,
          adaptation_decision: "kept",
          rationale: `Chuyển thể beat '${b.name}' vào Tập ${episodeNumber}.`,
          mandatory_beat_id: b.id,
        });
      }

      // Transition state for next episode
      currentState = stateOut;
    }

    // 4. Create Plan Record
    const planRecord: SeriesPlanRecord = {
      id: planId,
      series_id: seriesId,
      source_id: sourceId,
      revision,
      target_episodes: targetEpisodes,
      target_duration_per_episode_sec: targetDurationSec,
      pacing_preset: pacingPreset,
      status: options.status || "draft",
      warnings_json: JSON.stringify(warnings),
      summary_json: JSON.stringify({
        totalUnits: units.length,
        totalBeats: beats.length,
        totalMandatoryBeats: mandatoryBeats.length,
        estimatedTotalDurationSec: targetEpisodes * targetDurationSec,
        suggestedAdjustments,
      }),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    // 5. Persist Plan, Episodes, and Coverage Ledgers in SQLite
    this.bible.upsertSeriesPlan(planRecord);
    this.bible.batchUpsertPlannedEpisodes(plannedEpisodes);
    const recordedLedgers = CoverageLedgerManager.batchRecordEntries(
      this.bible,
      coverageEntries
    );

    return {
      plan: planRecord,
      episodes: plannedEpisodes,
      coverageLedgers: recordedLedgers,
      warnings,
      suggestedAdjustments,
      summary: {
        totalUnits: units.length,
        totalBeats: beats.length,
        totalMandatoryBeats: mandatoryBeats.length,
        pacingPreset,
        targetEpisodes,
        estimatedTotalDurationSec: targetEpisodes * targetDurationSec,
      },
    };
  }

  /**
   * Allocates units into N episodes sequentially.
   * Guarantees that EVERY unit is assigned to at least one episode,
   * and the final unit is always allocated to the final episode (zero silent drop).
   */
  private allocateUnitsToEpisodes(
    units: SourceUnitRecord[],
    targetEpisodes: number
  ): SourceUnitRecord[][] {
    const allocations: SourceUnitRecord[][] = Array.from(
      { length: targetEpisodes },
      () => []
    );

    if (units.length === 0) return allocations;

    if (units.length <= targetEpisodes) {
      // More episodes than or equal to units:
      // Map 1 unit per episode until units exhausted, distribute evenly
      for (let u = 0; u < units.length; u++) {
        allocations[u].push(units[u]);
      }
      // If remaining episodes, link final unit or distribute expansion
      for (let e = units.length; e < targetEpisodes; e++) {
        allocations[e].push(units[units.length - 1]);
      }
      return allocations;
    }

    // More units than episodes: partition units monotonically
    const baseChunkSize = Math.floor(units.length / targetEpisodes);
    const remainder = units.length % targetEpisodes;

    let unitIdx = 0;
    for (let ep = 0; ep < targetEpisodes; ep++) {
      const chunkSize = baseChunkSize + (ep < remainder ? 1 : 0);
      for (let c = 0; c < chunkSize && unitIdx < units.length; c++) {
        allocations[ep].push(units[unitIdx]);
        unitIdx++;
      }
    }

    // Safety check: ensure the last unit is definitely in the last episode
    const lastUnit = units[units.length - 1];
    if (!allocations[targetEpisodes - 1].some((u) => u.id === lastUnit.id)) {
      allocations[targetEpisodes - 1].push(lastUnit);
    }

    return allocations;
  }

  /**
   * Synthesizes a structured episodic arc (Goal, Opening, Development, Climax, Ending).
   */
  private synthesizeEpisodeArc(params: {
    episodeNumber: number;
    totalEpisodes: number;
    allocatedUnits: SourceUnitRecord[];
    beats: StoryBeatRecord[];
    characters: CharacterRecord[];
    sourceWork: SourceWorkRecord;
  }): {
    title: string;
    logline: string;
    goal: string;
    opening: string;
    development: string;
    climax: string;
    ending: string;
  } {
    const { episodeNumber, totalEpisodes, allocatedUnits, beats, characters, sourceWork } =
      params;

    const leadCharName = characters[0]?.name || "Nhân vật chính";
    const unitTitles = allocatedUnits.map((u) => u.title).join(", ");
    const isFirst = episodeNumber === 1;
    const isLast = episodeNumber === totalEpisodes;

    let title = `Tập ${episodeNumber}: `;
    if (allocatedUnits.length > 0) {
      title += allocatedUnits[0].title.replace(/^(Chương|Hồi|Chapter)\s+\d+[:\.\s-]*/i, "");
    } else {
      title += `Hành Trình Mới`;
    }

    let goal = "";
    let opening = "";
    let development = "";
    let climax = "";
    let ending = "";
    let logline = "";

    if (isFirst) {
      goal = `Thiết lập thế giới câu chuyện, giới thiệu ${leadCharName} và kích hoạt biến cố khởi đầu.`;
      opening = `Mở đầu không gian câu chuyện, ${leadCharName} xuất hiện giữa bối cảnh chính.`;
      development = `Biến cố bất ngờ xảy ra buộc các nhân vật phải dấn thân hành động (${unitTitles}).`;
      climax = beats[0]
        ? `Xung đột đỉnh điểm: ${beats[0].name}.`
        : `Phát hiện manh mối then chốt làm đảo lộn tình hình.`;
      ending = `Cliffhanger: Câu hỏi mở đầy kịch tính dẫn dắt sang tập kế tiếp.`;
      logline = `${leadCharName} đối mặt với biến cố đầu tiên trong '${sourceWork.title}', kích hoạt chuỗi sự kiện không thể cứu vãn.`;
    } else if (isLast) {
      goal = `Đẩy toàn bộ xung đột lên đỉnh điểm, đối đầu trực diện và giải quyết số phận các nhân vật.`;
      opening = `Căng thẳng bao trùm khi trận chiến hoặc nút thắt cuối cùng đến gần.`;
      development = `Các bí mật trong quá khứ được lật mở toàn diện (${unitTitles}).`;
      climax =
        beats.length > 0
          ? `Đại cục ngã ngũ: ${beats[beats.length - 1].name}.`
          : `Đối đầu quyết định giải quyết xung đột cốt lõi.`;
      ending = `Khép lại hồi kết của câu chuyện với dư âm cảm xúc điện ảnh.`;
      logline = `Hồi kết kịch tính cho ${leadCharName} và các nhân vật khi chân tướng toàn bộ câu chuyện '${sourceWork.title}' được phơi bày.`;
    } else {
      goal = `Đẩy mạnh điều tra/đối đầu, tăng tốc độ xung đột và làm sâu sắc mối quan hệ nhân vật.`;
      opening = `Tiếp nối hậu quả của tập trước, nhịp phim tăng dần.`;
      development = `Dấn thân vào hiểm cảnh hoặc phát hiện thêm những bất ngờ mới (${unitTitles}).`;
      climax = beats[0]
        ? `Điểm rơi kịch tính: ${beats[0].name}.`
        : `Một biến số bất ngờ thay đổi cục diện hiện tại.`;
      ending = `Khép lại phân đoạn trong sự ngờ vực hoặc một lời cảnh báo gay cấn.`;
      logline = `Trong vòng xoáy của '${sourceWork.title}', ${leadCharName} dấn sâu vào thử thách cam go hơn.`;
    }

    return {
      title,
      logline,
      goal,
      opening,
      development,
      climax,
      ending,
    };
  }
}
