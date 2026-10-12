import { mkdirSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { join, resolve } from "node:path";
import { z } from "zod";
import { lipSyncEngine_alignLipSync } from "../../../modules/media/index.js";
import { containedPath } from "../../../platform/filesystem/containment.js";
import { readScopedJson } from "../scoped-request.js";
import { SeriesId } from "../../../contracts/requests.js";
import type { RouteContext, SendJson } from "./context.js";
export async function route39_lipSyncProcess(req: IncomingMessage, res: ServerResponse, url: URL, send: SendJson, ctx: Pick<RouteContext, never>): Promise<boolean> {
    const lipSyncProcessMatch = url.pathname.match(/^\/api\/v1\/series\/([^/]+)\/episodes\/(\d+)\/lip-sync\/process$/);
    if (!(lipSyncProcessMatch && req.method === "POST"))
        return false;
    const id = SeriesId.parse(lipSyncProcessMatch[1]);
    const epNum = parseInt(lipSyncProcessMatch[2], 10);
    const body = z
        .object({
        shotId: z.string().regex(/^[a-zA-Z0-9_-]+$/).optional(),
        dialogueText: z.string().min(1),
        actingInstruction: z.string().optional(),
        provider: z.enum(["wav2lip", "liveportrait", "sadtalker", "synclabs", "mock"]).optional(),
        fps: z.number().int().min(12).max(60).optional(),
        audioOffsetMs: z.number().optional(),
    })
        .parse(await readScopedJson(req, url));
    const shotId = body.shotId || "shot_1";
    const outDir = resolve("data", "series", id, "episodes", String(epNum), "lip_sync");
    containedPath(resolve("data"), outDir);
    mkdirSync(outDir, { recursive: true });
    const inputVid = containedPath(outDir, join(outDir, `raw_${shotId}.mp4`));
    const inputAudio = containedPath(outDir, join(outDir, `audio_${shotId}.wav`));
    const outputVid = containedPath(outDir, join(outDir, `lipsync_${shotId}.mp4`));
    const result = await lipSyncEngine_alignLipSync(inputVid, inputAudio, body.dialogueText, outputVid, {
        provider: body.provider || "mock",
        fps: body.fps || 24,
        audioOffsetMs: body.audioOffsetMs || 0,
        allowMockFallback: true,
    });
    send({ success: true, result });
    return true;
}
