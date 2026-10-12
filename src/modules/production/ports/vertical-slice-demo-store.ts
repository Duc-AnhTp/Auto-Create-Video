import type {CharacterTurnaroundBridgeStore} from "./character-turnaround-bridge-store.js";
import type {CanonInvariantValidatorStore} from "../../story/index.js";
import type {SemanticMemoryStore} from "../../story/index.js";

import type { SeriesMetadataRecord, CharacterRecord, LocationRecord, KeyPropRecord } from "../../../contracts/story.js";



export interface VerticalSliceDemoStore extends CharacterTurnaroundBridgeStore,CanonInvariantValidatorStore,SemanticMemoryStore {
getSeriesMetadata(id?: string): SeriesMetadataRecord | null;
upsertSeriesMetadata(meta: SeriesMetadataRecord): void;
listCharacters(seriesId?: string): CharacterRecord[];
listKeyProps(seriesId?: string): KeyPropRecord[];
listLocations(seriesId?: string): LocationRecord[];
getCharacter(id: string, seriesId?: string): CharacterRecord | null;
}
