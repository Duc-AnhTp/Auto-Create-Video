import type { HierarchicalAssemblerOptions } from '../adapters/assembly/hierarchical-assembler.js';
import type { AssemblyManifest } from '../domain/manifest-schema.js';
import type { MediaArtifactCache } from '../adapters/artifact-cache.js';
import type { ArtifactStore } from '../adapters/artifact-store.js';
import type { ArtifactStoreStore } from './artifact-store-store.js';
import type { ProjectPaths } from '../../../platform/filesystem/project-paths.js';
export type { HierarchicalAssemblerOptions, SceneAssemblyInput } from '../adapters/assembly/hierarchical-assembler.js';
export interface FilmAssembler { assemble(): Promise<AssemblyManifest> }
export interface MediaFactories {
  createFilmAssembler(options: HierarchicalAssemblerOptions): FilmAssembler;
  createCache(path: string): Pick<MediaArtifactCache, 'hit' | 'record'>;
  createArtifactStore(store: ArtifactStoreStore, paths?: ProjectPaths): Pick<ArtifactStore, 'resolve' | 'latestMaster' | 'register'>;
}
