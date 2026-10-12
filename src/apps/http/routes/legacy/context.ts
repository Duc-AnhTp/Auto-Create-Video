import type { IncomingMessage, ServerResponse } from 'node:http';
import type { StudioHttpServerDependencies } from '../../studio-server.js';
export interface ServerRouteContext {
    trackTimer(timer: ReturnType<typeof setInterval>, onClose?: () => void): void;
    clearTimer(timer: ReturnType<typeof setInterval>): void;
    api: StudioHttpServerDependencies['api'];
    settingsManager: StudioHttpServerDependencies['settings'];
    catalog: StudioHttpServerDependencies['catalog'];
    openStore: StudioHttpServerDependencies['withBible'];
    broadcastEvent(seriesId: string, episode: number, data: Record<string, unknown>): void;
    parseJsonBody(req: IncomingMessage): Promise<unknown>;
    handleSseConnection(req: IncomingMessage, res: ServerResponse, id: string, episode: number): void;
    handleMediaStream(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void>;
}
export type ServerRoute = (req: IncomingMessage, res: ServerResponse, url: URL, context: ServerRouteContext) => Promise<boolean>;
