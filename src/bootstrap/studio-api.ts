import {recoverProjectRestores, createProjectMaintenance} from '../modules/projects/adapters/filesystem/backup.js';
import { createNleWorkspace } from '../modules/production/adapters/filesystem/nle-workspace.js';
import { createApprovedTimeline } from '../modules/production/adapters/filesystem/approved-timeline.js';
import { createMediaFactories } from './media-services.js';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { SqliteStoryStore } from './sqlite-story-store.js';
import { StudioHttpApi } from '../apps/http/studio-api.js';
import { WorkerSupervisor } from '../apps/worker/supervisor.js';
import { JobStore } from '../modules/production/adapters/sqlite/job-store.js';
import { ProviderDispatchStore } from '../modules/production/adapters/sqlite/provider-dispatch-store.js';
import { defaultWebhookRegistry, type ProviderWebhookRegistry } from '../modules/production/adapters/webhook-registry.js';
import { MediaJobService } from './media-jobs.js';
import { repairProviderDispatches } from './provider-recovery.js';
import { containedPath } from '../platform/filesystem/containment.js';
import { HttpError } from '../platform/errors.js';
export class StudioApi extends StudioHttpApi {
    constructor(dbPath = resolve('data/studio-jobs.db'), workersEnabled = true, webhookRegistry: ProviderWebhookRegistry = defaultWebhookRegistry) {
        const store = new JobStore(dbPath), dispatchStore = new ProviderDispatchStore(dbPath), mediaJobs = new MediaJobService(store), supervisor = new WorkerSupervisor(dbPath, workersEnabled);

        super({ projectMaintenance: createProjectMaintenance(process.cwd()), async initialize(){if(dbPath!==':memory:'){await recoverProjectRestores();dispatchStore.seriesCoordinator.recoverAbandoned();if(workersEnabled)repairProviderDispatches(dispatchStore);}}, nleWorkspace: createNleWorkspace(), timeline: createApprovedTimeline(), dispose() { dispatchStore.close(); store.close(); }, media: createMediaFactories(), store, dispatchStore, mediaJobs, supervisor, webhookRegistry, async withBible(seriesId, fn, maintenanceToken) {
                const folder = containedPath(resolve('data'), resolve('data', 'series', seriesId)), path = join(folder, 'story_bible.db');
                if (!existsSync(path))
                    throw new HttpError(404, 'SERIES_NOT_FOUND');
                const leave = dispatchStore.seriesCoordinator.enter(seriesId, maintenanceToken);
                let bible: SqliteStoryStore | undefined;
                try {
                    bible = new SqliteStoryStore(path, {maintenanceToken, seriesCoordinator: dispatchStore.seriesCoordinator});
                    return await fn(bible);
                }
                finally {
                    bible?.close(); leave();
                }
            } });
    }
}
