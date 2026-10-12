import type { ActivateStoryBranchStore } from "../../ports/studio/activate-story-branch-store.js";
export function activateStoryBranch(bible: ActivateStoryBranchStore, args: {
    id: string;
    branchId: string;
}) {
    const { id, branchId } = args;
    return bible.promoteBranchToCanonical(id, branchId);
}
