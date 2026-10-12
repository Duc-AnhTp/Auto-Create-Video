import { UnifiedTimelineSchema, type UnifiedTimeline } from "../contracts/timeline.js";

/** Complete fixture built through the same schema as production artifacts. */
export function createTimelineFixture(overrides: Partial<UnifiedTimeline> = {}): UnifiedTimeline {
  return UnifiedTimelineSchema.parse({
    seriesId: "fixture-series", episodeNumber: 1, fps: 24, sampleRate: 48000,
    targetTotalFrames: 360, targetTotalDurationSec: 15,
    videoTrack: [], dialogueTrack: [], sfxTrack: [], ambienceTrack: [], subtitleTrack: [],
    ...overrides,
  });
}
