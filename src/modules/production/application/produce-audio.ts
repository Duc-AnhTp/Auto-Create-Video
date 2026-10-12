import {checkExecution} from './execution-control.js';
import {log} from '../../../platform/observability/logger.js';
import {WorkflowError} from '../../../platform/workflow-error.js';
import {computeAudioFingerprint} from './episode-fingerprints.js';
import type {EpisodeDependencies} from '../ports/episode-dependencies.js';
import type {EpisodeOptions} from '../ports/episode-options.js';
import type {ProduceAudioInput,ProduceAudioOutput} from './phases/contracts.js';

export class ProduceAudio {
 constructor(private dependencies:Pick<EpisodeDependencies,'audioAssembler'|'audioGenerations'|'checkpoints'|'bible'>){}
 async execute(input:ProduceAudioInput,options:EpisodeOptions):Promise<ProduceAudioOutput>{
  const ctx=this.dependencies,script=structuredClone(input.script),job=structuredClone(input.job);
  const visualDurations=new Map(script.scenes.flatMap(scene=>scene.shots.map(shot=>[shot.shotId,shot.durationSec] as const)));
  const planningDurations=new Map(visualDurations);
  await checkExecution(options);options.onProgress?.(3,8,'Sản xuất âm thanh');
  const cfg=ctx.audioAssembler.getCfg();
  const voicePlan=await ctx.audioAssembler.resolveVoicePlan(script,ctx.bible,options.signal);
  const fingerprintScript=structuredClone(script);
  for(const scene of fingerprintScript.scenes)for(const shot of scene.shots){const previous=job.audioGeneration;if(previous?.planningShotDurations&&shot.durationSec===previous.shotDurations[shot.shotId]){shot.durationSec=previous.planningShotDurations[shot.shotId];visualDurations.set(shot.shotId,shot.durationSec);planningDurations.set(shot.shotId,shot.durationSec);}}
  const fingerprint=computeAudioFingerprint(fingerprintScript,input.effectiveConfig.transitionDurationSec,{mockTts:input.mockTts,ttsEngine:options.ttsEngine,voiceConfigs:options.voiceConfigs,ttsProvider:cfg.ttsProvider,elevenlabsVoiceId:cfg.elevenlabsVoiceId,elevenlabsModelId:cfg.elevenlabsModelId,lucylabVoiceId:cfg.lucylabVoiceId,resolvedVoicePlan:voicePlan});
  let manifest:import('../../../contracts/audio-generation.js').AudioGenerationManifest;
  let audioRes:Partial<import('../../media/index.js').AssembleAudioResult>;
  if(options.resume&&(job.audioPath||job.audioGeneration)&&!options.regenerateAudio){
   const reused=await ctx.audioGenerations.reuse(job,script,fingerprint,Boolean(input.mockTts),input.outputDir,input.effectiveConfig.fps);
   manifest=reused.manifest;audioRes={unifiedTimeline:reused.timeline};
  }else{
   const directory=await ctx.audioGenerations.prepare(input.outputDir);
   const result=await ctx.audioAssembler.assembleEpisodeAudio({script,bible:ctx.bible,outputDir:directory,mockTts:input.mockTts,overflowPolicy:input.effectiveConfig.overflowPolicy,transitionDurationSec:input.effectiveConfig.transitionDurationSec,foleyGenerator:options.foleyGenerator,voicePlan,attemptScope:JSON.stringify([job.seriesId,job.episodeNumber,fingerprint,options.regenerateAudio?directory:null]),signal:options.signal,checkpoint:options.checkpoint});
   if(!result.unifiedTimeline)throw new WorkflowError('AUDIO_TIMELINE_MISSING','Audio thiếu timeline.','needs_review');
   for(const scene of script.scenes)for(const shot of scene.shots){const timed=result.unifiedTimeline.videoTrack.find(value=>value.shotId===shot.shotId);if(timed)shot.durationSec=timed.durationSec;}
   manifest=await ctx.audioGenerations.commit({directory,audioPath:result.finalAudioPath,timeline:result.unifiedTimeline,script,fingerprint,mockTts:Boolean(input.mockTts),fps:input.effectiveConfig.fps,planningShotDurations:Object.fromEntries(planningDurations)});audioRes=result;
  }
  for(const scene of script.scenes)for(const shot of scene.shots){shot.durationSec=manifest.shotDurations[shot.shotId];if(job.shots[shot.shotId])job.shots[shot.shotId].durationSec=shot.durationSec;}
  job.checkpointVersion=2;job.audioGeneration=manifest;job.audioPath=manifest.audio.path;job.timelinePath=manifest.timeline.path;job.audioFingerprint=manifest.fingerprint;job.audioSha256=manifest.audio.sha256;
  job.transitionDurationSec=input.effectiveConfig.transitionDurationSec;job.effectiveRenderConfig=input.effectiveConfig;
  await checkExecution(options);await ctx.checkpoints.save(input.outputDir,job);
  await ctx.audioGenerations.materialize(input.outputDir,manifest,audioRes.unifiedTimeline!,input.effectiveConfig);
  log.event('audio_generation_committed',{jobId:job.jobId,generationId:manifest.generationId,seriesId:job.seriesId,state:'committed'});
  return {script,job,visualDurations,planningDurations,audioPath:manifest.audio.path,audioRes,audioDurationSec:manifest.durationSec};
 }
}
