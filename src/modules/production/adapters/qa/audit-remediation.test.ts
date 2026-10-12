import {containedPath} from '../../../../platform/filesystem/containment.js';
import {symlink} from 'node:fs/promises';
import {FileAudioGenerationStore} from '../filesystem/audio-generation-store.js';
import {it,expect,vi,afterEach} from 'vitest';
import {mkdir,writeFile,readFile,mkdtemp,rm} from 'node:fs/promises';
import {join,resolve,relative} from 'node:path';
import {EventEmitter} from 'node:events';
import nock from 'nock';
import {probeAudioFile,probeVideoFile} from '../../../../modules/media/adapters/media-validator.js';
import {EpisodicScriptSchema} from '../../../../contracts/episode.js';
import {EpisodeAudioAssembler,resolveVoiceForDialogue} from '../../../../modules/media/application/audio-assembler.js';
import {ProduceAudio} from '../../../../modules/production/application/produce-audio.js';
import {computeAudioFingerprint} from '../../../../modules/production/application/episode-fingerprints.js';
import {hashFile} from '../../../../modules/media/adapters/artifact-store.js';
import {createValidMockMp3File} from '../../../../modules/media/adapters/assets/mock-media-generator.js';
import {SqliteStoryStore} from '../../../../bootstrap/sqlite-story-store.js';
import {ProviderDispatchStore} from '../../../../modules/production/adapters/sqlite/provider-dispatch-store.js';
import {ProviderDispatcher} from '../../../../modules/production/application/dispatch/provider-dispatcher.js';
import {route03_events} from '../../../../apps/http/routes/route03_events.js';
import {route08_maintenance} from '../../../../apps/http/routes/route08_maintenance.js';
import {route30_postProcess} from '../../../../apps/http/routes/route30_postProcess.js';
import {ElevenLabsClient} from '../../../../modules/media/adapters/tts/elevenlabs-client.js';
import {LucylabClient} from '../../../../modules/media/adapters/tts/lucylab-client.js';
import {createDialogueTts} from '../../../../bootstrap/episode-tts.js';
import {checkRequestOrigin} from '../../../../apps/http/http-safety.js';
import {NleRoundTripConformer} from '../../../../modules/media/adapters/assembly/nle-conformer.js';

const directories:string[]=[];
const root=resolve('output/test-audit-remediation');
async function directory(){await mkdir(root,{recursive:true});const path=await mkdtemp(join(root,'case-'));directories.push(path);return path;}
const cfg:any={ttsProvider:'elevenlabs',elevenlabsVoiceId:'old',elevenlabsModelId:'model',ttsMockFallback:false};
function script(dialogueId='d'){return EpisodicScriptSchema.parse({seriesId:'audit',episodeNumber:1,title:'Audit',logline:'Audit',scenes:[{sceneNumber:1,locationId:'room',locationName:'Room',shots:[{shotId:'s',durationSec:3,visualPrompt:'Room',dialogues:[{dialogueId,characterId:'narrator',text:'hello',speakerName:'Narrator'}]}]}]});}
afterEach(async()=>{vi.useRealTimers();nock.cleanAll();for(const path of directories.splice(0))await rm(path,{recursive:true,force:true});});

