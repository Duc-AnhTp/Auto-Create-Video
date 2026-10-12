import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { type IncomingMessage, type ServerResponse } from "node:http";
import { join, resolve } from "node:path";
import { containedPath } from "../../../../platform/filesystem/containment.js";
import { HttpError } from "../../../../platform/errors.js";
import type { ServerRouteContext } from './context.js';
export async function legacy03_route(req: IncomingMessage, res: ServerResponse, url: URL, ctx: Pick<ServerRouteContext, never>): Promise<boolean> {
    const pathname = url.pathname;
    if (!((pathname === "/" || pathname === "/studio" || pathname === "/studio-legacy")))
        return false;
    const webRoot = resolve("dist/studio");
    if (!existsSync(join(webRoot, "index.html")))
        throw new HttpError(404, "STUDIO_BUILD_REQUIRED");
    const indexPath = containedPath(webRoot, join(webRoot, "index.html"));
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(await readFile(indexPath));
    return true;
}
