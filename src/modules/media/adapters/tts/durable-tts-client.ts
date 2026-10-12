import {createHash,randomUUID} from 'node:crypto';
import {copyFile,mkdir,rename,rm} from 'node:fs/promises';
import {dirname} from 'node:path';
import type {TtsClient,TtsGenerateOptions,TtsGenerationResult} from '../../../../contracts/tts.js';
import type {TtsAttemptStore,TtsAttempt} from '../../ports/tts-attempt-store.js';
import {hashFile} from '../artifact-store.js';
import {probeAudioFile} from '../media-validator.js';
import {WorkflowError} from '../../../../platform/workflow-error.js';
import {log} from '../../../../platform/observability/logger.js';
export class DurableTtsClient implements TtsClient {
 constructor(private client:TtsClient,private provider:string,private openStore:()=>TtsAttemptStore){}
 async generate(text:string,audioOutPath:string,srtOutPath?:string,options?:TtsGenerateOptions):Promise<TtsGenerationResult>{
  const store=this.openStore();
  const id=createHash('sha256').update(options?.attemptKey??JSON.stringify([this.provider,audioOutPath,text,options?.voiceProfileId,options?.speed,options?.actingInstruction])).digest('hex');
  let attempt=store.get(id);const stage=attempt?.audioPath??audioOutPath+'.tts-staged.mp3';
  log.event('tts_attempt',{attemptId:id,provider:this.provider,state:attempt?.state??'prepared'});
  try{
   if(attempt?.sha256&&await hashFile(stage).catch(()=>null)===attempt.sha256&&(await probeAudioFile(stage)).isValid){options?.signal?.throwIfAborted();await this.promote(stage,audioOutPath);attempt.state='completed';store.save(attempt);return {provider:this.provider,remoteId:attempt.remoteId,audioPath:audioOutPath};}
   if(attempt&&!attempt.remoteId)throw new WorkflowError('TTS_SUBMIT_UNCERTAIN','Lần gọi TTS trước chưa rõ kết quả. Cần kiểm tra trước khi tạo lại.','needs_review');
   if(!attempt){attempt={id,seriesId:options?.seriesId,state:'prepared',provider:this.provider,audioPath:stage};if(!store.begin(attempt))throw new WorkflowError('TTS_SUBMIT_UNCERTAIN','TTS đã có lần gọi đang xử lý.','needs_review');attempt.state='submitting';}
   const result=await this.client.generate(text,stage,srtOutPath,{...options,remoteId:attempt.remoteId,onAccepted:async remoteId=>{attempt!.remoteId=remoteId;attempt!.state='accepted';store.save(attempt!);await options?.onAccepted?.(remoteId);}});
   if(!(await probeAudioFile(stage)).isValid)throw new Error('TTS_AUDIO_INVALID');
   attempt.sha256=await hashFile(stage);attempt.state='downloaded';store.save(attempt);
   options?.signal?.throwIfAborted();await this.promote(stage,audioOutPath);attempt.state='completed';store.save(attempt);
   return {...result,provider:this.provider,remoteId:attempt.remoteId,audioPath:audioOutPath};
  }catch(error){if(attempt){attempt.state=attempt.sha256?'downloaded':attempt.remoteId?'accepted':'uncertain';attempt.error=(error as {code?:string}).code??'TTS_ATTEMPT_FAILED';store.save(attempt);}if(error instanceof WorkflowError)throw error;throw new WorkflowError('TTS_RECOVERY_REQUIRED','TTS chưa hoàn tất; giữ tài sản và cần kiểm tra.','needs_review',{cause:error});}
  finally{store.close();}
 }
 private async promote(source:string,destination:string){await mkdir(dirname(destination),{recursive:true});const temporary=destination+'.'+randomUUID()+'.tmp';try{await copyFile(source,temporary);await rename(temporary,destination);}finally{await rm(temporary,{force:true});}}
}
