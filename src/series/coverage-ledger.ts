import type {
  BibleManager,
  CoverageLedgerRecord,
  StoryBeatRecord,
  SourceUnitRecord,
  SourceBlockRecord,
} from "../bible/bible-manager.js";

export type AdaptationDecision =
  | "kept"
  | "compressed"
  | "moved"
  | "omitted"
  | "expanded";

export interface CoverageAuditViolation {
  type: "missing_mandatory_beat" | "omitted_without_rationale" | "uncovered_unit" | "silent_ending_drop";
  entityId: string;
  name: string;
  sourceUnitId?: string | null;
  details: string;
}

export interface MandatoryBeatsVerificationResult {
  isValid: boolean;
  totalMandatoryBeats: number;
  coveredMandatoryBeats: number;
  violations: CoverageAuditViolation[];
}

export interface CoverageMetrics {
  totalUnits: number;
  coveredUnits: number;
  unitCoveragePercent: number;
  totalBlocks: number;
  coveredBlocks: number;
  blockCoveragePercent: number;
  totalBeats: number;
  coveredBeats: number;
  beatCoveragePercent: number;
  totalMandatoryBeats: number;
  coveredMandatoryBeats: number;
  mandatoryBeatsCoveragePercent: number;
  decisionBreakdown: Record<AdaptationDecision, number>;
  uncoveredUnitIds: string[];
  uncoveredBeatIds: string[];
  violations: CoverageAuditViolation[];
}

/**
 * CoverageLedgerManager
 *
 * Tracks bi-directional mapping between source material (units, blocks, beats)
 * and adaptation artifacts (planned episodes, scenes). Enforces zero unacknowledged
 * omission, requires rationales for any omitted content, and verifies 100% of
 * mandatory story beats.
 */
export class CoverageLedgerManager {
  /**
   * Records a single coverage entry into the Story Bible.
   * Enforces that an 'omitted' decision MUST provide an explanatory rationale.
   */
  public static recordEntry(
    bible: BibleManager,
    entry: Omit<CoverageLedgerRecord, "id" | "created_at"> & { id?: string }
  ): CoverageLedgerRecord {
    if (entry.adaptation_decision === "omitted" && (!entry.rationale || entry.rationale.trim().length === 0)) {
      throw new Error(
        `Coverage error: Omitted unit/block (${entry.source_unit_id}/${entry.source_block_id || "all"}) requires an explicit non-empty rationale.`
      );
    }

    const id =
      entry.id ||
      `cov_${entry.plan_id}_u${entry.source_unit_id}_ep${entry.episode_number ?? "none"}_${Math.random().toString(36).slice(2, 8)}`;

    const record: CoverageLedgerRecord = {
      id,
      plan_id: entry.plan_id,
      series_id: entry.series_id,
      source_id: entry.source_id,
      source_unit_id: entry.source_unit_id,
      source_block_id: entry.source_block_id ?? null,
      episode_number: entry.episode_number ?? null,
      scene_number: entry.scene_number ?? null,
      adaptation_decision: entry.adaptation_decision,
      rationale: entry.rationale ?? null,
      mandatory_beat_id: entry.mandatory_beat_id ?? null,
      created_at: new Date().toISOString(),
    };

    bible.upsertCoverageLedger(record);
    return record;
  }

  /**
   * Batch records multiple coverage entries into the Story Bible.
   */
  public static batchRecordEntries(
    bible: BibleManager,
    entries: Array<Omit<CoverageLedgerRecord, "id" | "created_at"> & { id?: string }>
  ): CoverageLedgerRecord[] {
    const records: CoverageLedgerRecord[] = [];
    for (const entry of entries) {
      records.push(CoverageLedgerManager.recordEntry(bible, entry));
    }
    return records;
  }

  /**
   * Lists all coverage ledger entries for a specific plan.
   */
  public static getEntriesForPlan(
    bible: BibleManager,
    seriesId: string,
    planId: string
  ): CoverageLedgerRecord[] {
    const all = bible.listCoverageLedgers(planId);
    return all.filter((l) => l.plan_id === planId);
  }

  /**
   * Lists all coverage ledger entries for a specific planned episode.
   */
  public static getEntriesForEpisode(
    bible: BibleManager,
    seriesId: string,
    planId: string,
    episodeNumber: number
  ): CoverageLedgerRecord[] {
    const entries = CoverageLedgerManager.getEntriesForPlan(bible, seriesId, planId);
    return entries.filter((e) => e.episode_number === episodeNumber);
  }

