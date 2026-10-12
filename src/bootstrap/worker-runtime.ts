import { JobStore } from '../modules/production/adapters/sqlite/job-store.js';
import { ProviderDispatchStore } from '../modules/production/adapters/sqlite/provider-dispatch-store.js';
import { SettingsManager } from '../modules/projects/adapters/settings.js';
export function createWorkerRuntime(path: string) {
    // This worker owns one queue. Its TTS adapters must persist attempts in the
    // same database as the Studio coordinator and reconciliation metrics.
    process.env.STUDIO_JOB_DB=path;
    const store = new JobStore(path), dispatchStore = new ProviderDispatchStore(path), settings = new SettingsManager();
    let closed = false;
    return { store, dispatchStore, readSettings: () => settings.readEnvConfig(), dispose() { if (closed)
            return; closed = true; dispatchStore.close(); store.close(); } };
}
