import { existsSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { resolve } from "node:path";
import { z } from "zod";
import { recordReference } from "../../../modules/media/index.js";
import { HttpError } from "../../../platform/errors.js";
import { ProjectPaths } from "../../../platform/filesystem/project-paths.js";
import { readScopedJson } from "../scoped-request.js";
import { SeriesId } from "../../../contracts/requests.js";
import type { RouteContext, SendJson } from "./context.js";
export async function route31_artifactImport(req: IncomingMessage, res: ServerResponse, url: URL, send: SendJson, ctx: Pick<RouteContext, "withBible" | "media">): Promise<boolean> {
    const artifactImport = url.pathname.match(/^\/api\/v1\/series\/([^/]+)\/artifacts\/import$/);
    if (!(artifactImport && req.method === "POST"))
        return false;
    const id = SeriesId.parse(artifactImport[1]);
    const body = z.object({ episodeNumber: z.number().int().positive(), path: z.string(), kind: z.enum(["image", "master", "delivery", "evidence"]), mode: z.enum(["mock", "production"]), approved: z.boolean(), entityId: z.string().optional(), source: z.string().min(3).max(20000).optional() }).strict().parse(await readScopedJson(req, url));
    new ProjectPaths().check(id, body.path, body.kind === "image");
    if (body.mode === "production" && !body.source)
        throw new HttpError(400, "PROVENANCE_SOURCE_REQUIRED");
    if (!existsSync(resolve("data", "series", id, "story_bible.db")))
        throw new HttpError(404, "SERIES_NOT_FOUND");
    const artifact = await ctx.withBible(id, async (bible) => { if (body.kind === "image") {
        if (!body.entityId)
            throw new HttpError(400, "ENTITY_ID_REQUIRED");
        if (!bible.getCharacter(body.entityId, id) && !bible.getLocation(body.entityId, id))
            throw new HttpError(404, "REFERENCE_ENTITY_NOT_FOUND");
        await recordReference(bible, { path: body.path, seriesId: id, entityId: body.entityId, provider: "imported", mode: body.mode, embeddingSource: "unavailable", source: body.source });
    } if (body.kind === "image" && body.entityId) {
        const character = bible.getCharacter(body.entityId, id);
        if (character)
            bible.upsertCharacter({ ...character, face_reference_image: resolve(body.path), face_embedding_json: "[]" });
        const location = bible.getLocation(body.entityId, id);
        if (location)
            bible.upsertLocation({ ...location, reference_image_path: resolve(body.path) });
    } return ctx.media.createArtifactStore(bible).register(body.path, { ...body, seriesId: id }); });
    send({ artifact }, 201);
    return true;
}
