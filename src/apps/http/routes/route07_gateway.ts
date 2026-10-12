import type { IncomingMessage, ServerResponse } from "node:http";
import { PROVIDER_CAPABILITY_REGISTRY } from "../../../modules/production/index.js";
import { verifyWebhookEnvelope } from "../../../modules/production/index.js";
import { normalizeWebhookPayload } from "../../../modules/production/index.js";
import { HttpError } from "../../../platform/errors.js";
import { readBody } from "../http-safety.js";
import type { RouteContext, SendJson } from "./context.js";
export async function route07_gateway(req: IncomingMessage, res: ServerResponse, url: URL, send: SendJson, ctx: Pick<RouteContext, "dispatchStore" | "webhookRegistry">): Promise<boolean> {
    if (!((url.pathname.startsWith("/api/v1/gateway/webhook/") ||
        url.pathname.startsWith("/api/webhooks/video/") ||
        url.pathname.startsWith("/api/v1/webhooks/video/")) &&
        req.method === "POST"))
        return false;
    const provider = url.pathname.replace(/^\/api\/(?:v1\/)?(?:gateway\/webhook\/|webhooks\/video\/)/, "");
    if (!(provider in PROVIDER_CAPABILITY_REGISTRY))
        throw new HttpError(404, "PROVIDER_UNKNOWN");
    const raw = await readBody(req);
    const signature = req.headers["x-webhook-signature"] || req.headers["x-signature-sha256"];
    const timestamp = req.headers["x-webhook-timestamp"] || req.headers["x-timestamp"];
    const secret = process.env[`WEBHOOK_SECRET_${provider.toUpperCase()}`] ||
        process.env[`${provider.toUpperCase()}_WEBHOOK_SECRET`];
    if (!verifyWebhookEnvelope(provider, raw, typeof signature === "string" ? signature : undefined, typeof timestamp === "string" ? timestamp : undefined, secret))
        throw new HttpError(401, "WEBHOOK_SIGNATURE_INVALID");
    let payload: unknown;
    try {
        payload = JSON.parse(raw.toString("utf8"));
    }
    catch {
        throw new HttpError(400, "INVALID_JSON");
    }
    const normalized = normalizeWebhookPayload(payload);
    if (normalized)
        ctx.dispatchStore.receiveWebhook(provider, normalized);
    const handled = ctx.webhookRegistry.receiveWebhook(provider, payload) || Boolean(normalized);
    send({ received: true, provider, handled });
    return true;
}
