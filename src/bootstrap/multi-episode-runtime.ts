import { ProduceMultiEpisodeDemo } from '../modules/production/application/produce-multi-episode-demo.js';
import { SqliteStoryStore } from './sqlite-story-store.js';
export type { MultiEpisodeRunnerOptions, EpisodeProductionRecord, SeasonProductionManifest } from '../modules/production/application/produce-multi-episode-demo.js';
export class MultiEpisodeRunner extends ProduceMultiEpisodeDemo {
    private closed = false;
    private ownedStore: SqliteStoryStore;
    private ownsStore: boolean;
    constructor(storeOrPath: string | SqliteStoryStore = ':memory:') { const store = typeof storeOrPath === 'string' ? new SqliteStoryStore(storeOrPath) : storeOrPath; super(store); this.ownedStore = store; this.ownsStore = typeof storeOrPath === 'string'; }
    override getBible() { return this.ownedStore; }
    close() { if (this.closed)
        return; this.closed = true; if (this.ownsStore)
        this.ownedStore.close(); }
}
