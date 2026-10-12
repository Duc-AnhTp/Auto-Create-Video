import { BudgetLedger } from "../dispatch/budget-ledger.js";
import { CharacterTurnaroundBridge } from "../character-turnaround-bridge.js";
import type { ReadProviderReconciliationStore } from "../../ports/studio/read-provider-reconciliation-store.js";
export async function readProviderReconciliation(bible: ReadProviderReconciliationStore, args: {
    id: string;
}) {
    const { id } = args;
    const ledger = new BudgetLedger(bible);
    const ledgerSummary = ledger.getLedgerSummary(id);
    const summary = {
        ...ledgerSummary,
        estimatedUsd: ledgerSummary.estimatedCostUsd,
        reservedUsd: ledgerSummary.reservedCostUsd,
        confirmedUsd: ledgerSummary.confirmedCostUsd,
        uncertainUsd: ledgerSummary.uncertainCostUsd,
        totalCommittedUsd: ledgerSummary.totalCommittedUsd,
        availableUsd: ledgerSummary.remainingAvailableUsd,
        budgetCapUsd: ledgerSummary.maxBudgetUsd,
    };
    const jobs = bible.listProviderJobs(id);
    const characters = bible.listCharacters(id);
    const turnarounds = [];
    for (const c of characters) {
        const pack = await CharacterTurnaroundBridge.getOrGenerateTurnaroundPack(c.id, id, bible, { autoGenerate: false, allowMock: false });
        turnarounds.push({
            characterId: c.id,
            characterName: c.name,
            hasTurnaround: Boolean(pack),
            views: pack
                ? {
                    front: pack.views.front.imagePath,
                    threeQuarter: pack.views.threeQuarter.imagePath,
                    profile: pack.views.profile.imagePath,
                    fullBody: pack.views.fullBody.imagePath,
                }
                : null,
            faceEmbeddingLength: pack?.faceEmbedding.length ?? 0,
            embeddingStatus: pack?.faceEmbedding.length ? "verified" : "unavailable",
        });
    }
    const tokenSavings = ledger.getTokenSavingsSummary(id);
    return {
        summary,
        videoBudgetScope: "video_attempts_only",
        legacyOwnership:{count:bible.unresolvedUsage?.(id)??0,rows:bible.legacyUsageReview?.(id)??[]},
        groups: bible.listGroups(),
        audit: jobs.flatMap(job => bible.listAudit(job.id)),
        tokenSavings,
        llmRequests: bible.listAudit("llm:" + id),
        jobs: jobs.slice(-50),
        turnarounds,
    };
}
