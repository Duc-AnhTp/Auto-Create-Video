export interface TtsGenerateOptions {
  seriesId?: string;
  normalizedText?: boolean;
  attemptKey?: string;
  signal?: AbortSignal;
  remoteId?: string;
  onAccepted?: (remoteId: string) => void | Promise<void>;
  actingInstruction?: string;
  speed?: number;
  voiceProfileId?: string;
  characterId?: string;
}

export interface TtsGenerationResult {
  provider: string;
  remoteId?: string;
  audioPath: string;
  invoicedCostUsd?: number;
}

export interface TtsClient {
  /**
   * Generate speech audio for `text` and write to `audioOutPath` (mp3 or wav).
   * If `srtOutPath` is provided AND the provider supports subtitles,
   * write the SRT to that path. Otherwise silently skip.
   */
  generate(
    text: string,
    audioOutPath: string,
    srtOutPath?: string,
    options?: TtsGenerateOptions
  ): Promise<void | TtsGenerationResult>;
}
