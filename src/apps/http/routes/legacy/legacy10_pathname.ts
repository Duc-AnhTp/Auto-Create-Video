import { initializeStory } from "../../../../modules/story/index.js";
import { z } from 'zod';
import { type IncomingMessage, type ServerResponse } from "node:http";
import { SeriesId } from "../../../../contracts/requests.js";
import type { ServerRouteContext } from './context.js';
export async function legacy10_pathname(req: IncomingMessage, res: ServerResponse, url: URL, ctx: Pick<ServerRouteContext, "parseJsonBody" | "openStore">): Promise<boolean> {
    const pathname = url.pathname;
    if (!(pathname === "/api/series/init" && req.method === "POST"))
        return false;
    const body = z.object({ id: z.string().min(1), title: z.string().optional(), genre: z.string().optional(), visual_style: z.string().optional(), aspect_ratio: z.enum(["9:16", "16:9"]).optional(), fps: z.coerce.number().positive().optional() }).passthrough().parse(await ctx.parseJsonBody(req));
    SeriesId.parse(body.id);
    const meta = {
        id: body.id,
        title: body.title || "Untitled Series",
        genre: body.genre || "Cinema Drama",
        visual_style: body.visual_style || "Cinematic 35mm, 8k photorealistic",
        aspect_ratio: body.aspect_ratio || "9:16",
        fps: Number(body.fps) || 30,
        created_at: new Date().toISOString(),
    };
    await ctx.openStore(`data/series/${body.id}/story_bible.db`, (bible) => initializeStory(bible, { meta }));
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ success: true, metadata: meta }));
    return true;
}
