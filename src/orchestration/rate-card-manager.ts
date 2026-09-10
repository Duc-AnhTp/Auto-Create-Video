import type { StoryBibleManager, ProviderRateCardRecord } from "../bible/bible-manager.js";
import { log } from "../utils/logger.js";

/**
 * Rate Card Manager (Requirement 10)
 *
 * Provides configurable rate cards indexed by provider, model name, and verification effective date.
 * Strictly avoids relying on hard-coded prices as the definitive current price.
 */

export const DEFAULT_OFFICIAL_RATE_CARDS: ProviderRateCardRecord[] = [
  {
    id: "rate_kling_standard_20260901",
    provider: "api_kling",
    model_name: "kling-v2",
    rate_per_sec_usd: 0.12,
    rate_per_unit_usd: 0.12,
    unit_type: "second",
    currency: "USD",
    effective_date: "2026-09-01",
    source_doc_url: "https://klingai.org/pricing",
    notes: "Kling AI Standard High-Def Mode per official 2026 rate schedule",
    created_at: new Date().toISOString(),
  },
  {
    id: "rate_kling_v3_20260901",
    provider: "api_kling",
    model_name: "kling-3.0",
    rate_per_sec_usd: 0.15,
    rate_per_unit_usd: 0.15,
    unit_type: "second",
    currency: "USD",
    effective_date: "2026-09-01",
    source_doc_url: "https://klingai.org/pricing/v3",
    notes: "Kling 3.0 Ultra cinematic tier",
    created_at: new Date().toISOString(),
  },
  {
    id: "rate_runway_gen3_20260901",
    provider: "api_runway",
    model_name: "gen3a_turbo",
    rate_per_sec_usd: 0.15,
    rate_per_unit_usd: 0.15,
    unit_type: "second",
    currency: "USD",
    effective_date: "2026-09-01",
    source_doc_url: "https://runwayml.com/pricing",
    notes: "Runway Gen-3 Alpha Turbo tier",
    created_at: new Date().toISOString(),
  },
  {
    id: "rate_veo_31_20260901",
    provider: "api_veo",
    model_name: "veo-3.1",
    rate_per_sec_usd: 0.20,
    rate_per_unit_usd: 0.20,
    unit_type: "second",
    currency: "USD",
    effective_date: "2026-09-01",
    source_doc_url: "https://deepmind.google/technologies/veo/pricing",
    notes: "Google DeepMind Veo 3.1 cinematic generation",
    created_at: new Date().toISOString(),
  },
  {
    id: "rate_seedance_20_20260901",
    provider: "api_seedance",
    model_name: "seedance-2.0",
    rate_per_sec_usd: 0.09,
    rate_per_unit_usd: 0.09,
    unit_type: "second",
    currency: "USD",
    effective_date: "2026-09-01",
    source_doc_url: "https://seedance.ai/pricing",
    notes: "Seedance 2.0 high-efficiency generation",
    created_at: new Date().toISOString(),
  },
  {
    id: "rate_wan_22_20260901",
    provider: "api_wan",
    model_name: "wan-2.2",
    rate_per_sec_usd: 0.08,
    rate_per_unit_usd: 0.08,
    unit_type: "second",
    currency: "USD",
    effective_date: "2026-09-01",
    source_doc_url: "https://wanx.aliyun.com/pricing",
    notes: "Wan 2.2 hosted API tier",
    created_at: new Date().toISOString(),
  },
  {
    id: "rate_comfyui_local",
    provider: "local_comfyui",
    model_name: "wan2.2_local",
    rate_per_sec_usd: 0.0,
    rate_per_unit_usd: 0.0,
    unit_type: "second",
    currency: "USD",
    effective_date: "2026-01-01",
    notes: "Self-hosted local GPU instance ($0 compute cost)",
    created_at: new Date().toISOString(),
  },
  {
    id: "rate_mock",
    provider: "mock",
    model_name: "simulator",
    rate_per_sec_usd: 0.0,
    rate_per_unit_usd: 0.0,
    unit_type: "second",
    currency: "USD",
    effective_date: "2026-01-01",
    notes: "Test mock simulator ($0 cost)",
    created_at: new Date().toISOString(),
  },
];

export class RateCardManager {
  private bible: StoryBibleManager;

  constructor(bible: StoryBibleManager) {
    this.bible = bible;
  }

  /**
   * Initializes default rate cards into SQLite if none are present.
   */
  public seedDefaultRatesIfEmpty(): void {
    const existing = this.bible.listRateCards();
    if (existing.length === 0) {
      for (const card of DEFAULT_OFFICIAL_RATE_CARDS) {
        this.bible.setRateCard(card);
      }
    }
  }

  /**
   * Resolves the active rate card for a provider and model.
   * Sorts by effective_date DESC.
   */
  public resolveRate(provider: string, modelName?: string): {
    ratePerSecUsd: number;
    effectiveDate: string;
    sourceDocUrl?: string;
    isConfigured: boolean;
  } {
    const card = this.bible.getRateCard(provider, modelName);
    if (card) {
      return {
        ratePerSecUsd: card.rate_per_sec_usd,
        effectiveDate: card.effective_date,
        sourceDocUrl: card.source_doc_url,
        isConfigured: true,
      };
    }

    // Try generic provider lookup without modelName
    if (modelName) {
      const genericCard = this.bible.getRateCard(provider);
      if (genericCard) {
        return {
          ratePerSecUsd: genericCard.rate_per_sec_usd,
          effectiveDate: genericCard.effective_date,
          sourceDocUrl: genericCard.source_doc_url,
          isConfigured: true,
        };
      }
    }

    // Rule 10 fallback warning
    log.warn(
      `[RATE CARD] Không tìm thấy bảng giá cho provider '${provider}' (model: '${modelName || "any"}'). Đang dùng giá bảo thủ $0.15/s. Vui lòng cấu hình qua rate card.`
    );
    return {
      ratePerSecUsd: 0.15,
      effectiveDate: "unverified",
      isConfigured: false,
    };
  }

  /**
   * Adds or updates a rate card with verification metadata.
   */
  public setRate(card: any): void {
    this.bible.setRateCard(card);
  }

  public listRates(provider?: string): ProviderRateCardRecord[] {
    return this.bible.listRateCards(provider);
  }

  public listActiveRates(): ProviderRateCardRecord[] {
    return this.bible.listRateCards();
  }
}
