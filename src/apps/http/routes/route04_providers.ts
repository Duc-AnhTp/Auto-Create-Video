import type { IncomingMessage, ServerResponse } from "node:http";
import { PROVIDER_CAPABILITY_REGISTRY } from "../../../modules/production/index.js";
import type { RouteContext, SendJson } from "./context.js";
export async function route04_providers(req: IncomingMessage, res: ServerResponse, url: URL, send: SendJson, ctx: Pick<RouteContext, never>): Promise<boolean> {
    if (!((url.pathname === "/api/v1/providers" || url.pathname === "/api/providers") && req.method === "GET"))
        return false;
    send({ capabilities: PROVIDER_CAPABILITY_REGISTRY, verification: Object.fromEntries(Object.keys(PROVIDER_CAPABILITY_REGISTRY).map(provider => [provider, provider === "mock" ? "offline_verified" : "unverified"])) });
    return true;
}
