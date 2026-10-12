import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import type {ReferenceHasher} from '../../ports/reference-hasher.js';
import * as pure from '../../domain/spec-hasher.js';
export type {VideoSpecInput, AudioSpecInput, ShotSpecComposite} from '../../domain/spec-hasher.js';
export const canonicalizeJson=pure.canonicalizeJson;
export class StreamingReferenceHasher implements ReferenceHasher {
 constructor(private readStat:typeof stat=stat){}
 async hash(value?:string,signal?:AbortSignal):Promise<string|null> {
  if(!value)return null;
  signal?.throwIfAborted();
  if(value.startsWith('data:')){if(Buffer.byteLength(value)>64*1024*1024)throw new Error('REFERENCE_SIZE_INVALID');return pure.hashString(value);}
  if(/^https?:\/\//i.test(value))return pure.hashString(new URL(value).href);
  const path=value.startsWith('file:')?fileURLToPath(value):value;
  const before=await this.readStat(path);
  if(!before.isFile()||before.size>64*1024*1024)throw new Error('REFERENCE_SIZE_INVALID');
  const hash=createHash('sha256');let bytes=0;
  const stream=createReadStream(path,{highWaterMark:64*1024,signal});
  try {
   for await(const chunk of stream){bytes+=chunk.length;if(bytes>64*1024*1024)throw new Error('REFERENCE_SIZE_INVALID');hash.update(chunk);}
   const after=await this.readStat(path);
   if(before.size!==after.size||before.mtimeMs!==after.mtimeMs||before.ctimeMs!==after.ctimeMs||before.ino!==after.ino||bytes!==before.size)throw new Error('REFERENCE_CHANGED');
   signal?.throwIfAborted();return hash.digest('hex');
  }finally{stream.destroy();}
 }
}
export const hashFileOrString=(value?:string,signal?:AbortSignal)=>new StreamingReferenceHasher().hash(value,signal);
async function prepared<T>(compute:(hash:pure.ReferenceHasher)=>T,signal?:AbortSignal):Promise<T>{
 const values=new Set<string>();compute(value=>{if(value)values.add(value);return null;});
 const hashes=new Map<string,string|null>();for(const value of values)hashes.set(value,await hashFileOrString(value,signal));
 return compute(value=>value?hashes.get(value)!:null);
}
export const computeVideoSpecHash=(input:pure.VideoSpecInput,signal?:AbortSignal)=>prepared(hash=>pure.computeVideoSpecHash(input,hash),signal);
export const computeAudioSpecHash=(input:pure.AudioSpecInput,signal?:AbortSignal)=>prepared(hash=>pure.computeAudioSpecHash(input,hash),signal);
export const computeCompositeShotHash=(input:pure.ShotSpecComposite,signal?:AbortSignal)=>prepared(hash=>pure.computeCompositeShotHash(input,hash),signal);
