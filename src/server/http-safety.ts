import type { IncomingMessage } from "node:http";
import { realpathSync, existsSync } from "node:fs";
import { resolve, relative, isAbsolute, dirname } from "node:path";

export class HttpError extends Error {
  constructor(public status: number, public code: string, message = code) { super(message); }
}
export async function readJson(req: IncomingMessage, limit = 2_100_000): Promise<unknown> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    size += Buffer.byteLength(chunk);
    if (size > limit) throw new HttpError(413, "PAYLOAD_TOO_LARGE");
    chunks.push(Buffer.from(chunk));
  }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"); }
  catch { throw new HttpError(400, "INVALID_JSON"); }
}
export function containedPath(root: string, path: string): string {
  const base = realpathSync(resolve(root));
  const target = resolve(path);
  const inside = (candidate: string) => { const rel = relative(base, candidate); return rel === "" || (!isAbsolute(rel) && rel !== ".." && !rel.startsWith("..\\") && !rel.startsWith("../")); };
  if (!inside(target)) throw new HttpError(403, "PATH_FORBIDDEN");
  let ancestor = target;
  while (!existsSync(ancestor) && ancestor !== dirname(ancestor)) ancestor = dirname(ancestor);
  if (!inside(realpathSync(ancestor))) throw new HttpError(403, "PATH_FORBIDDEN");
  return target;
}
export function checkRequestOrigin(req: IncomingMessage, host: string, port: number) {
  const hosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`, `${host}:${port}`]);
  if (!req.headers.host || !hosts.has(req.headers.host)) throw new HttpError(403, "INVALID_HOST");
  if (req.headers["sec-fetch-site"] === "cross-site") throw new HttpError(403, "CROSS_ORIGIN");
  if (req.headers.origin) {
    let origin: URL;
    try { origin = new URL(req.headers.origin); } catch { throw new HttpError(403, "CROSS_ORIGIN"); }
    if (origin.protocol !== "http:" || !hosts.has(origin.host)) throw new HttpError(403, "CROSS_ORIGIN");
  }
  if (["POST", "PUT", "PATCH"].includes(req.method || "") && !req.headers["content-type"]?.startsWith("application/json")) throw new HttpError(415, "JSON_REQUIRED");
}
