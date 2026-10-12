import { useCanon } from '../features/canon/use-canon.js';
import { useBranches } from '../features/branches/use-branches.js';
import { useProductionJobs } from "../features/production/use-production-jobs.js";
import { useEpisodeScope } from "./use-episode-scope.js";
import { useScopedState } from "../shared/api/use-scoped-state.js";
import type { SeriesMetadataRecord } from "../../src/contracts/story.js";
import type { ModelProviderInfo } from "../../src/contracts/settings.js";
import type { BibleView, DraftResponse, ArtifactsResponse } from "../../src/contracts/studio-responses.js";
import React, { useEffect, useRef, useState } from "react";
import type { StudioJob } from "../../src/contracts/studio.js";
import type { UnifiedTimeline } from "../../src/contracts/timeline.js";
import type { TakeItem, NarrativeGraphData, TimelineBranchItem } from "../../src/contracts/studio-features.js";
import { StaleResponse } from "../shared/api/scoped-requests.js";
import { request } from "../shared/api/client.js";
export function useWorkspace() {
    const [series, setSeries] = useState<SeriesMetadataRecord[]>([]);
    const { seriesId, setSeriesId, episode, setEpisode, activeBranchId, setActiveBranchId, scopeKey, scoped, active, api } = useEpisodeScope();
    const [text, setText] = useScopedState("", active);
    const [saved, setSaved] = useScopedState("", active);
    const [version, setVersion] = useScopedState(0, active);
    const [bible, setBible] = useScopedState<BibleView>({}, active);
    const [timeline, setTimeline] = useScopedState<UnifiedTimeline | null>(null, active);
    const [files, setFiles] = useScopedState<string[]>([], active);
    const [provider, setProvider] = useState("mock");
    const [hedgeEnabled, setHedgeEnabled] = useState(false), [hedgeProvider, setHedgeProvider] = useState("api_runway");
    useEffect(() => { if (provider === hedgeProvider)
        setHedgeProvider(provider === "api_runway" ? "api_kling" : "api_runway"); }, [provider, hedgeProvider]);
    const [budget, setBudget] = useState("");
    const [resolution, setResolution] = useState<"1080p" | "720p">("1080p");
    const [error, setError] = useScopedState("", active);
    const jobs = useProductionJobs({ seriesId, episode, scopeKey, active, onError: setError });
    const [notice, setNotice] = useScopedState("", active);
    const [busy, setBusy] = useScopedState(false, active);
    const [panel, setPanel] = useState<"script" | "source" | "preview" | "timeline" | "comparison" | "bible-graph" | "mixer" | "semantic" | "gateway" | "cinematic-post" | "season" | "lipsync" | "nle-roundtrip" | "scene-lighting" | "season-trailer" | "settings" | "assets">("script");
    const [selected, setSelected] = useScopedState("", active);
    const [providers, setProviders] = useState<ModelProviderInfo[]>([]);
    const [changes, setChanges] = useState<Record<string, string>>({});
    const [newTitle, setNewTitle] = useState("");
    const [newId, setNewId] = useState("");
    const [backups, setBackups] = useScopedState<{
        id: string;
        createdAt: string;
        fileCount: number;
    }[]>([], active);
    const [backupId, setBackupId] = useScopedState("", active);
    const [creating, setCreating] = useState(false);
    const [history, setHistory] = useScopedState<string[]>([], active);
    const [currentTime, setCurrentTime] = useScopedState(0, active);
    const [takes, setTakes] = useScopedState<TakeItem[]>([], active);
    const video = useRef<HTMLVideoElement>(null);
    const dirty = text !== saved;
    const prefix = `/api/v1/series/${seriesId}/episodes/${episode}`;
    const run = async (action: () => Promise<void>) => {
        setBusy(true);
        setError("");
        try {
            await action();
        }
        catch (e) {
            setError(e instanceof Error ? e.message : String(e));
        }
        finally {
            setBusy(false);
        }
    };
    const { graphData, setGraphData, branches, setBranches, branchModalOpen, setBranchModalOpen, branchModalMode, setBranchModalMode, loadNarrativeGraph, loadBranches, handleForkBranch, handleCompareBranches, handlePromoteToCanonical } = useBranches({ seriesId, api, active, scoped, scopeKey, activeBranchId, setActiveBranchId });
    const { canonReport, setCanonReport, isValidatingCanon, isRepairingCanon, handleValidateCanon, handleAutoRepairCanon, handleQuerySemanticMemory } = useCanon({ seriesId, text, prefix, api, active, setText, setNotice, setError });
    const loadSeries = async () => {
        const result = await request<{
            series: SeriesMetadataRecord[];
        }>("/api/series/list");
        setSeries(result.series);
        return result.series;
    };
    const loadArtifacts = async () => {
        if (!seriesId)
            return;
        const result = await scoped.current.load(scopeKey, "artifacts", signal => api<ArtifactsResponse>(`${prefix}/artifacts`, undefined, signal));
        setTimeline(result.timeline);
        setFiles(result.files);
    };
    const loadTakes = async () => {
        if (!seriesId)
            return;
        try {
            const result = await scoped.current.load(scopeKey, "takes", signal => api<{
                takes: TakeItem[];
            }>(`${prefix}/takes${selected ? `?shotId=${encodeURIComponent(selected)}` : ""}`, undefined, signal));
            setTakes(result.takes || []);
        }
        catch (error) {
            if (error instanceof StaleResponse)
                return;
            // Fallback empty takes
            setTakes([]);
        }
    };
    const handleRunVerticalSlice = async () => {
        setNotice("Đang thực thi Vertical Slice End-to-End...");
        const res = await api<{
            result: {
                status: string;
                videoExecution: {
                    completedShots: number;
                };
            };
        }>(`/api/v1/series/${seriesId}/vertical-slice/run`, {
            episodeNumber: episode,
            chapterTitle: `Tập ${episode}: Cuộc Phiêu Lưu Không Gian`,
            novelText: text || "Khởi đầu câu chuyện điện ảnh...",
            provider: "mock",
            mockVideo: true,
            budgetCapUsd: budget ? Number(budget) : 50,
        });
        setNotice(`Hoàn tất Vertical Slice [${res.result.status}]. Đã tạo ${res.result.videoExecution.completedShots} shots.`);
        await loadArtifacts();
    };
    useEffect(() => {
        void run(async () => {
            const all = await loadSeries();
            if (all.length)
                setSeriesId(all[0].id);
            const models = await request<{
                providers: ModelProviderInfo[];
            }>("/api/settings/models");
            setProviders(models.providers);
        });
    }, []);
    useEffect(() => {
        if (!seriesId)
            return;
        const controller = new AbortController();
        setSelected("");
        setTakes([]);
        setTimeline(null);
        setFiles([]);
        setCanonReport(null);
        setBusy(false);
        setError("");
        setNotice("");
        void Promise.all([
            scoped.current.load(scopeKey, "initial-draft", signal => api<DraftResponse>(`${prefix}/draft`, undefined, signal)),
            scoped.current.load(scopeKey, "initial-bible", signal => api<BibleView>(`/api/series/${seriesId}/bible`, undefined, signal)),
            scoped.current.load(scopeKey, "initial-artifacts", signal => api<ArtifactsResponse>(`${prefix}/artifacts`, undefined, signal)),
            scoped.current.load(scopeKey, "initial-takes", signal => api<{
                takes: TakeItem[];
            }>(`${prefix}/takes`, undefined, signal)),
            scoped.current.load(scopeKey, "initial-graph", signal => api<NarrativeGraphData>(`/api/v1/series/${seriesId}/narrative-graph`, undefined, signal)),
            scoped.current.load(scopeKey, "initial-branches", signal => api<{
                branches: TimelineBranchItem[];
            }>(`/api/v1/series/${seriesId}/branches`, undefined, signal)),
        ])
            .then(([draft, data, artifacts, takeData, graph, branchData]) => {
            if (!active() || controller.signal.aborted)
                return;
            setTakes(takeData.takes || []);
            setGraphData(graph);
            setBranches(branchData.branches || []);
            const canon = branchData.branches?.find((branch: TimelineBranchItem) => branch.is_canonical === 1);
            if (canon && !activeBranchId)
                setActiveBranchId(canon.id);
            setText(draft.text);
            setSaved(draft.text);
            setVersion(draft.version);
            setBible(data);
            setTimeline(artifacts.timeline);
            setFiles(artifacts.files);
            setHistory([]);
            if (artifacts.timeline?.videoTrack?.length && !selected) {
                setSelected(artifacts.timeline.videoTrack[0].shotId);
            }
        })
            .catch((e) => {
            if (active() && !(e instanceof StaleResponse) && !controller.signal.aborted)
                setError(e.message);
        });
        return () => {
            controller.abort();
            scoped.current.dispose();
        };
    }, [scopeKey]);
    useEffect(() => {
        if (seriesId) {
            void loadTakes();
        }
    }, [scopeKey, selected]);
    const latest = jobs.find((j) => j.request.seriesId === seriesId && j.request.episodeNumber === episode);
    useEffect(() => {
        if (latest?.result) {
            void loadArtifacts().catch((e) => setError(e.message));
            void loadTakes();
            void loadNarrativeGraph();
        }
    }, [latest?.updatedAt]);
    useEffect(() => {
        const warn = (e: BeforeUnloadEvent) => {
            if (dirty) {
                e.preventDefault();
                e.returnValue = "";
            }
        };
        window.addEventListener("beforeunload", warn);
        return () => window.removeEventListener("beforeunload", warn);
    }, [dirty]);
    const save = async () => {
        const draft = await api<DraftResponse>(`${prefix}/draft`, { baseVersion: version, text });
        setVersion(draft.version);
        setSaved(draft.text);
        return draft;
    };
    const switchProject = (id: string, number = 1) => {
        if (dirty) {
            setError("Hãy lưu bản nháp trước khi đổi dự án hoặc tập.");
            return;
        }
        setActiveBranchId("");
        setSelected("");
        setSeriesId(id);
        setEpisode(number);
    };
    const produce = () => run(async () => {
        await save();
        await api<{
            jobs: StudioJob[];
        }>("/api/v1/jobs", {
            seriesId,
            episodeNumber: episode,
            rawScreenplay: text,
            mode: provider === "mock" ? "mock" : "production",
            provider,
            exportResolution: resolution,
            ...(budget ? { budgetCapUsd: Number(budget) } : {}),
            hedge: { enabled: hedgeEnabled && provider !== "mock", fallbackProvider: hedgeProvider, delayMs: 45000 },
            maxReRolls: 2,
            resume: true,
        });
        setNotice("Đã xếp hàng sản xuất. Có thể theo dõi tiến độ bên dưới.");
    });
    const renderedJob = jobs.find((j) => j.request.seriesId === seriesId && j.request.episodeNumber === episode && !j.result?.reroll && j.result?.videoPath);
    const mainVideo = renderedJob?.result?.videoPath || files.find((f) => /[\\/]video\.mp4$/.test(f));
    const previewStale = dirty || Boolean(renderedJob ? renderedJob.request.rawScreenplay !== text : mainVideo && text !== saved);
    const selectedShot = timeline?.videoTrack.find((s) => s.shotId === selected);
    const editShot = (shotId: string, change: Record<string, unknown>, direction = 0) => run(async () => {
        const result = await api<{
            text: string;
        }>(`${prefix}/edit-shot`, {
            baseVersion: version,
            text,
            shotId: shotId || selected,
            change,
            direction,
        });
        setHistory((h) => [...h, text]);
        setText(result.text);
        setNotice("Đã cập nhật kịch bản. Lưu và dựng lại để cập nhật preview.");
    });
    const handleApproveTake = async (takeId: string) => {
        await run(async () => {
            const take = takes.find(item => item.id === takeId);
            if (!take)
                throw new Error("Take không thuộc lựa chọn hiện tại");
            await api(`${prefix}/shots/${encodeURIComponent(take.shot_id)}/approve`, { takeId, expectedQaReport: take.qa_report_json ?? null });
            setNotice(`Đã phê duyệt Take ${takeId} vào Master Timeline!`);
            await loadTakes();
            await loadArtifacts();
        });
    };
    const handleRerollShot = async (shotId: string, promptOverride?: string) => {
        await run(async () => {
            await api<{
                jobs: StudioJob[];
            }>("/api/v1/jobs", {
                seriesId,
                episodeNumber: episode,
                rawScreenplay: text,
                targetShotId: shotId,
                ...(promptOverride?.trim() ? { promptOverride: promptOverride.trim() } : {}),
                mode: provider === "mock" ? "mock" : "production",
                provider,
                exportResolution: resolution,
                ...(budget ? { budgetCapUsd: Number(budget) } : {}),
                maxReRolls: 1,
                resume: true,
            });
            setNotice(`Đã xếp hàng re-roll cho cú máy ${shotId}. Prompt: ${promptOverride || "Mặc định"}`);
        });
    };
    const handleSeek = (timeSec: number) => {
        setCurrentTime(timeSec);
        if (video.current) {
            video.current.currentTime = timeSec;
        }
    };
    const charRef = bible.characters?.find((c: import("../../src/contracts/story.js").CharacterRecord) => c.face_reference_image)?.face_reference_image;
    return { activeBranchId, api, backupId, backups, bible, branchModalMode, branchModalOpen, branches, budget, busy, canonReport, changes, charRef, creating, currentTime, dirty, editShot, episode, error, files, graphData, handleApproveTake, handleAutoRepairCanon, handleCompareBranches, handleForkBranch, handlePromoteToCanonical, handleQuerySemanticMemory, handleRerollShot, handleRunVerticalSlice, handleSeek, handleValidateCanon, hedgeEnabled, hedgeProvider, history, isRepairingCanon, isValidatingCanon, jobs, loadArtifacts, loadNarrativeGraph, loadSeries, mainVideo, newId, newTitle, notice, panel, previewStale, produce, provider, providers, renderedJob, resolution, run, save, scopeKey, scoped, selected, selectedShot, series, seriesId, setActiveBranchId, setBackupId, setBackups, setBible, setBranchModalMode, setBranchModalOpen, setBudget, setChanges, setCreating, setCurrentTime, setEpisode, setError, setHedgeEnabled, setHedgeProvider, setHistory, setNewId, setNewTitle, setNotice, setPanel, setProvider, setResolution, setSaved, setSelected, setText, setVersion, switchProject, takes, text, timeline, version, video };
}
export type WorkspaceModel = ReturnType<typeof useWorkspace>;
