import type { IncomingMessage } from "node:http";



export { HttpError } from "../../platform/errors.js";
import { HttpError } from "../../platform/errors.js";
export async function readBody(req: IncomingMessage, limit = 2_100_000): Promise<Buffer> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    size += Buffer.byteLength(chunk);
    if (size > limit) throw new HttpError(413, "PAYLOAD_TOO_LARGE");
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}
export async function readJson(req: IncomingMessage, limit = 2_100_000): Promise<unknown> {
  const body = await readBody(req, limit);
  try { return JSON.parse(body.toString("utf8") || "{}"); }
  catch { throw new HttpError(400, "INVALID_JSON"); }
}
export { containedPath } from "../../platform/filesystem/containment.js";
export function localStudioHost(host: string): string {
  if (host === "localhost") return "127.0.0.1";
  if (host === "127.0.0.1" || host === "::1") return host;
  throw new HttpError(400, "STUDIO_LOOPBACK_REQUIRED");
}
export function isLoopbackPeer(address: string | undefined): boolean {
  if (!address) return false;
  const trimmed = address.trim().toLowerCase();
  if (trimmed === "::1") return true;
  if (/^(0{1,4}:){7}0{0,3}1$/.test(trimmed)) return true;
  if (trimmed.startsWith("::ffff:")) {
    const rest = trimmed.slice(7);
    if (/^127(?:\.(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/.test(rest)) return true;
    if (/^7f[0-9a-f]{0,2}:[0-9a-f]{1,4}$/i.test(rest)) return true;
  }
  if (trimmed.startsWith("0:0:0:0:0:ffff:")) {
    const rest = trimmed.slice(15);
    if (/^127(?:\.(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/.test(rest)) return true;
  }
  if (/^127(?:\.(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/.test(trimmed)) {
    return true;
  }
  return false;
}
export function checkRequestOrigin(req: IncomingMessage, host: string, port: number) {
  localStudioHost(host);
  if (!isLoopbackPeer(req.socket.remoteAddress)) throw new HttpError(403, "LOCAL_REQUEST_REQUIRED");
  const hosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`]);
  if (!req.headers.host || !hosts.has(req.headers.host)) throw new HttpError(403, "INVALID_HOST");
  if (req.headers["sec-fetch-site"] === "cross-site") throw new HttpError(403, "CROSS_ORIGIN");
  if (req.headers.origin) {
    let origin: URL;
    try { origin = new URL(req.headers.origin); } catch { throw new HttpError(403, "CROSS_ORIGIN"); }
    if (origin.protocol !== "http:" || !hosts.has(origin.host)) throw new HttpError(403, "CROSS_ORIGIN");
  }
  const hasBody = (Number(req.headers["content-length"] ?? 0) > 0) || Boolean(req.headers["transfer-encoding"]);
  if (hasBody && ["POST", "PUT", "PATCH"].includes(req.method || "") && !req.headers["content-type"]?.startsWith("application/json")) {
    throw new HttpError(415, "JSON_REQUIRED");
  }
}