it('F04 corrupt media fails closed',async()=>{
 const dir=await directory(),audio=join(dir,'garbage.mp3'),video=join(dir,'fabricated.mp4');
 await writeFile(audio,Buffer.alloc(100,0x41));
 const bytes=Buffer.alloc(256);bytes.write('ftyp',4);bytes.write('mvhd',32);await writeFile(video,bytes);
 const a=await probeAudioFile(audio),v=await probeVideoFile(video);
 expect(a.isValid).toBe(false);expect(v.isValid).toBe(false);expect(v.durationSec).toBe(0);

});
it('F01 direct assembler rejects unsafe dialogue before writing',async()=>{
 const dir=await directory(),target=join(dir,'sentinel.mp3');await writeFile(target,'original');let path='';
 const assembler=new EpisodeAudioAssembler({cfg,createTts:()=>({generate:async(_text:string,out:string)=>{path=out;await writeFile(out,'overwritten');throw new Error('stop after observed write');}})} as any);
 await expect(assembler.assembleEpisodeAudio({script:{...script(),scenes:[{...script().scenes[0],shots:[{...script().scenes[0].shots[0],dialogues:[{...script().scenes[0].shots[0].dialogues[0],dialogueId:'x/../../sentinel'}]}]}]},bible:{},outputDir:dir,mockTts:false} as any)).rejects.toThrow();
 expect(await readFile(target,'utf8')).toBe('original');expect(path).toBe('');

});
it('F08 incomplete resume requires review without TTS',async()=>{
 const dir=await directory(),audio=join(dir,'audio.mp3'),s=script();await createValidMockMp3File(audio,8);
 const assemble=vi.fn();const job:any={jobId:'a',seriesId:'audit',episodeNumber:1,shots:{s:{shotId:'s',durationSec:3}},audioPath:audio,audioSha256:await hashFile(audio),audioFingerprint:computeAudioFingerprint(s,0,{...cfg,mockTts:true})};
 const output=new ProduceAudio({audioGenerations:new FileAudioGenerationStore(),bible:{} as any,checkpoints:{load:vi.fn(),save:vi.fn()},audioAssembler:{getCfg:()=>cfg,resolveVoicePlan:async()=>[],assembleEpisodeAudio:assemble} as any}).execute({script:s,job,outputDir:dir,mockTts:true,effectiveConfig:{transitionDurationSec:0,fps:30,aspectRatio:'9:16',overflowPolicy:'extend_shot',configHash:'x'}} as any,{seriesId:'audit',resume:true});
 await expect(output).rejects.toMatchObject({code:'AUDIO_RESUME_REVIEW_REQUIRED'});expect(assemble).not.toHaveBeenCalled();

});
it('Bible voice changes invalidate the resolved synthesis fingerprint',async()=>{
 const s=script();s.scenes[0].shots[0].dialogues[0].characterId='actor';s.scenes[0].shots[0].dialogue=s.scenes[0].shots[0].dialogues[0];
 const assembler=new EpisodeAudioAssembler({cfg,createTts:()=>({generate:async()=>{}})});const oldPlan=await assembler.resolveVoicePlan(s,{getCharacter:()=>({voice_profile_id:'elevenlabs:old'})} as any);const newPlan=await assembler.resolveVoicePlan(s,{getCharacter:()=>({voice_profile_id:'elevenlabs:new'})} as any);const hash=computeAudioFingerprint(s,0,{...cfg,resolvedVoicePlan:oldPlan});
 const before=resolveVoiceForDialogue(s.scenes[0].shots[0],{getCharacter:()=>({voice_profile_id:'elevenlabs:old'})} as any,cfg);
 const after=resolveVoiceForDialogue(s.scenes[0].shots[0],{getCharacter:()=>({voice_profile_id:'elevenlabs:new'})} as any,cfg);
 expect(before.voiceId).not.toBe(after.voiceId);expect(computeAudioFingerprint(s,0,{...cfg,resolvedVoicePlan:newPlan})).not.toBe(hash);
});
it.each([undefined,-5])('failed job with invoice flag and amount %s preserves a one-dollar uncertain reservation',async amount=>{
 const bible=new SqliteStoryStore(':memory:'),store=new ProviderDispatchStore(':memory:');
 try{
 const job:any={id:'j',series_id:'audit',episode_number:1,shot_id:'s',provider:'api_kling',spec_hash:'hash',status:'submitted',provider_job_id:'remote',estimated_cost_usd:1,reserved_cost_usd:1,confirmed_cost_usd:0,uncertain_cost_usd:0,cost_category:'reserved',attempt_count:1,max_attempts:1,metadata_json:'{}'};
 bible.createOrUpdateProviderJob(job);
 const gateway:any={getAdapter:()=>({pollStatus:async()=>({jobId:'remote',status:'failed',isConfirmedInvoice:true,invoicedCostUsd:amount})})};
 await expect(new ProviderDispatcher(bible,gateway,store,{workerId:'audit',pollIntervalMs:1,pollTimeoutMs:100,submitTimeoutMs:100}).execute(job,{backend:'api_kling'} as any)).rejects.toThrow('billing is unknown or invalid');
 const actual=bible.getProviderJob('j')!;expect(actual.confirmed_cost_usd).toBe(0);expect(actual.reserved_cost_usd).toBe(0);expect(actual.uncertain_cost_usd).toBe(1);

 }finally{store.close();bible.close();}
});
it('F17 underscore does not charge another series legacy logs',()=>{
 const bible=new SqliteStoryStore(':memory:');try{bible.logApiUsage({series_id:'sXa',episode_number:1,shot_id:'sXa_sh',provider:'tts',type:'tts',units:1,cost_usd:20,timestamp:new Date().toISOString()} as any);
 expect(bible.getSeriesBudgetLedger('s_a').confirmedCostUsd).toBe(0);
 }finally{bible.close();}
});
it('F05 SSE isolates a database exception and clears the timer',async()=>{
 vi.useFakeTimers();const req=Object.assign(new EventEmitter(),{method:'GET',headers:{}}),res=Object.assign(new EventEmitter(),{writeHead:vi.fn(),write:vi.fn(),end:vi.fn()});let calls=0;
 const timers=new Set<any>();await route03_events(req as any,res as any,new URL('http://localhost/api/events'),vi.fn(),{store:{list:()=>[],events:()=>{if(++calls>1)throw new Error('SQLITE_BUSY');return [];}} as any,streams:new Set(),timers});
 expect(()=>vi.advanceTimersByTime(1000)).not.toThrow();expect(timers.size).toBe(0);for(const timer of timers)clearInterval(timer);
});
it('maintenance excludes a second request before awaiting the Bible',async()=>{
 let release=()=>{};const gate=new Promise<void>(resolve=>{release=resolve;});let calls=0;
 const dispatchStore=new ProviderDispatchStore(':memory:');
 try{const ctx:any={dispatchStore,withBible:async(_id:string,fn:Function)=>{calls++;await gate;return fn({listPendingJobsForSeries:()=>[]});}};
 const call=()=>route08_maintenance({method:'POST'} as any,{} as any,new URL('http://localhost/api/v1/series/audit/usage'),vi.fn(),ctx).catch(e=>e.message);
 const first=call(),second=call();expect(calls).toBe(1);expect(await second).toBe('PROJECT_BUSY');release();expect(await first).toBe('METHOD_NOT_ALLOWED');expect(dispatchStore.seriesCoordinator.isUnderMaintenance('audit')).toBe(false);
 }finally{release();dispatchStore.close();}
});
it('F06 legacy postprocess rejects active maintenance',async()=>{
 const enqueue=vi.fn().mockResolvedValue({id:'j'});const send=vi.fn();
 const ctx:any={maintenance:new Set(['audit']),mediaJobs:{enqueueLegacy:enqueue},startWorker:vi.fn(),store:{assertSeriesAvailable:()=>{throw new Error('PROJECT_BUSY');},summary:(j:any)=>j}};
 const req:any=Object.assign(new EventEmitter(),{method:'POST',headers:{},async *[Symbol.asyncIterator](){yield Buffer.from('{}');}});
 await expect(route30_postProcess(req,{} as any,new URL('http://localhost/api/v1/series/audit/cinematic-post/process'),send,ctx)).rejects.toThrow('PROJECT_BUSY');expect(enqueue).not.toHaveBeenCalled();
});
it('F07 disk-write failure never repeats a paid POST',async()=>{
 const dir=await directory(),invalidOutput=join(dir,'missing','voice.mp3');let submits=0;
 nock('http://localhost:44559').post('/text-to-speech/v').once().reply(()=>{submits++;return [200,Buffer.from('audio')];});
 const client=new ElevenLabsClient({apiKey:'fake',voiceId:'v',modelId:'m',endpoint:'http://localhost:44559'});
 const pending=client.generate('hello',invalidOutput);const assertion=expect(pending).rejects.toThrow();
 await new Promise(resolve=>setTimeout(resolve,1300));nock.cleanAll();await assertion;expect(submits).toBe(1);
});
it('F03 LucyLab rejects loopback download URL',async()=>{
 const dir=await directory();
 nock('http://localhost:44558').post('/rpc',body=>body.method==='ttsLongText').reply(200,{result:{projectExportId:'e'}}).post('/rpc',body=>body.method==='getExportStatus').reply(200,{result:{state:'completed',url:'http://127.0.0.1:44557/private'}});
 const privateEndpoint=nock('http://127.0.0.1:44557').get('/private').reply(200,'internal-data');
 await expect(new LucylabClient({apiKey:'fake',voiceId:'v',endpoint:'http://localhost:44558/rpc',pollIntervalMs:1,pollTimeoutMs:100}).generate('hello',join(dir,'voice.mp3'))).rejects.toThrow('TTS_DOWNLOAD_URL_FORBIDDEN');
 expect(privateEndpoint.isDone()).toBe(false);
});
it('F16 F5 factory forwards reference configuration',()=>{
 const client:any=createDialogueTts({...cfg,ttsProvider:'f5tts',f5ttsRefAudio:'speaker.wav',f5ttsRefText:'reference',f5ttsEndpoint:'http://localhost:44556'},'f5tts','default',false);
 expect(client.client.cfg.defaultRefAudio).toBe('speaker.wav');expect(client.client.cfg.defaultRefText).toBe('reference');
});
it('F02 remote binding and forged LAN request are rejected',()=>{
 expect(()=>checkRequestOrigin({headers:{host:'127.0.0.1:3456'},method:'GET',socket:{remoteAddress:'192.168.1.15'}} as any,'0.0.0.0',3456)).toThrow();
});
it('F11 terminal webhook retains a later invoice',()=>{
 const store=new ProviderDispatchStore(':memory:');try{
 store.receiveWebhook('api_kling',{jobId:'r',status:'completed',videoUrl:'https://example.com/v.mp4'});
 store.receiveWebhook('api_kling',{jobId:'r',status:'completed',videoUrl:'https://example.com/v.mp4',invoicedCostUsd:3,isConfirmedInvoice:true});
 expect(store.webhook('api_kling','r')?.invoicedCostUsd).toBe(3);
 }finally{store.close();}
});
function nleFixture(){return {fps:24,episodeNumber:1,targetTotalDurationSec:10,videoTrack:[{shotId:'shot_1',startSec:0,endSec:10,durationSec:10}],dialogueTrack:[{shotId:'shot_1',dialogueId:'d1',startSec:1,endSec:2,durationSec:1},{shotId:'shot_1',dialogueId:'d2',startSec:4,endSec:5,durationSec:1}],subtitleTrack:[{shotId:'shot_1',dialogueId:'d1',startSec:1,endSec:2,durationSec:1},{shotId:'shot_1',dialogueId:'d2',startSec:4,endSec:5,durationSec:1}],sfxTrack:[]};}
it('F13 unchanged NLE preserves second dialogue subtitle timing',()=>{
 const result=NleRoundTripConformer.conform(nleFixture() as any,{fps:24,videoClips:[{id:'c',name:'shot_1',startFrame:0,endFrame:240,inFrame:0,outFrame:240,durationFrames:240}]} as any);
 expect(result.hasModifications).toBe(false);expect(result.conformedTimeline.subtitleTrack?.[1].startSec).toBe(4);
});
it('F14 deleted NLE shot removes anchored cues',()=>{
 const result=NleRoundTripConformer.conform(nleFixture() as any,{fps:24,videoClips:[]} as any);
 expect(result.diffReport.removedShots).toEqual(['shot_1']);expect(result.conformedTimeline.dialogueTrack).toHaveLength(0);expect(result.conformedTimeline.subtitleTrack).toHaveLength(0);
});

