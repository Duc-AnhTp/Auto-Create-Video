import type { ApproveConformedTakesStore } from "../../ports/studio/approve-conformed-takes-store.js";
export function approveConformedTakes(bible: ApproveConformedTakesStore, args: {
    conformResult: import("../../../media/index.js").ConformedTimelineResult;
    id: string;
    epNum: number;
}) {
    const { conformResult, id, epNum } = args;
    for (const swap of conformResult.diffReport.swappedTakes) {
        const existingTakes = bible.listShotTakes(id, epNum, swap.shotId);
        const matchingTake = existingTakes.find((t) => t.take_number === swap.newTakeNumber);
        if (matchingTake) {
            bible.approveShotTake(matchingTake.id);
        }
    }
}
