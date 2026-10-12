import type {EpisodeOptions,EpisodeResult} from './episode-options.js';
import type {CheckpointStore} from './checkpoint-store.js';
export interface EpisodeExecutor {produceEpisode(text:string,options?:EpisodeOptions):Promise<EpisodeResult>;loadCheckpoint:CheckpointStore['load'];}