it('F14 equal-duration head trim maps dialogue and subtitle offsets',()=>{
 const fixture=nleFixture(); const result=NleRoundTripConformer.conform(fixture as any,{fps:24,videoClips:[{id:'c',name:'shot_1',startFrame:0,endFrame:240,inFrame:24,outFrame:264,durationFrames:240}]} as any);
 expect(result.hasModifications).toBe(true);expect(result.conformedTimeline.dialogueTrack[1].startSec).toBe(3);expect(result.conformedTimeline.subtitleTrack?.[1].startSec).toBe(3);expect(result.conformedTimeline.videoTrack[0].endFrame).toBe(240);
});
it('F14 orphan shot cues require review while known removed cues are discarded',()=>{
 const fixture=nleFixture();fixture.sfxTrack=[{shotId:'missing',startSec:1,durationSec:1}] as any;
 try {NleRoundTripConformer.conform(fixture as any,{fps:24,videoClips:[]} as any);throw new Error('Expected rejection');}catch(error:any){expect(error.code).toBe('NLE_ORPHAN_CUE');expect(error.disposition).toBe('needs_review');}
});
it('F14 global ambience keeps its offset and clips to the new duration',()=>{
 const fixture:any=nleFixture();fixture.ambienceTrack=[{startSec:2,durationSec:6}];
 const result=NleRoundTripConformer.conform(fixture,{fps:24,videoClips:[{id:'c',name:'shot_1',startFrame:0,endFrame:120,inFrame:0,outFrame:120,durationFrames:120}]} as any);
 expect(result.conformedTimeline.ambienceTrack?.[0].startSec).toBe(2);expect(result.conformedTimeline.ambienceTrack?.[0].durationSec).toBe(3);
});
it('F13 subtitles whose dialogue was fully trimmed away are removed',()=>{
 const result=NleRoundTripConformer.conform(nleFixture() as any,{fps:24,videoClips:[{id:'c',name:'shot_1',startFrame:0,endFrame:24,inFrame:0,outFrame:24,durationFrames:24}]} as any);
 expect(result.conformedTimeline.dialogueTrack).toHaveLength(0);expect(result.conformedTimeline.subtitleTrack).toHaveLength(0);
});

