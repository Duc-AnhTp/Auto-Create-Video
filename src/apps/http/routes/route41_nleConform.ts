import type { IncomingMessage, ServerResponse } from 'node:http';
import { z } from 'zod';
import { conformEpisodeTimeline } from '../../../modules/production/index.js';
import { SeriesId } from '../../../contracts/requests.js';
import { readScopedJson } from '../scoped-request.js';
import type { RouteContext, SendJson } from './context.js';
export async function route41_nleConform(req: IncomingMessage, res: ServerResponse, url: URL, send: SendJson, ctx: Pick<RouteContext, 'withBible' | 'nleWorkspace'>): Promise<boolean> {
    const match = url.pathname.match(/^\/api\/v1\/series\/([^/]+)\/episodes\/(\d+)\/nle\/conform$/);
    if (!match || req.method !== 'POST') return false;
    const seriesId = SeriesId.parse(match[1]);
    const episode = Number(match[2]);
    const body = z.object({ xmlContent: z.string().min(1), apply: z.boolean().optional() }).parse(await readScopedJson(req, url));
    send(await conformEpisodeTimeline({ workspace: ctx.nleWorkspace, withStore: ctx.withBible }, { seriesId, episode, ...body }));
    return true;
}
