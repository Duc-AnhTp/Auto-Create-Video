import type { TokenUsageStore } from "../ports/token-usage-store.js";
import type { LlmTokenUsage } from "../../../contracts/usage.js";
export function recordStoryTokenUsage(bible:Pick<TokenUsageStore,"recordLlmTokenUsage">,seriesId:string,usage:LlmTokenUsage):void {
 bible.recordLlmTokenUsage({series_id:seriesId,provider:usage.provider,model:usage.model,input_tokens:usage.inputTokens,output_tokens:usage.outputTokens,cached_tokens:usage.cachedTokens??0,cache_creation_tokens:usage.cacheCreationTokens??0,estimated_savings_usd:usage.estimatedSavingsUsd??null});
}
