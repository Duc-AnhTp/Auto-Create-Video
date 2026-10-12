import type { IncomingMessage, ServerResponse } from "node:http";
import { PROVIDER_CAPABILITY_REGISTRY } from "../../../modules/production/index.js";
import type { RouteContext, SendJson } from "./context.js";
export async function route05_system(req: IncomingMessage, res: ServerResponse, url: URL, send: SendJson, ctx: Pick<RouteContext, never>): Promise<boolean> {
    if (!((url.pathname === "/api/v1/system/capabilities" || url.pathname === "/api/system/capabilities") && req.method === "GET"))
        return false;
    send({
        success: true,
        capabilities: {
            providers: PROVIDER_CAPABILITY_REGISTRY,
            providerVerification: "unverified_with_real_providers",
            features: {
                lipSync: {
                    supported: false,
                    reason: "Requires Wav2Lip/SadTalker backend container; mock simulation only",
                },
                trailerAutoCut: {
                    supported: true,
                    mode: "timeline_export_only",
                    reason: "FCP7 XML, EDL, and OTIO timeline assembly supported; full video re-render requires NLE conform",
                },
                spatialFoleyMastering: {
                    supported: false,
                    reason: "Spatial foley stem synthesis available; delivery master stem mixing bus pending",
                },
            },
        },
    });
    return true;
}
