import type { CompareStoryBranchesStore } from "../../ports/studio/compare-story-branches-store.js";
export function compareStoryBranches(bible: CompareStoryBranchesStore, args: {
    id: string;
    branchA: string;
    branchB: string;
}) {
    const { id, branchA, branchB } = args;
    return bible.compareBranches(id, branchA, branchB);
}