  /**
   * Lists all coverage ledger entries for a specific source unit.
   */
  public static getEntriesForUnit(
    bible: BibleManager,
    seriesId: string,
    planId: string,
    unitId: string
  ): CoverageLedgerRecord[] {
    const entries = CoverageLedgerManager.getEntriesForPlan(bible, seriesId, planId);
    return entries.filter((e) => e.source_unit_id === unitId);
  }

  /**
   * Verifies that 100% of mandatory story beats (is_mandatory = 1) are preserved
   * in the adaptation plan and not omitted without explicit override.
   */
  public static verifyMandatoryBeatsCoverage(
    seriesId: string,
    planId: string,
    bible: BibleManager
  ): MandatoryBeatsVerificationResult {
    const beats = bible.listStoryBeats(seriesId);
    const mandatoryBeats = beats.filter((b) => b.is_mandatory === 1);
    const ledgers = CoverageLedgerManager.getEntriesForPlan(bible, seriesId, planId);

    const violations: CoverageAuditViolation[] = [];
    let coveredCount = 0;

    for (const beat of mandatoryBeats) {
      // 1. Check if explicitly mapped via mandatory_beat_id
      const directMatch = ledgers.find((l) => l.mandatory_beat_id === beat.id);

      if (directMatch) {
        if (directMatch.adaptation_decision === "omitted") {
          violations.push({
            type: "missing_mandatory_beat",
            entityId: beat.id,
            name: beat.name,
            sourceUnitId: beat.source_unit_id,
            details: `Mandatory beat '${beat.name}' (${beat.id}) was marked as omitted in episode ${directMatch.episode_number}. Rationale: "${directMatch.rationale || "None"}"`,
          });
          continue;
        }
        coveredCount++;
        continue;
      }

      // 2. Check if the parent source unit is mapped and active (kept, compressed, moved, expanded)
      if (beat.source_unit_id) {
        const unitLedgers = ledgers.filter(
          (l) => l.source_unit_id === beat.source_unit_id
        );
        const activeUnitLedger = unitLedgers.find(
          (l) => l.adaptation_decision !== "omitted"
        );

        if (activeUnitLedger) {
          coveredCount++;
          continue;
        }
      }

      // If we reach here, beat is not covered
      violations.push({
        type: "missing_mandatory_beat",
        entityId: beat.id,
        name: beat.name,
        sourceUnitId: beat.source_unit_id,
        details: `Mandatory story beat '${beat.name}' (${beat.id}) in unit '${beat.source_unit_id || "unknown"}' is not covered by any episode in plan '${planId}'.`,
      });
    }

    return {
      isValid: violations.length === 0,
      totalMandatoryBeats: mandatoryBeats.length,
      coveredMandatoryBeats: coveredCount,
      violations,
    };
  }

