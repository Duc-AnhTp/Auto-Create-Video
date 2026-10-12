import { ProduceSeason } from '../modules/production/application/produce-season.js';
import { SqliteStoryStore } from './sqlite-story-store.js';
import { EpisodeRuntime } from './episode-runtime.js';
import { StoryToScreenplayGenerator } from '../modules/story/application/story-to-screenplay.js';
import { BudgetLedger } from '../modules/production/application/dispatch/budget-ledger.js';
export type { SeasonOrchestratorOptions } from '../modules/production/application/produce-season.js';
export * from '../contracts/season.js';
export class SeasonOrchestrator extends ProduceSeason {
    private closed = false;
    private ownedStore: SqliteStoryStore;
    private episodeRuntime: EpisodeRuntime;
    private ownsStore: boolean;
    constructor(storeOrPath: string | SqliteStoryStore = 'story_bible.db', options: ConstructorParameters<typeof EpisodeRuntime>[1] = {}) {
        const store = typeof storeOrPath === 'string' ? new SqliteStoryStore(storeOrPath) : storeOrPath, pipeline = new EpisodeRuntime(store, options);
        super({ bible: store, pipeline, screenplayGenerator: new StoryToScreenplayGenerator(store), budgetLedger: new BudgetLedger(store) });
        this.ownedStore = store;
        this.episodeRuntime = pipeline;
        this.ownsStore = typeof storeOrPath === 'string';
    }
    override getBible() { return this.ownedStore; }
    override getPipeline() { return this.episodeRuntime; }
    close() { if (this.closed)
        return; this.closed = true; this.episodeRuntime.close(); if (this.ownsStore)
        this.ownedStore.close(); }
}
