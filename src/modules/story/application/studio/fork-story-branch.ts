import type { ForkStoryBranchStore } from "../../ports/studio/fork-story-branch-store.js";
export function forkStoryBranch(bible: ForkStoryBranchStore, args: {
    id: string;
    body: {
        name: string;
        description?: string | undefined;
        parentBranchId?: string | undefined;
        fromSnapshotId?: string | undefined;
        fromEpisodeNumber?: number | undefined;
    };
}) {
    const { id, body } = args;
    return bible.forkBranch(id, body);
}
