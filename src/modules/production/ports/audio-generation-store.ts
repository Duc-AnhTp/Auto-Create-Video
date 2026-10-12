import type {AudioGenerationManifest} from '../../../contracts/audio-generation.js';
import type {EpisodicScript,EpisodeProductionJob} from '../../../contracts/episode.js';
import type {UnifiedTimeline} from '../../../contracts/timeline.js';
export interface AudioGenerationStore {
 prepare(outputDir:string):Promise<string>;
 commit(input:{directory:string;audioPath:string;timeline:UnifiedTimeline;script:EpisodicScript;fingerprint:string;mockTts:boolean;fps:number;planningShotDurations?:Record<string,number>}):Promise<AudioGenerationManifest>;
 reuse(job:EpisodeProductionJob,script:EpisodicScript,fingerprint:string,mockTts:boolean,outputDir:string,fps?:number):Promise<{manifest:AudioGenerationManifest;timeline:UnifiedTimeline}>;
 materialize(outputDir:string,manifest:AudioGenerationManifest,timeline:UnifiedTimeline,effectiveConfig?:import('../../../contracts/episode.js').EffectiveRenderConfig):Promise<void>;
}