it('F01 assembler refuses a pre-existing audio junction before TTS',async()=>{
 const dir=await directory(),outside=await directory();await symlink(outside,join(dir,'audio'),process.platform==='win32'?'junction':'dir');
 const generate=vi.fn();const assembler=new EpisodeAudioAssembler({cfg,createTts:()=>({generate})} as any);
 await expect(assembler.assembleEpisodeAudio({script:script(),bible:{},outputDir:dir,mockTts:false} as any)).rejects.toThrow('PATH_FORBIDDEN');expect(generate).not.toHaveBeenCalled();
});
it('F01 generation exports refuse an artifacts junction',async()=>{
 const dir=await directory(),outside=await directory();await symlink(outside,join(dir,'artifacts'),process.platform==='win32'?'junction':'dir');
 await expect(new FileAudioGenerationStore().materialize(dir,{} as any,{} as any)).rejects.toThrow('PATH_FORBIDDEN');
});

it('F01 dangling symlink ancestors cannot bypass containment',async()=>{
 const dir=await directory(),outside=await directory();await symlink(join(outside,'not-created'),join(dir,'dangling'),process.platform==='win32'?'junction':'dir');
 expect(()=>containedPath(dir,join(dir,'dangling','voice.mp3'))).toThrow('PATH_FORBIDDEN');
});

