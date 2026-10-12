import { StudioHttpServer, type StudioServerOptions } from '../apps/http/studio-server.js';
import { StudioApi } from './studio-api.js';
import { SettingsManager } from '../modules/projects/adapters/settings.js';
import { SqliteProjectCatalog } from '../modules/projects/adapters/project-catalog.js';
import { SqliteStoryStore } from './sqlite-story-store.js';
import { dirname, resolve } from 'node:path';
import { mkdir } from 'node:fs/promises';
import {localStudioHost} from '../apps/http/http-safety.js';
export type { StudioServerOptions } from '../apps/http/studio-server.js';
export class StudioServer extends StudioHttpServer {
    constructor(options: StudioServerOptions = {}) {
        localStudioHost(options.host ?? "127.0.0.1");
        const api = new StudioApi(options.queuePath ?? (process.env.NODE_ENV === 'test' ? ':memory:' : resolve('data/studio-jobs.db')), options.workersEnabled ?? process.env.NODE_ENV !== 'test');
        const settings = new SettingsManager(options.settingsPath), catalog = new SqliteProjectCatalog(path => new SqliteStoryStore(path,{seriesCoordinator:api.dispatchStore.seriesCoordinator}));
        super(options, { api, settings, catalog, async withBible(path, fn) {
                if (path !== ':memory:')
                    await mkdir(dirname(resolve(path)), { recursive: true });
                const store = new SqliteStoryStore(path,{seriesCoordinator:api.dispatchStore.seriesCoordinator});
                try {
                    return await fn(store);
                }
                finally {
                    store.close();
                }
            } });
    }
}
