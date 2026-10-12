import { applyNleEditsToBible } from "../../../media/index.js";
import type { ApplyNleIngestStore } from "../../ports/studio/apply-nle-ingest-store.js";
export async function applyNleIngest(bible: ApplyNleIngestStore, args: {
    diff: import("../../../media/index.js").NleDiffReport;
    seriesId: string;
    epNum: number;
}) {
    const { diff, seriesId, epNum } = args;
    return applyNleEditsToBible(diff, bible, seriesId, epNum);
}
