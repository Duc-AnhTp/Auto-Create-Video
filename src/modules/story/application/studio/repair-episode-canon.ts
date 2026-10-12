import { AutoBridgeGenerator } from "../../domain/canon-invariant-validator.js";
import type { RepairEpisodeCanonStore } from "../../ports/studio/repair-episode-canon-store.js";
export function repairEpisodeCanon(bible: RepairEpisodeCanonStore, args: {
    body: {
        scriptText: string;
        persistToBible?: boolean | undefined;
    };
    id: string;
    episode: number;
}) {
    const { body, id, episode } = args;
    return AutoBridgeGenerator.validateAndAutoRepair(body.scriptText, bible, id, episode, {
        persistToBible: body.persistToBible ?? true,
    });
}
