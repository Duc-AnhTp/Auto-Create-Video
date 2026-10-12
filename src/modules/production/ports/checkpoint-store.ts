import type { EpisodeProductionJob } from "../../../contracts/episode.js";
export interface CheckpointStore { load(outputDir:string):Promise<EpisodeProductionJob|null>; save(outputDir:string,job:EpisodeProductionJob):Promise<void> }
