import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { UnifiedTimelineSchema } from '../../../../contracts/timeline.js';
import { ProjectPaths } from '../../../../platform/filesystem/project-paths.js';
import { atomicWriteFile } from '../../../../platform/filesystem/atomic-publication.js';
import { WorkflowError } from '../../../../platform/workflow-error.js';
import { log } from '../../../../platform/observability/logger.js';
import type { NleWorkspace } from '../../ports/nle-workspace.js';

export function createNleWorkspace(): NleWorkspace {
    return {
        async load(seriesId, episode) {
            const paths = new ProjectPaths();
            const directory = paths.episodeOutput(seriesId, episode);
            const file = paths.episodeTimeline(seriesId, episode);
            if (!file) throw new WorkflowError('TIMELINE_REQUIRED', 'Tập chưa có timeline đã dựng.');
            const timeline = UnifiedTimelineSchema.parse(JSON.parse(await readFile(file, 'utf8')));
            return {
                timeline,
                async publish(conformed) {
                    const data = JSON.stringify(conformed, null, 2);
                    await atomicWriteFile(file, data, 'utf8');
                    const mirror = paths.check(seriesId, join(directory, 'timeline.json'));
                    if (file !== mirror) {
                        try { await atomicWriteFile(mirror, data, 'utf8'); }
                        catch (error) { log.warn('[NLE] Could not update root timeline mirror: ' + String(error)); }
                    }
                },
            };
        },
    };
}
