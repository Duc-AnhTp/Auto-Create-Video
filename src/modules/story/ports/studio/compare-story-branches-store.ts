import type { MultiverseBranchDiff } from "../../adapters/sqlite/timeline-branch-manager.js";
export interface CompareStoryBranchesStore {
    compareBranches(seriesId: string, branchAId: string, branchBId: string): MultiverseBranchDiff;
}
