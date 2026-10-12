import { useRef, useState } from "react";
import { ScopedRequests, StaleResponse } from "../shared/api/scoped-requests.js";
import { request } from "../shared/api/client.js";
export function useEpisodeScope() {
    const [seriesId, setSeriesId] = useState(""), [episode, setEpisode] = useState(1), [activeBranchId, setActiveBranchId] = useState("");
    const scopeKey = JSON.stringify([seriesId, episode, activeBranchId]);
    const scoped = useRef(new ScopedRequests());
    scoped.current.setScope(scopeKey);
    const active = () => scoped.current.current(scopeKey);
    const api = async <T = unknown>(path: string, body?: unknown, signal?: AbortSignal): Promise<T> => { if (!active())
        throw new StaleResponse(); const value = await request<T>(path, body, signal); if (!active())
        throw new StaleResponse(); return value; };
    return { seriesId, setSeriesId, episode, setEpisode, activeBranchId, setActiveBranchId, scopeKey, scoped, active, api };
}