it('F05 initial SSE failure cleans listeners and does not retain a dead stream',async()=>{
 const req=Object.assign(new EventEmitter(),{method:'GET',headers:{}}),res=Object.assign(new EventEmitter(),{writeHead:vi.fn(),write:vi.fn(),destroy:vi.fn()}),streams=new Set<any>(),timers=new Set<any>();
 await route03_events(req as any,res as any,new URL('http://localhost/api/events'),vi.fn(),{store:{list:()=>{throw new Error('DB closed');}} as any,streams,timers});
 expect(streams.size).toBe(0);expect(timers.size).toBe(0);expect(req.listenerCount('close')).toBe(0);expect(res.listenerCount('error')).toBe(0);expect(res.destroy).toHaveBeenCalledOnce();
});
it('F05 SSE socket errors close the stream without an unhandled error',async()=>{
 vi.useFakeTimers();const req=Object.assign(new EventEmitter(),{method:'GET',headers:{}}),res=Object.assign(new EventEmitter(),{writeHead:vi.fn(),write:vi.fn(),destroy:vi.fn()}),streams=new Set<any>(),timers=new Set<any>();
 await route03_events(req as any,res as any,new URL('http://localhost/api/events'),vi.fn(),{store:{list:()=>[],events:()=>[]} as any,streams,timers});
 expect(()=>res.emit('error',new Error('socket failed'))).not.toThrow();expect(streams.size).toBe(0);expect(timers.size).toBe(0);expect(req.listenerCount('close')).toBe(0);expect(res.destroy).toHaveBeenCalledOnce();
});
