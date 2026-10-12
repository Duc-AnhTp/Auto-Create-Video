import {randomUUID} from 'node:crypto';
import {mkdir,readFile,writeFile,rename,rm} from 'node:fs/promises';
import {join,basename,resolve} from 'node:path';
import {hashFile,probeAudioFile} from '../../../media/index.js';
import {UnifiedTimelineSchema,type UnifiedTimeline} from '../../../../contracts/timeline.js';
import type {AudioGenerationManifest} from '../../../../contracts/audio-generation.js';
import type {AudioGenerationStore} from '../../ports/audio-generation-store.js';
import {WorkflowError} from '../../../../platform/workflow-error.js';
import {containedPath} from '../../../../platform/filesystem/containment.js';
import {assertMediaOwnership,publishMediaRename} from '../../../../platform/processes/media-process-runner.js';

async function atomicWrite(path: string, content: string | Uint8Array): Promise<void> {
  const temp = path + '.' + randomUUID() + '.tmp';
  try {
    await writeFile(temp, content);
    assertMediaOwnership();
    publishMediaRename(temp, path);
  } finally {
    await rm(temp, { force: true }).catch(() => {});
  }
}
async function atomicJson(path: string, value: unknown): Promise<void> {
  await atomicWrite(path, JSON.stringify(value, null, 2));
}
export class FileAudioGenerationStore implements AudioGenerationStore {
 async prepare(outputDir:string):Promise<string>{await mkdir(outputDir,{recursive:true});const path=containedPath(outputDir,join(outputDir,'audio-generations',randomUUID()));await mkdir(path,{recursive:true});return path;}
 async commit(input:Parameters<AudioGenerationStore['commit']>[0]):Promise<AudioGenerationManifest>{
  const timeline=UnifiedTimelineSchema.parse(input.timeline), probe=await probeAudioFile(input.audioPath);
  if(!probe.isValid||Math.abs(probe.durationSec-timeline.targetTotalDurationSec)>Math.max(1/input.fps,0.12))throw new WorkflowError('AUDIO_TIMELINE_MISMATCH','Audio và timeline không khớp.','needs_review');
  const timelinePath=join(input.directory,'timeline.json'),scriptPath=join(input.directory,'script-normalized.json');
  await atomicJson(timelinePath,timeline);await atomicJson(scriptPath,input.script);
  const manifest:AudioGenerationManifest={version:1,generationId:basename(input.directory),fingerprint:input.fingerprint,mockTts:input.mockTts,fps:input.fps,durationSec:probe.durationSec,codecPaddingToleranceSec:0.12,audio:{path:input.audioPath,sha256:await hashFile(input.audioPath)},timeline:{path:timelinePath,sha256:await hashFile(timelinePath)},script:{path:scriptPath,sha256:await hashFile(scriptPath)},planningShotDurations:input.planningShotDurations,shotDurations:Object.fromEntries(timeline.videoTrack.map(shot=>[shot.shotId,shot.durationSec]))};
  await atomicJson(join(input.directory,'manifest.json'),manifest);return manifest;
 }
 async reuse(job:Parameters<AudioGenerationStore['reuse']>[0],script:Parameters<AudioGenerationStore['reuse']>[1],fingerprint:string,mockTts:boolean,outputDir:string,fps?:number){
  try{
   let manifest=job.audioGeneration;
   if(manifest){
    if(!/^[a-f0-9-]{36}$/.test(manifest.generationId))throw new Error('generation id');
    if(manifest.version!==1||manifest.fingerprint!==fingerprint||manifest.mockTts!==mockTts)throw new Error('fingerprint');
    for(const asset of [manifest.audio,manifest.timeline,manifest.script]){containedPath(outputDir,resolve(asset.path));if(await hashFile(asset.path)!==asset.sha256)throw new Error('checksum');}
    const recorded=JSON.parse(await readFile(join(outputDir,'audio-generations',manifest.generationId,'manifest.json'),'utf8'));
    if(JSON.stringify(recorded)!==JSON.stringify(manifest))throw new Error('manifest');
   }else{
    if(!job.audioPath||!job.audioSha256||job.audioFingerprint!==fingerprint||await hashFile(job.audioPath)!==job.audioSha256)throw new Error('legacy fingerprint');
    const legacyPath=containedPath(outputDir,resolve(job.timelinePath??join(outputDir,'timeline.json')));
    const timeline=UnifiedTimelineSchema.parse(JSON.parse(await readFile(legacyPath,'utf8')));
    const directory=await this.prepare(outputDir);
    const normalized=structuredClone(script);
    for(const scene of normalized.scenes)for(const shot of scene.shots){const cue=timeline.videoTrack.find(value=>value.shotId===shot.shotId);if(cue)shot.durationSec=cue.durationSec;}
    manifest=await this.commit({directory,audioPath:containedPath(outputDir,resolve(job.audioPath)),timeline,script:normalized,fingerprint,mockTts,fps:timeline.fps,planningShotDurations:Object.fromEntries(script.scenes.flatMap(scene=>scene.shots.map(shot=>[shot.shotId,shot.durationSec])))});
   }
   const timeline=UnifiedTimelineSchema.parse(JSON.parse(await readFile(manifest.timeline.path,'utf8')));
   const tolerance=manifest.codecPaddingToleranceSec??0.05;if(!Number.isFinite(tolerance)||tolerance<0||tolerance>0.12)throw new Error('codec tolerance');
   if(manifest.fps!==timeline.fps||(fps!==undefined&&fps!==timeline.fps)||Math.abs(manifest.durationSec-timeline.targetTotalDurationSec)>Math.max(1/timeline.fps,tolerance))throw new Error('timebase');
   for(const cue of timeline.videoTrack){if(manifest.shotDurations[cue.shotId]!==cue.durationSec||Math.abs(cue.endSec-cue.startSec-cue.durationSec)>1/timeline.fps||Math.abs(cue.durationFrames/timeline.fps-cue.durationSec)>1/timeline.fps)throw new Error('shot duration');}
   const ids=script.scenes.flatMap(scene=>scene.shots.map(shot=>shot.shotId)).sort();
   if(JSON.stringify(ids)!==JSON.stringify(timeline.videoTrack.map(shot=>shot.shotId).sort()))throw new Error('shots');
   const probe=await probeAudioFile(manifest.audio.path);
   if(!probe.isValid||Math.abs(probe.durationSec-timeline.targetTotalDurationSec)>Math.max(1/timeline.fps,0.12))throw new Error('duration');
   return {manifest,timeline};
  }catch(error){throw new WorkflowError('AUDIO_RESUME_REVIEW_REQUIRED','Không đủ bằng chứng khôi phục audio/timeline. Tài sản được giữ lại; cần kiểm tra hoặc yêu cầu tạo lại.', 'needs_review',{cause:error});}
 }
 async materialize(outputDir:string,manifest:AudioGenerationManifest,timeline:UnifiedTimeline,effectiveConfig?:import('../../../../contracts/episode.js').EffectiveRenderConfig){
  const artifacts=containedPath(outputDir,join(outputDir,'artifacts'));
  await mkdir(artifacts,{recursive:true});
  const exported={...timeline,shots:timeline.videoTrack,transitionDurationSec:effectiveConfig?.transitionDurationSec,effectiveRenderConfig:effectiveConfig};
  const exportedJson=JSON.stringify(exported,null,2);
  const scriptText=await readFile(manifest.script.path,'utf8');
  await Promise.all([
    atomicWrite(containedPath(outputDir,join(outputDir,'timeline.json')),exportedJson),
    atomicWrite(containedPath(outputDir,join(artifacts,'unified_timeline.json')),exportedJson),
    atomicWrite(containedPath(outputDir,join(outputDir,'script-normalized.json')),scriptText),
  ]);
 }
}
