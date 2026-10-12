import type { ProviderRateCardRecord } from "../../../contracts/story.js";

export interface RateCardManagerStore {
getRateCard(provider: string, modelName?: string): ProviderRateCardRecord | null;
listRateCards(provider?: string): ProviderRateCardRecord[];
setRateCard(rateCard: any): void;
}
