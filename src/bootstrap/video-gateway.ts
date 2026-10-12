import { log } from '../platform/observability/logger.js';
import { VideoModelGateway, type GatewayConfig } from "../modules/production/application/dispatch/video-gateway.js";
import { defaultWebhookRegistry } from "../modules/production/adapters/webhook-registry.js";
import { MockVideoAdapter } from "../modules/production/adapters/providers/mock-adapter.js";
import { ComfyUiAdapter } from "../modules/production/adapters/providers/comfyui-adapter.js";
import { ServerlessComfyUIAdapter } from "../modules/production/adapters/providers/serverless-comfyui-adapter.js";
import { KlingAdapter } from "../modules/production/adapters/providers/kling-adapter.js";
import { RunwayAdapter } from "../modules/production/adapters/providers/runway-adapter.js";
import { VeoAdapter } from "../modules/production/adapters/providers/veo-adapter.js";
import { SeedanceAdapter } from "../modules/production/adapters/providers/seedance-adapter.js";
export function createDefaultVideoGateway(config: GatewayConfig = {}): VideoModelGateway {
    const webhookRegistry = config.webhookRegistry ?? defaultWebhookRegistry;
    const gateway = new VideoModelGateway({
        ...config,
        webhookRegistry,
    });
    // 1. Mock Adapter (Always registered for fallback and local testing)
    gateway.registerAdapter(new MockVideoAdapter());
    // 2. Local ComfyUI
    try {
        gateway.registerAdapter(new ComfyUiAdapter());
    }
    catch (cleanupError) { log.warn('[PROVIDER INITIALIZATION] '+String(cleanupError)); }
    // 3. Serverless ComfyUI
    try {
        gateway.registerAdapter(new ServerlessComfyUIAdapter({
            endpoint: process.env.SERVERLESS_COMFYUI_ENDPOINT || "https://api.runpod.ai/v2/mock",
            apiKey: process.env.SERVERLESS_COMFYUI_API_KEY,
            mockFallback: true,
        }));
    }
    catch (cleanupError) { log.warn('[PROVIDER INITIALIZATION] '+String(cleanupError)); }
    // 4. Real Cloud AI Providers
    try {
        gateway.registerAdapter(new KlingAdapter());
    }
    catch (cleanupError) { log.warn('[PROVIDER INITIALIZATION] '+String(cleanupError)); }
    try {
        gateway.registerAdapter(new RunwayAdapter());
    }
    catch (cleanupError) { log.warn('[PROVIDER INITIALIZATION] '+String(cleanupError)); }
    try {
        gateway.registerAdapter(new VeoAdapter());
    }
    catch (cleanupError) { log.warn('[PROVIDER INITIALIZATION] '+String(cleanupError)); }
    try {
        gateway.registerAdapter(new SeedanceAdapter());
    }
    catch (cleanupError) { log.warn('[PROVIDER INITIALIZATION] '+String(cleanupError)); }
    return gateway;
}
export function createEpisodeVideoGateway(): VideoModelGateway {
    const gateway = new VideoModelGateway();
    for (const adapter of [new MockVideoAdapter(), new KlingAdapter(), new RunwayAdapter(), new ComfyUiAdapter(), new VeoAdapter(), new SeedanceAdapter()])
        gateway.registerAdapter(adapter);
    return gateway;
}
