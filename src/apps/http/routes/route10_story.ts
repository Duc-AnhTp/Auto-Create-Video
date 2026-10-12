import { errorCode } from '../../../platform/workflow-error.js';
import type { IncomingMessage, ServerResponse } from "node:http";
import { resolve } from "node:path";
import { containedPath } from "../../../platform/filesystem/containment.js";
import { HttpError } from "../../../platform/errors.js";
import { readScopedJson } from "../scoped-request.js";
import { generateDraft } from "../../../bootstrap/studio-story.js";
import { ScreenplayRequest, SourceRequest } from "../../../modules/story/index.js";
import { SeriesId } from "../../../contracts/requests.js";
import type { RouteContext, SendJson } from "./context.js";
export async function route10_story(req: IncomingMessage, res: ServerResponse, url: URL, send: SendJson, ctx: Pick<RouteContext, "store" | "startWorker">): Promise<boolean> {
    const story = url.pathname.match(/^\/api\/v1\/series\/([^/]+)\/(source|screenplay)$/);
    if (!(story && req.method === "POST"))
        return false;
    const id = SeriesId.parse(story[1]);
    ctx.store.assertSeriesAvailable(id);
    containedPath(resolve("data"), resolve("data", "series", id));
    if (story[2] === "source") {
        const body = SourceRequest.parse(await readScopedJson(req, url, 16000000));
        ctx.store.assertSeriesAvailable(id);
        let job;
        try {
            job = ctx.store.enqueueStoryImport({ seriesId: id, ...body });
        }
        catch (error) {
            if (errorCode(error) === "SERIES_BUSY")
                throw new HttpError(409, "SERIES_BUSY");
            throw error;
        }
        ctx.startWorker();
        send({ jobId: job.id, job: ctx.store.storyImportSummary(job) }, 202);
    }
    else {
        const body = await readScopedJson(req, url);
        send(await generateDraft(id, ScreenplayRequest.parse(body)));
    }
    return true;
}
