import type {SeasonArcControllerStore} from "./season-arc-controller-store.js";
import type {CharacterTurnaroundBridgeStore} from "./character-turnaround-bridge-store.js";
import type {CanonInvariantValidatorStore} from "../../story/index.js";

import type { SeriesMetadataRecord, CharacterRecord } from "../../../contracts/story.js";



export interface MultiEpisodeDemoStore extends SeasonArcControllerStore,CharacterTurnaroundBridgeStore,CanonInvariantValidatorStore {
getSeriesMetadata(id?: string): SeriesMetadataRecord | null;
upsertSeriesMetadata(meta: SeriesMetadataRecord): void;
listCharacters(seriesId?: string): CharacterRecord[];
upsertCharacter(char: CharacterRecord): void;
}
