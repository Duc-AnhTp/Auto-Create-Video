import {MediaArtifactCache} from '../adapters/artifact-cache.js';
export function createProviderMediaCache(path:string){return new MediaArtifactCache(path);}
