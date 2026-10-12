import { describe, expect, it, vi } from 'vitest';
import { createTimelineFixture } from '../../../../__test-utils__/timeline-fixture.js';
import { exportFcp7Xml } from '../../../media/adapters/assembly/nle-exporter.js';
import { conformEpisodeTimeline } from './conform-episode-timeline.js';

describe('NLE conform application boundary', () => {
    const timeline = createTimelineFixture({videoTrack:[{shotId:'sc01_sh01',sceneId:'scene1',startFrame:0,endFrame:360,durationFrames:360,startSec:0,endSec:15,durationSec:15,shotType:'medium',visualPrompt:'Fixture',approvedClipPath:'sc01_sh01_take01.mp4',trimStartSec:0}]});
    const request = { seriesId: timeline.seriesId, episode: timeline.episodeNumber, xmlContent: exportFcp7Xml(timeline) };

    it('previews without publishing or opening the take store', async () => {
        const publish = vi.fn();
        const withStore = vi.fn();
        const result = await conformEpisodeTimeline({ workspace: { load: async () => ({ timeline, publish }) }, withStore }, request);
        expect(result.applied).toBe(false);
        expect(publish).not.toHaveBeenCalled();
        expect(withStore).not.toHaveBeenCalled();
    });

    it('propagates publication failure before any take approval', async () => {
        const failure = new Error('disk unavailable');
        const withStore = vi.fn();
        await expect(conformEpisodeTimeline({ workspace: { load: async () => ({ timeline, publish: async () => { throw failure; } }) }, withStore }, { ...request, apply: true })).rejects.toBe(failure);
        expect(withStore).not.toHaveBeenCalled();
    });
});
