import { CanonInvariantValidator } from "../../domain/canon-invariant-validator.js";
import type { ValidateEpisodeCanonStore } from "../../ports/studio/validate-episode-canon-store.js";
export function validateEpisodeCanon(bible: ValidateEpisodeCanonStore, args: {
    body: {
        scriptText: string;
    };
    id: string;
    episode: number;
}) {
    const { body, id, episode } = args;
    return CanonInvariantValidator.validate(body.scriptText, bible, id, episode);
}
