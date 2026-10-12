import type { IncomingMessage, ServerResponse } from "node:http";
import { DEFAULT_PROVIDER_RATE_LIMITS } from "../../../modules/production/index.js";
import { PROVIDER_RATES_PER_SEC } from "../../../modules/production/index.js";
import type { RouteContext, SendJson } from "./context.js";
export async function route06_gateway(req: IncomingMessage, res: ServerResponse, url: URL, send: SendJson, ctx: Pick<RouteContext, "dispatchStore" | "store">): Promise<boolean> {
    if (!((url.pathname === "/api/v1/gateway/metrics" || url.pathname === "/api/gateway/metrics") && req.method === "GET"))
        return false;
    send({
        success: true,
        rates: PROVIDER_RATES_PER_SEC,
        rateLimits: DEFAULT_PROVIDER_RATE_LIMITS,
        runtime: ctx.dispatchStore.metrics(),
        jobs: ctx.store.metrics(),
        providers: [
            "api_kling",
            "api_runway",
            "api_veo",
            "api_seedance",
            "api_wan",
            "api_ltx",
            "local_comfyui",
            "serverless_comfyui",
            "mock",
        ],
    });
    return true;
}
