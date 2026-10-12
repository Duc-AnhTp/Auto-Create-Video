import type {EpisodeBudgetQuota,SeasonBudgetPlan} from '../../../contracts/media-features.js';
export type {EpisodeBudgetQuota,SeasonBudgetPlan} from '../../../contracts/media-features.js';
import { SeasonArcController, type EpisodePacingProfile } from "./season-arc-controller.js";






/**
 * Seasonal Dynamic Budget Allocator.
 *
 * Proportionally weights budget distribution across season episodes based on dramatic tension:
 * - High-intensity Climax & Midpoint episodes receive 1.3x - 1.7x budget weight
 *   to fund premium high-framerate AI video takes (Kling / Veo / Runway) and multiple hero rerolls.
 * - Dialogue-heavy setup episodes are optimized at 0.7x - 0.85x average cost.
 * - Automatically reallocates surplus from completed episodes to upcoming climax episodes.
 */
export class SeasonBudgetAllocator {
  /**
   * Generates initial season budget plan based on total budget and episode count.
   */
  public static planSeasonBudget(
    seriesId: string,
    totalBudgetUsd: number,
    totalEpisodes: number = 10
  ): SeasonBudgetPlan {
    const rawWeights: number[] = [];
    const profiles: EpisodePacingProfile[] = [];

    for (let ep = 1; ep <= totalEpisodes; ep++) {
      const profile = SeasonArcController.getEpisodePacingProfile(ep, totalEpisodes);
      profiles.push(profile);

      // Weight formula: base 0.7 + tensionScore * 0.9 + heroShotRatio * 0.4
      const weight = 0.7 + profile.tensionScore * 0.9 + profile.heroShotRatio * 0.4;
      rawWeights.push(weight);
    }

    const totalWeight = rawWeights.reduce((acc, w) => acc + w, 0);

    const quotas: EpisodeBudgetQuota[] = profiles.map((p, idx) => {
      const normalizedWeight = rawWeights[idx] / totalWeight;
      const allocated = parseFloat((totalBudgetUsd * normalizedWeight).toFixed(2));

      return {
        episodeNumber: p.episodeNumber,
        weight: parseFloat(normalizedWeight.toFixed(4)),
        allocatedUsd: allocated,
        spentUsd: 0.0,
        reservedUsd: 0.0,
        remainingUsd: allocated,
        status: "pending",
        pacingAct: p.act,
      };
    });

    // Adjust any rounding drift on the last episode
    const sumAllocated = quotas.reduce((acc, q) => acc + q.allocatedUsd, 0);
    const drift = parseFloat((totalBudgetUsd - sumAllocated).toFixed(2));
    if (Math.abs(drift) > 0.001 && quotas.length > 0) {
      quotas[quotas.length - 1].allocatedUsd = parseFloat(
        (quotas[quotas.length - 1].allocatedUsd + drift).toFixed(2)
      );
      quotas[quotas.length - 1].remainingUsd = quotas[quotas.length - 1].allocatedUsd;
    }

    return {
      seriesId,
      totalSeasonBudgetUsd: totalBudgetUsd,
      totalAllocatedUsd: totalBudgetUsd,
      totalSpentUsd: 0.0,
      totalReservedUsd: 0.0,
      seasonSurplusUsd: 0.0,
      episodes: quotas,
    };
  }

  /**
   * Records expenditure for an episode and dynamically reallocates surplus to remaining episodes.
   */
  public static recordEpisodeSpend(
    currentPlan: SeasonBudgetPlan,
    episodeNumber: number,
    actualSpentUsd: number
  ): SeasonBudgetPlan {
    const quota = currentPlan.episodes.find((e) => e.episodeNumber === episodeNumber);
    if (!quota) return currentPlan;

    quota.spentUsd = parseFloat(actualSpentUsd.toFixed(2));
    quota.remainingUsd = Math.max(0, parseFloat((quota.allocatedUsd - actualSpentUsd).toFixed(2)));
    quota.status = quota.remainingUsd < 0 ? "over_budget" : "completed";

    // Calculate total spent
    const totalSpent = currentPlan.episodes.reduce((acc, e) => acc + e.spentUsd, 0);
    currentPlan.totalSpentUsd = parseFloat(totalSpent.toFixed(2));

    // Dynamic Surplus Rebalancing
    // If the episode spent less than allocated, distribute surplus forward to remaining unproduced episodes
    const variance = quota.allocatedUsd - actualSpentUsd;
    const remainingEpisodes = currentPlan.episodes.filter(
      (e) => e.episodeNumber > episodeNumber && e.status === "pending"
    );

    if (remainingEpisodes.length > 0 && Math.abs(variance) > 0.5) {
      const remainingTotalWeight = remainingEpisodes.reduce((acc, e) => acc + e.weight, 0);
      for (const rem of remainingEpisodes) {
        const share = (rem.weight / remainingTotalWeight) * variance;
        rem.allocatedUsd = Math.max(0, parseFloat((rem.allocatedUsd + share).toFixed(2)));
        rem.remainingUsd = Math.max(0, parseFloat((rem.allocatedUsd - rem.spentUsd).toFixed(2)));
      }

      /* Diagnostic details are returned in the capability/budget result. */
    }

    currentPlan.seasonSurplusUsd = parseFloat(
      (currentPlan.totalSeasonBudgetUsd - currentPlan.totalSpentUsd).toFixed(2)
    );

    return currentPlan;
  }
}
