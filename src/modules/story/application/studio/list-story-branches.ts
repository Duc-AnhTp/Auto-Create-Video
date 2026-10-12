import type { ListStoryBranchesStore } from "../../ports/studio/list-story-branches-store.js";
export function listStoryBranches(bible: ListStoryBranchesStore, args: {
    id: string;
}) {
    const { id } = args;
    return bible.listBranches(id);
}
