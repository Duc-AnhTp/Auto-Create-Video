export interface FoleyOptions {
  durationSec?: number;
  volume?: number;
  sampleRate?: number;
  mockFallback?: boolean;
}
export interface FoleyGenerator {
  /**
   * Generates synchronized Foley SFX from shot video and action description.
   */
  generateFoley(
    videoPath: string,
    actionPrompt: string,
    outPath: string,
    options?: FoleyOptions
  ): Promise<string>;
}
