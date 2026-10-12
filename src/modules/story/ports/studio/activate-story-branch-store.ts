export interface ActivateStoryBranchStore {
    promoteBranchToCanonical(seriesId: string, branchId: string): void;
}
