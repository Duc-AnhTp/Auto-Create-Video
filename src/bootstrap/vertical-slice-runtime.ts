import { ProduceVerticalSliceDemo } from '../modules/production/application/produce-vertical-slice-demo.js';
import { SqliteStoryStore } from './sqlite-story-store.js';
import { VideoModelGateway } from '../modules/production/application/dispatch/video-gateway.js';
import { BudgetLedger } from '../modules/production/application/dispatch/budget-ledger.js';
import { MockVideoAdapter } from "../modules/production/adapters/providers/mock-adapter.js";
import { KlingAdapter } from "../modules/production/adapters/providers/kling-adapter.js";
import { RunwayAdapter } from "../modules/production/adapters/providers/runway-adapter.js";
import { VeoAdapter } from "../modules/production/adapters/providers/veo-adapter.js";
import { SeedanceAdapter } from "../modules/production/adapters/providers/seedance-adapter.js";
import { ComfyUiAdapter } from "../modules/production/adapters/providers/comfyui-adapter.js";
import { MockVisualQaBackend } from "../modules/production/adapters/qa/face-evaluator.js";
export type { VerticalSliceOptions, VerticalSliceProductionResult } from '../modules/production/application/produce-vertical-slice-demo.js';
export class VerticalSliceRunner extends ProduceVerticalSliceDemo {
    private closed = false;
    private ownedStore: SqliteStoryStore;
    constructor(dbPath: string, gatewayConfig: {
        maxBudgetUsd?: number;
        gateway?: VideoModelGateway;
    } = {}) {
        const bible = new SqliteStoryStore(dbPath), gateway = gatewayConfig.gateway ?? new VideoModelGateway({ maxBudgetUsd: gatewayConfig.maxBudgetUsd ?? 50, enableFailover: false });
        if (!gatewayConfig.gateway) {
            gateway.registerAdapter(new MockVideoAdapter());
            if (process.env.KLING_API_KEY)
                gateway.registerAdapter(new KlingAdapter());
            if (process.env.RUNWAY_API_KEY)
                gateway.registerAdapter(new RunwayAdapter());
            if (process.env.VEO_API_KEY || process.env.GEMINI_API_KEY)
                gateway.registerAdapter(new VeoAdapter());
            if (process.env.SEEDANCE_API_KEY || process.env.VOLC_API_KEY)
                gateway.registerAdapter(new SeedanceAdapter());
            if (process.env.COMFYUI_HOST || process.env.COMFYUI_BASE_URL)
                gateway.registerAdapter(new ComfyUiAdapter());
        }
        super({ bible, dbPath, gateway, budgetLedger: new BudgetLedger(bible), visualQa: new MockVisualQaBackend() });
        this.ownedStore = bible;
    }
    override getBible() { return this.ownedStore; }
    close() { if (this.closed)
        return; this.closed = true; this.ownedStore.close(); }
}
