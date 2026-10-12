import { saveCharacter } from "../../../../modules/story/index.js";
import { z } from 'zod';
import { type IncomingMessage, type ServerResponse } from "node:http";
import type { ServerRouteContext } from './context.js';
export async function legacy12_charMatch(req: IncomingMessage, res: ServerResponse, url: URL, ctx: Pick<ServerRouteContext, "parseJsonBody" | "openStore">): Promise<boolean> {
    const pathname = url.pathname;
    const charMatch = pathname.match(/^\/api\/series\/([^/]+)\/characters$/);
    if (!(charMatch && req.method === "POST"))
        return false;
    const seriesId = charMatch[1];
    const body = z.object({ id: z.string().min(1), name: z.string().min(1), role: z.string().optional(), visual_summary: z.string().optional(), distinguishing_marks: z.string().optional(), status: z.enum(["alive", "injured", "deceased", "missing"]).optional(), face_reference_image: z.string().optional(), voice_profile_id: z.string().optional() }).passthrough().parse(await ctx.parseJsonBody(req));
    const character = await ctx.openStore(`data/series/${seriesId}/story_bible.db`, (bible) => saveCharacter(bible, { body, seriesId }));
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ success: true, character }));
    return true;
}
