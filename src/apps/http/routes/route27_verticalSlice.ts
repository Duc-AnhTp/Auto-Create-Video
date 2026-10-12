import type { IncomingMessage, ServerResponse } from "node:http";
import { join, resolve } from "node:path";
import { z } from "zod";
import { VerticalSliceRunner } from "../../../bootstrap/vertical-slice-runtime.js";
import { containedPath } from "../../../platform/filesystem/containment.js";
import { readScopedJson } from "../scoped-request.js";
import { SeriesId } from "../../../contracts/requests.js";
import type { RouteContext, SendJson } from "./context.js";
export async function route27_verticalSlice(req: IncomingMessage, res: ServerResponse, url: URL, send: SendJson, ctx: Pick<RouteContext, never>): Promise<boolean> {
    const verticalSliceMatch = url.pathname.match(/^\/api\/(?:v1\/)?series\/([^/]+)\/vertical-slice\/run$/);
    if (!(verticalSliceMatch && req.method === "POST"))
        return false;
    const id = SeriesId.parse(verticalSliceMatch[1]);
    const body = z
        .object({
        episodeNumber: z.number().int().positive().default(1),
        chapterTitle: z.string().default("Hồi Quy Vũ Trụ"),
        novelText: z.string().default(""),
        provider: z.string().optional(),
        mockVideo: z.boolean().optional(),
        budgetCapUsd: z.number().optional(),
        tokenBudget: z.number().optional(),
    })
        .parse(await readScopedJson(req, url));
    const dbDir = resolve("data", "series", id);
    containedPath(resolve("data"), dbDir);
    const dbPath = join(dbDir, "story_bible.db");
    const runner = new VerticalSliceRunner(dbPath, { maxBudgetUsd: body.budgetCapUsd });
    try {
        const result = await runner.runVerticalSlice({
            seriesId: id,
            episodeNumber: body.episodeNumber,
            chapterTitle: body.chapterTitle,
            novelText: body.novelText || "Khởi đầu câu chuyện điện ảnh...",
            provider: (body.provider as any) || "mock",
            mockVideo: body.mockVideo ?? true,
            budgetCapUsd: body.budgetCapUsd,
            tokenBudget: body.tokenBudget,
        });
        send({ success: true, result });
    }
    finally {
        runner.close();
    }
    return true;
}
