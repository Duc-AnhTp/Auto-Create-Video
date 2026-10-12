import type { UnifiedTimeline } from '../../../contracts/timeline.js';

export interface NleWorkspace {
    load(seriesId: string, episode: number): Promise<{
        timeline: UnifiedTimeline;
        publish(timeline: UnifiedTimeline): Promise<void>;
    }>;
}
