import {DependencyInvalidationGraph as Graph} from '../../domain/dependency-graph.js';
import {hashString} from '../../domain/spec-hasher.js';
/** Reference I/O must be prepared before entering the synchronous domain graph. */
export class DependencyInvalidationGraph extends Graph { constructor(){super(hashString);} }
import {buildInvalidationGraph as build} from '../../domain/dependency-graph.js';
import {computeVideoSpecHash, computeAudioSpecHash} from './spec-fingerprint.js';
export async function buildInvalidationGraph(previous:Parameters<typeof build>[0], current:Parameters<typeof build>[1]){
 const prepared=[];
 for(const shot of current){
  const video=shot.video??shot.videoSpec, audio=shot.audio??shot.audioSpec;
  prepared.push({...shot,videoSpecHash:shot.videoSpecHash??(video?await computeVideoSpecHash(video):''),audioSpecHash:shot.audioSpecHash!==undefined?shot.audioSpecHash:(audio?await computeAudioSpecHash(audio):null)});
 }
 return build(previous,prepared,hashString);
}
