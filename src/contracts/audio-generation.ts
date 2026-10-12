import type {TtsProvider} from './config.js';
export interface ResolvedVoicePlan {
 dialogueId:string; provider:TtsProvider; voiceId:string; modelId?:string;
 referenceAudio?:string; referenceAudioSha256?:string; referenceText?:string;
 text:string; actingInstruction?:string; speed:number;
}
export interface AudioGenerationManifest {
 version:1; generationId:string; fingerprint:string; mockTts:boolean; fps:number; durationSec:number; codecPaddingToleranceSec?:number;
 audio:{path:string;sha256:string}; timeline:{path:string;sha256:string}; script:{path:string;sha256:string};
 shotDurations:Record<string,number>;
 planningShotDurations?:Record<string,number>;
}
