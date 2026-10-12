import { SeasonArcController } from "../../domain/season-arc-controller.js";
import type { ReadSeasonContinuityStore } from "../../ports/studio/read-season-continuity-store.js";
export function readSeasonContinuity(bible: ReadSeasonContinuityStore, args: {
    id: string;
    epNum: number;
}) {
    const { id, epNum } = args;
    return SeasonArcController.extractCrossEpisodeState(bible, id, epNum);
}
