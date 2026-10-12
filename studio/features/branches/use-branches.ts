import type React from 'react';
import type { request } from '../../shared/api/client.js';
import { useScopedState } from '../../shared/api/use-scoped-state.js';
import { useState } from 'react';
import { ScopedRequests, StaleResponse } from '../../shared/api/scoped-requests.js';
import type { NarrativeGraphData, TimelineBranchItem, MultiverseBranchDiff } from '../../../src/contracts/studio-features.js';
export function useBranches({ seriesId, api, active, scoped, scopeKey, activeBranchId, setActiveBranchId }: {
    seriesId: string;
    api: typeof request;
    active: () => boolean;
    scoped: React.RefObject<ScopedRequests>;
    scopeKey: string;
    activeBranchId: string;
    setActiveBranchId: (id: string) => void;
}) {
    const [graphData, setGraphData] = useScopedState<NarrativeGraphData | null>(null, active);
    const [branches, setBranches] = useScopedState<TimelineBranchItem[]>([], active);
    const [branchModalOpen, setBranchModalOpen] = useState(false);
    const [branchModalMode, setBranchModalMode] = useState<"fork" | "diff">("fork");
    const loadNarrativeGraph = async () => {
        if (!seriesId)
            return;
        try {
            const result = await scoped.current.load(scopeKey, "graph", signal => api<NarrativeGraphData>(`/api/v1/series/${seriesId}/narrative-graph`, undefined, signal));
            setGraphData(result);
        }
        catch (error) {
            if (error instanceof StaleResponse)
                return;
            setGraphData(null);
        }
    };
    const loadBranches = async () => {
        if (!seriesId)
            return;
        try {
            const res = await scoped.current.load(scopeKey, "branches", signal => api<{
                branches: TimelineBranchItem[];
            }>(`/api/v1/series/${seriesId}/branches`, undefined, signal));
            const branchList = res.branches || [];
            setBranches(branchList);
            const canon = branchList.find((b: TimelineBranchItem) => b.is_canonical === 1);
            if (canon && !activeBranchId) {
                setActiveBranchId(canon.id);
            }
        }
        catch (error) {
            if (error instanceof StaleResponse)
                return;
            setBranches([]);
        }
    };
    const handleForkBranch = async (options: {
        name: string;
        description?: string;
        fromEpisodeNumber: number;
    }) => {
        const res = await api<{
            branch: TimelineBranchItem;
        }>(`/api/v1/series/${seriesId}/branches/fork`, options);
        await loadBranches();
        if (res.branch?.id) {
            setActiveBranchId(res.branch.id);
        }
    };
    const handleCompareBranches = async (bA: string, bB: string): Promise<MultiverseBranchDiff> => {
        const res = await api<{
            diff: MultiverseBranchDiff;
        }>(`/api/v1/series/${seriesId}/branches/compare?branchA=${encodeURIComponent(bA)}&branchB=${encodeURIComponent(bB)}`);
        return res.diff;
    };
    const handlePromoteToCanonical = async (bId: string) => {
        await api<{
            branches: TimelineBranchItem[];
        }>(`/api/v1/series/${seriesId}/branches/${bId}/activate`, {});
        await loadBranches();
        setActiveBranchId(bId);
    };
    return { graphData, setGraphData, branches, setBranches, branchModalOpen, setBranchModalOpen, branchModalMode, setBranchModalMode, loadNarrativeGraph, loadBranches, handleForkBranch, handleCompareBranches, handlePromoteToCanonical };
}
