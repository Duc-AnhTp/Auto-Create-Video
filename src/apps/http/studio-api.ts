import type { JobQueue, DispatchCoordination, WebhookReceiver, MediaJobs } from '../../modules/production/index.js';
export interface StudioHttpDependencies {
    initialize?(): Promise<void>;
    projectMaintenance: RouteContext["projectMaintenance"];
    nleWorkspace: RouteContext["nleWorkspace"];
    timeline: RouteContext["timeline"];
    media: RouteContext["media"];
    store: JobQueue;
    dispatchStore: DispatchCoordination;
    mediaJobs: MediaJobs;
    supervisor: Pick<WorkerSupervisor, 'start' | 'close'>;
    webhookRegistry: WebhookReceiver;
    withBible: RouteContext['withBible'];
    dispose?(): void | Promise<void>;
}
import { WorkerSupervisor } from "../worker/supervisor.js";
import type { IncomingMessage, ServerResponse } from "node:http";
import { applicationError } from "./application-error.js";
import { HttpError } from "../../platform/errors.js";
import { studioRoutes } from "./routes/index.js";
import type { RouteContext } from "./routes/context.js";
export class StudioHttpApi {
    private projectMaintenance: RouteContext["projectMaintenance"];
    readonly store: JobQueue;
    private nleWorkspace: RouteContext["nleWorkspace"];
    private timeline: RouteContext["timeline"];
    private media: RouteContext["media"];
    private supervisor: Pick<WorkerSupervisor, "start" | "close">;
    readonly dispatchStore: DispatchCoordination;
    private mediaJobs: MediaJobs;
    private streams = new Set<ServerResponse>();
    private timers = new Set<ReturnType<typeof setInterval>>();
    private closing = false;
    private disposeResources?: () => void | Promise<void>;
    private webhookRegistry: WebhookReceiver;
    private initialization: Promise<void>;
    async ready():Promise<void>{await this.initialization;}
    isUnderMaintenance(seriesId: string): boolean {
        return this.dispatchStore.seriesCoordinator.isUnderMaintenance(seriesId);
    }
    private openSeries: RouteContext['withBible'];
    private withBible<T>(seriesId: string, fn: Parameters<RouteContext['withBible']>[1], token?: string): Promise<T> { return this.openSeries(seriesId, fn, token) as Promise<T>; }
    constructor(dependencies: StudioHttpDependencies) {
        this.initialization=dependencies.initialize?.()??Promise.resolve();
        this.initialization.catch(()=>{});
        this.projectMaintenance = dependencies.projectMaintenance;
        this.nleWorkspace = dependencies.nleWorkspace;
        this.timeline = dependencies.timeline;
        this.disposeResources = dependencies.dispose;
        this.media = dependencies.media;
        this.store = dependencies.store;
        this.dispatchStore = dependencies.dispatchStore;
        this.mediaJobs = dependencies.mediaJobs;
        this.supervisor = dependencies.supervisor;
        this.webhookRegistry = dependencies.webhookRegistry;
        this.openSeries = dependencies.withBible;
    }
    startWorker(): void { void this.initialization.then(()=>{if(!this.closing)this.supervisor.start();}).catch(()=>{}); }
    async close() {
        if (this.closing)
            return;
        this.closing = true;
        for (const timer of this.timers)
            clearInterval(timer);
        for (const stream of this.streams)
            stream.end();
        await this.supervisor.close();
        await this.disposeResources?.();
    }
    async handle(req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> {
        await this.initialization;
        const send = (value: unknown, status = 200) => { res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" }); res.end(JSON.stringify(value)); };
        const versioned = url.pathname.startsWith("/api/v1/");
        if (!versioned && !url.pathname.startsWith("/api/"))
            return false;
        const canonical = new URL(url);
        if (!versioned && !url.pathname.startsWith("/api/webhooks/"))
            canonical.pathname = url.pathname.replace(/^\/api\//, "/api/v1/");
        const context: RouteContext = { projectMaintenance: this.projectMaintenance, nleWorkspace: this.nleWorkspace, timeline: this.timeline, media: this.media, store: this.store, dispatchStore: this.dispatchStore, mediaJobs: this.mediaJobs, webhookRegistry: this.webhookRegistry, streams: this.streams, timers: this.timers, closing: this.closing, withBible: (...args) => this.withBible(...args), startWorker: () => this.startWorker() };
        let leave: (()=>void) | undefined;
        try {
            const series=canonical.pathname.match(/^\/api\/v1\/series\/([^/]+)(?:\/|$)/);
            const exclusive=req.method==='POST'&&/^\/api\/v1\/series\/[^/]+\/(?:backups|restore)$/.test(canonical.pathname);
            if(series&&!exclusive)leave=this.dispatchStore.seriesCoordinator.enter(series[1]);
            for (const route of studioRoutes)
                if (await route(req, res, canonical, send, context))
                    return true;
            if (versioned)
                throw new HttpError(404, "ROUTE_NOT_FOUND");
            return false;
        }
        catch (error) {
            const failure = applicationError(error);
            send({ error: failure.error }, failure.status);
            return true;
        }
        finally { leave?.(); }
    }
}
