import { createHmac, timingSafeEqual } from "node:crypto";

/** Signed local relay envelope; native callbacks without a verifier use polling. */
export function verifyWebhookEnvelope(provider: string, body: Buffer, signature: string | undefined, timestamp: string | undefined, secret: string | undefined, now = Date.now()): boolean {
  if (!secret || !signature || !timestamp || !/^\d+$/.test(timestamp)) return false;
  const seconds = Number(timestamp);
  if (!Number.isSafeInteger(seconds) || Math.abs(now / 1000 - seconds) > 300) return false;
  const expected = createHmac("sha256", secret).update(`${provider}.${timestamp}.`).update(body).digest();
  if (!/^sha256=[a-f0-9]{64}$/i.test(signature)) return false;
  const received = Buffer.from(signature.slice(7), "hex");
  return received.length === expected.length && timingSafeEqual(received, expected);
}
