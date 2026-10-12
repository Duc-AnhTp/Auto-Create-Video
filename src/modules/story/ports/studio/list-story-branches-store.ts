import type { TimelineBranchRecord } from "../../adapters/sqlite/timeline-branch-manager.js";
export interface ListStoryBranchesStore {
    listBranches(seriesId: string): TimelineBranchRecord[];
}
