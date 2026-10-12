import { DurableShotOrchestrator, type OrchestratorOptions } from "../modules/production/application/dispatch/job-orchestrator.js";
import { ProviderDispatchStore } from "../modules/production/adapters/sqlite/provider-dispatch-store.js";
import type { StoryStore } from "./ports/workflow-store.js";
import type { VideoModelGateway } from "../modules/production/application/dispatch/video-gateway.js";
import { createDefaultVideoGateway } from "./video-gateway.js";
import { computeVideoSpecHash } from "../modules/production/adapters/filesystem/spec-fingerprint.js";
export class ResilientJobOrchestrator extends DurableShotOrchestrator {
    private ownedStore?: ProviderDispatchStore;
    private disposed = false;
    constructor(bible: StoryStore, gateway?: VideoModelGateway, options: OrchestratorOptions = {}) {
        const ownedStore=options.dispatchStore?undefined:new ProviderDispatchStore(process.env.NODE_ENV === "test" ? ":memory:" : undefined);
        const store=options.dispatchStore??ownedStore!;
        super(bible, gateway ?? createDefaultVideoGateway(), { fingerprintVideo: computeVideoSpecHash, ...options, dispatchStore: store });
        if (!options.dispatchStore) {
            this.ownedStore = ownedStore;
            bible.addDisposable(() => this.dispose());
        }
    }
    dispose(): void { if (this.disposed)
        return; this.disposed = true; this.ownedStore?.close(); }
}
