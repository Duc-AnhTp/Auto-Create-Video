import type { TimelineBranchRecord, ForkBranchOptions } from "../../adapters/sqlite/timeline-branch-manager.js";
export interface ForkStoryBranchStore {
    forkBranch(seriesId: string, options: ForkBranchOptions): TimelineBranchRecord;
}
