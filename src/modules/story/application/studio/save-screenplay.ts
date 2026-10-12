import { normalizeScript } from "../script-normalizer.js";
import type { SaveScreenplayStore } from "../../ports/studio/save-screenplay-store.js";
export async function saveScreenplay(bible: SaveScreenplayStore, args: {
    seriesId: string;
    body: {
        [x: string]: unknown;
        rawScreenplay: string;
        episodeNumber?: number | undefined;
    };
}) {
    const { body, seriesId } = args;
    return await normalizeScript(body.rawScreenplay, bible, {
        seriesId,
        skipAudit: true,
    });
}