  /**
   * Calculates comprehensive multi-level coverage metrics:
   * units, blocks, story beats, and adaptation decisions.
   */
  public static calculateCoverage(
    seriesId: string,
    planId: string,
    bible: BibleManager
  ): CoverageMetrics {
    const plan = bible.getSeriesPlan(planId);
    if (!plan) {
      throw new Error(`Plan '${planId}' not found in series '${seriesId}'.`);
    }

    const units = bible.listSourceUnits(plan.source_id);
    const blocks = bible.listSourceBlocks(plan.source_id);
    const beats = bible.listStoryBeats(seriesId);
    const ledgers = CoverageLedgerManager.getEntriesForPlan(bible, seriesId, planId);

    const decisionBreakdown: Record<AdaptationDecision, number> = {
      kept: 0,
      compressed: 0,
      moved: 0,
      omitted: 0,
      expanded: 0,
    };

    const violations: CoverageAuditViolation[] = [];

    // Tally decisions and validate rationales
    for (const l of ledgers) {
      const dec = l.adaptation_decision as AdaptationDecision;
      if (decisionBreakdown[dec] !== undefined) {
        decisionBreakdown[dec]++;
      }
      if (dec === "omitted" && (!l.rationale || l.rationale.trim().length === 0)) {
        violations.push({
          type: "omitted_without_rationale",
          entityId: l.id,
          name: `Omitted item for unit ${l.source_unit_id}`,
          sourceUnitId: l.source_unit_id,
          details: `Coverage entry ${l.id} omitted content without providing an explanation rationale.`,
        });
      }
    }

    // Check Unit Coverage
    const coveredUnitIds = new Set<string>();
    for (const l of ledgers) {
      if (l.adaptation_decision !== "omitted" && l.episode_number !== null) {
        coveredUnitIds.add(l.source_unit_id);
      }
    }

    const uncoveredUnitIds: string[] = [];
    for (const u of units) {
      if (!coveredUnitIds.has(u.id)) {
        // Check if explicitly omitted with ledger
        const isExplicitlyOmitted = ledgers.some(
          (l) => l.source_unit_id === u.id && l.adaptation_decision === "omitted"
        );
        if (!isExplicitlyOmitted) {
          uncoveredUnitIds.push(u.id);
          violations.push({
            type: "uncovered_unit",
            entityId: u.id,
            name: u.title,
            sourceUnitId: u.id,
            details: `Source unit '${u.title}' (${u.id}) has no entry in the coverage ledger.`,
          });
        }
      }
    }

    // Check Block Coverage
    const coveredBlockIds = new Set<string>();
    for (const l of ledgers) {
      if (l.source_block_id) {
        if (l.adaptation_decision !== "omitted") {
          coveredBlockIds.add(l.source_block_id);
        }
      } else if (l.adaptation_decision !== "omitted" && l.episode_number !== null) {
        // If entire unit is adapted, all its blocks are marked covered
        const unitBlocks = blocks.filter((b) => b.unit_id === l.source_unit_id);
        for (const ub of unitBlocks) {
          coveredBlockIds.add(ub.id);
        }
      }
    }

    // Check Beat Coverage & Mandatory Beats
    const mandatoryCheck = CoverageLedgerManager.verifyMandatoryBeatsCoverage(
      seriesId,
      planId,
      bible
    );
    for (const v of mandatoryCheck.violations) {
      violations.push(v);
    }

    const coveredBeatIds = new Set<string>();
    for (const b of beats) {
      const isDirectlyCovered = ledgers.some(
        (l) => l.mandatory_beat_id === b.id && l.adaptation_decision !== "omitted"
      );
      const isUnitCovered = b.source_unit_id ? coveredUnitIds.has(b.source_unit_id) : false;
      if (isDirectlyCovered || isUnitCovered) {
        coveredBeatIds.add(b.id);
      }
    }

    const uncoveredBeatIds = beats
      .filter((b) => !coveredBeatIds.has(b.id))
      .map((b) => b.id);

    // Verify Ending Section is not silently dropped
    if (units.length > 0) {
      const lastUnit = units[units.length - 1];
      if (!coveredUnitIds.has(lastUnit.id)) {
        violations.push({
          type: "silent_ending_drop",
          entityId: lastUnit.id,
          name: lastUnit.title,
          sourceUnitId: lastUnit.id,
          details: `The final source unit '${lastUnit.title}' (${lastUnit.id}) was dropped or omitted in plan. A valid adaptation must resolve the ending.`,
        });
      }
    }

    const unitCoveragePercent =
      units.length > 0 ? Math.round((coveredUnitIds.size / units.length) * 100) : 100;
    const blockCoveragePercent =
      blocks.length > 0 ? Math.round((coveredBlockIds.size / blocks.length) * 100) : 100;
    const beatCoveragePercent =
      beats.length > 0 ? Math.round((coveredBeatIds.size / beats.length) * 100) : 100;
    const mandatoryBeatsCoveragePercent =
      mandatoryCheck.totalMandatoryBeats > 0
        ? Math.round(
            (mandatoryCheck.coveredMandatoryBeats / mandatoryCheck.totalMandatoryBeats) *
              100
          )
        : 100;

    return {
      totalUnits: units.length,
      coveredUnits: coveredUnitIds.size,
      unitCoveragePercent,
      totalBlocks: blocks.length,
      coveredBlocks: coveredBlockIds.size,
      blockCoveragePercent,
      totalBeats: beats.length,
      coveredBeats: coveredBeatIds.size,
      beatCoveragePercent,
      totalMandatoryBeats: mandatoryCheck.totalMandatoryBeats,
      coveredMandatoryBeats: mandatoryCheck.coveredMandatoryBeats,
      mandatoryBeatsCoveragePercent,
      decisionBreakdown,
      uncoveredUnitIds,
      uncoveredBeatIds,
      violations,
    };
  }
}
