export interface LlmRequestEvidence {
  provider:string;model:string;purpose:"generate"|"analysis"|"retry"|"repair";
  outcome:"completed"|"failed";usageStatus:"available"|"unavailable";elapsedMs:number;
  inputTokens?:number;outputTokens?:number;cachedTokens?:number;cacheCreationTokens?:number;
}

export interface LlmTokenUsage {inputTokens:number;outputTokens:number;cachedTokens?:number;cacheCreationTokens?:number;provider:string;model:string;estimatedSavingsUsd?:number}
