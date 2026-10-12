import type { MediaFactories } from '../../../modules/media/index.js';
import type { IncomingMessage, ServerResponse } from "node:http";
import type { StoryStore } from "../../../bootstrap/ports/workflow-store.js";
import type { JobQueue, DispatchCoordination, WebhookReceiver, MediaJobs } from '../../../modules/production/index.js';
export type SendJson = (data: unknown, status?: number) => void;
export interface RouteContext {
    projectMaintenance: import("../../../modules/projects/index.js").ProjectMaintenance;
    nleWorkspace: import("../../../modules/production/index.js").NleWorkspace;
    media: MediaFactories;
    timeline: import("../../../modules/production/index.js").ApprovedTimeline;
    store: JobQueue;
    dispatchStore: DispatchCoordination;
    mediaJobs: MediaJobs;
    webhookRegistry: WebhookReceiver;
    streams: Set<ServerResponse>;
    timers: Set<ReturnType<typeof setInterval>>;
    closing: boolean;
    withBible<T>(seriesId: string, fn: (bible: StoryStore) => T | Promise<T>, maintenanceToken?: string): Promise<T>;
    startWorker(): void;
}
export type Route = (req: IncomingMessage, res: ServerResponse, url: URL, send: SendJson, ctx: RouteContext) => Promise<boolean>;
