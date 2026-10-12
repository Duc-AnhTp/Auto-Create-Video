import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { type IncomingMessage, type ServerResponse } from "node:http";
import { extname, join, resolve } from "node:path";
import { containedPath } from "../../../../platform/filesystem/containment.js";
import { HttpError } from "../../../../platform/errors.js";
import type { ServerRouteContext } from './context.js';
export async function legacy01_pathname(req: IncomingMessage, res: ServerResponse, url: URL, ctx: Pick<ServerRouteContext, never>): Promise<boolean> {
    const pathname = url.pathname;
    if (!(pathname === "/studio-next" || pathname.startsWith("/studio-assets/")))
        return false;
    const webRoot = resolve("dist/studio");
    const file = pathname === "/studio-next" ? join(webRoot, "index.html") : join(webRoot, pathname.slice(1));
    if (!existsSync(file))
        throw new HttpError(404, "STUDIO_BUILD_REQUIRED", "Chạy npm run build:studio để mở Studio mới.");
    const safe = containedPath(webRoot, file);
    const type = extname(safe) === ".js" ? "text/javascript" : extname(safe) === ".css" ? "text/css" : "text/html; charset=utf-8";
    res.writeHead(200, { "Content-Type": type });
    res.end(await readFile(safe));
    return true;
}
