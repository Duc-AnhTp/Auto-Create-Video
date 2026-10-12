import { HierarchicalFilmAssembler } from '../modules/media/adapters/assembly/hierarchical-assembler.js';
import { MediaArtifactCache } from '../modules/media/adapters/artifact-cache.js';
import { ArtifactStore } from '../modules/media/adapters/artifact-store.js';
import type { MediaFactories } from '../modules/media/ports/media-factories.js';
export function createMediaFactories(): MediaFactories {
    return {
        createFilmAssembler: options => new HierarchicalFilmAssembler(options),
        createCache: path => new MediaArtifactCache(path),
        createArtifactStore: (store, paths) => new ArtifactStore(store, paths),
    };
}
