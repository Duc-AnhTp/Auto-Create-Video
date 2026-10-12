import { WorkflowError } from '../../../../platform/workflow-error.js';
import type { PrepareSeasonRequestStore } from "../../ports/studio/prepare-season-request-store.js";
export function prepareSeasonRequest(bible: PrepareSeasonRequestStore, args: {
    id: string;
    body: {
        fromEpisode: number;
        mode: "mock" | "production";
        approvalPolicy: "auto_qa" | "manual";
        resume: boolean;
        planId?: string | undefined;
        toEpisode?: number | undefined;
        totalEpisodes?: number | undefined;
        provider?: "mock" | "local_comfyui" | "api_kling" | "api_runway" | "api_veo" | "api_seedance" | undefined;
        hedge?: {
            enabled: boolean;
            delayMs: number;
            fallbackProvider?: "local_comfyui" | "api_kling" | "api_runway" | "api_veo" | "api_seedance" | undefined;
        } | undefined;
        seasonBudgetUsd?: number | undefined;
        enable4kPost?: boolean | undefined;
        enableAutoBridge?: boolean | undefined;
        customChapterTitles?: string[] | undefined;
    };
    input: {
        seriesId: string;
        episodeNumber: number;
        kind: "episode" | "season";
        rawScreenplay: string;
        provider: "mock" | "local_comfyui" | "api_kling" | "api_runway" | "api_veo" | "api_seedance";
        mode: "mock" | "production";
        maxReRolls: number;
        resume: boolean;
        season?: {
            fromEpisode: number;
            toEpisode: number;
            approvalPolicy: "auto_qa" | "manual";
            planId?: string | undefined;
        } | undefined;
        budgetCapUsd?: number | undefined;
        exportResolution?: "720p" | "1080p" | undefined;
        hedge?: {
            enabled: boolean;
            delayMs: number;
            fallbackProvider?: "local_comfyui" | "api_kling" | "api_runway" | "api_veo" | "api_seedance" | undefined;
        } | undefined;
    };
}) {
    const { id, body, input } = args;
    const plans = bible.listSeriesPlans(id);
    const plan = body.planId ? plans.find(p => p.id === body.planId) : plans.find(p => p.status === "active") ?? plans.find(p => p.status === "approved");
    if (!plan || !["approved", "active"].includes(plan.status))
        throw new WorkflowError("APPROVED_PLAN_REQUIRED", "APPROVED_PLAN_REQUIRED");
    input.season!.planId = plan.id;
}
