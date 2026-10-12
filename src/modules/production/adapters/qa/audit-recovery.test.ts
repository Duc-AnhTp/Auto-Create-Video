import {afterEach,describe,it,expect,vi} from 'vitest';
import {mkdir,mkdtemp,readFile,readdir,rename,rm,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {randomUUID,createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import nock from 'nock';
import {AssetId} from '../../../../contracts/asset-id.js';
import {JobStore} from '../sqlite/job-store.js';
import {ProviderDispatchStore} from '../sqlite/provider-dispatch-store.js';
import {SqliteTtsAttemptStore} from '../sqlite/tts-attempt-store.js';
import {DurableTtsClient} from '../../../media/adapters/tts/durable-tts-client.js';
import {createValidMockMp3File} from '../../../media/adapters/assets/mock-media-generator.js';
import {downloadTtsAsset} from '../../../media/adapters/tts/safe-tts-download.js';
import {StreamingReferenceHasher} from '../filesystem/spec-fingerprint.js';
import {SqliteStoryStore} from '../../../../bootstrap/sqlite-story-store.js';
import {reconcileProviderAttempts} from '../../../../bootstrap/provider-recovery.js';
import {recoverProjectRestores} from '../../../projects/adapters/filesystem/backup.js';
import {checkRequestOrigin} from '../../../../apps/http/http-safety.js';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {normalizeInvoiceAmount} from '../../../../contracts/invoice.js';
import {FileCheckpointStore} from '../filesystem/checkpoint-store.js';
import {FileAudioGenerationStore} from '../filesystem/audio-generation-store.js';
import {stat} from 'node:fs/promises';

async function crashAtBarrier(mode:string,root:string,action?:()=>void){
 const child=spawn(process.execPath,['--import','tsx',fileURLToPath(new URL('../../../../__test-utils__/audit-recovery-child.ts',import.meta.url)),mode,root],{stdio:['ignore','pipe','pipe'],windowsHide:true});
 let stderr='';child.stderr.on('data',chunk=>stderr+=chunk);
 const exit=new Promise<void>((resolve,reject)=>{child.once('error',reject);child.once('exit',()=>resolve());});
 try{
  await new Promise<void>((resolve,reject)=>{
   let output='';const timer=setTimeout(()=>reject(new Error('Crash barrier timeout: '+stderr)),15000);
   child.stdout.on('data',chunk=>{output+=chunk;if(output.includes('READY')){clearTimeout(timer);resolve();}});
   child.once('exit',(code,signal)=>{clearTimeout(timer);reject(new Error(`Child exited before barrier: ${code}/${signal}: ${stderr}`));});
   child.once('error',error=>{clearTimeout(timer);reject(error);});
  });
  action?.();
 }finally{child.kill('SIGKILL');await exit;}
}

const directories:string[]=[];
async function directory(){const path=await mkdtemp(join(tmpdir(),'audit-recovery-'));directories.push(path);return path;}
afterEach(async()=>{nock.cleanAll();vi.useRealTimers();for(const path of directories.splice(0))await rm(path,{recursive:true,force:true});});
describe('audit recovery invariants',()=>{
 it('F08 a child crash before checkpoint commit never selects its staged audio generation',async()=>{
  const root=await directory(),checkpoint=JSON.stringify({jobId:'previous',seriesId:'series',episodeNumber:1,shots:{}});await writeFile(join(root,'checkpoint.json'),checkpoint);
  await crashAtBarrier('generation',root);expect(await readFile(join(root,'checkpoint.json'),'utf8')).toBe(checkpoint);
  const job=await new FileCheckpointStore({listShotTakes:()=>[],getEquivalentShotIds:()=>[]}).load(root);
  expect((await readdir(join(root,'audio-generations'))).length).toBe(1);
  await expect(new FileAudioGenerationStore().reuse(job!,{scenes:[]} as any,'fingerprint',true,root)).rejects.toMatchObject({code:'AUDIO_RESUME_REVIEW_REQUIRED'});
 });
 it('F15 detects changed reference metadata at the validation boundary and yields the event loop',async()=>{
  const root=await directory(),path=join(root,'reference');await writeFile(path,Buffer.alloc(8*1024*1024,7));let turn=false;
  const scheduled=new Promise<void>(resolve=>setImmediate(()=>{turn=true;resolve();}));await new StreamingReferenceHasher().hash(path);expect(turn).toBe(true);await scheduled;
  let calls=0;const readStat=(async(file:any)=>{if(++calls===2)await writeFile(path,'changed');return stat(file);}) as typeof stat;
  await expect(new StreamingReferenceHasher(readStat).hash(path)).rejects.toThrow('REFERENCE_CHANGED');
 });
 it.each([undefined,null,false,true,'',' ',NaN,Infinity,-1,'invalid'])('F10 rejects invoice coercion from %s',value=>expect(normalizeInvoiceAmount(value)).toBeUndefined());
 it.each([0,'0',0.25,'0.25'])('F10 accepts a finite nonnegative provider amount %s',value=>expect(normalizeInvoiceAmount(value)).toBe(Number(value)));
 it('F17 migration assigns only a unique legacy owner and retains ambiguous rows for review',async()=>{
  const root=await directory(),path=join(root,'bible.db');let bible=new SqliteStoryStore(path);
  const job=(id:string,series:string,shot:string)=>({id,series_id:series,episode_number:1,shot_id:shot,provider:'api_kling',spec_hash:'hash',status:'failed',estimated_cost_usd:0,reserved_cost_usd:0,confirmed_cost_usd:0,uncertain_cost_usd:0,cost_category:'confirmed',attempt_count:1,max_attempts:1,is_retryable:false,metadata_json:'{}'} as const);
  bible.createOrUpdateProviderJob(job('unique','s_%','unique'));bible.createOrUpdateProviderJob(job('ambiguous-a','s_%','shared'));bible.createOrUpdateProviderJob(job('ambiguous-b','s_X','shared'));bible.close();
  const raw=new DatabaseSync(path);try{
   raw.exec("DELETE FROM canon_migrations WHERE version=13; INSERT INTO api_usage_logs(series_id,episode_number,shot_id,provider,type,units,cost_usd,timestamp) VALUES(NULL,1,'unique','api_kling','video',1,3,'2026-10-12'),(NULL,1,'shared','api_kling','video',1,9,'2026-10-12')");
  }finally{raw.close();}
  try{
   bible=new SqliteStoryStore(path);expect(bible.unresolvedUsage('s_%')).toBe(1);expect(bible.unresolvedUsage('s_X')).toBe(1);expect(bible.unresolvedUsage('other')).toBe(0);bible.close();
   bible=new SqliteStoryStore(path);const verify=new DatabaseSync(path);try{expect(verify.prepare('SELECT series_id FROM api_usage_logs WHERE shot_id=?').get('unique')?.series_id).toBe('s_%');expect(verify.prepare('SELECT series_id FROM api_usage_logs WHERE shot_id=?').get('shared')?.series_id).toBeNull();expect(verify.prepare('SELECT count(*) AS n FROM legacy_usage_ownership').get()?.n).toBe(2);}finally{verify.close();}
  }finally{bible.close();}
 });
 it('F11 conflicting confirmed invoices stay uncertain rather than choosing the last one',async()=>{
  const root=await directory(),path=join(root,'bible.db'),store=new ProviderDispatchStore(join(root,'queue.db')),bible=new SqliteStoryStore(path);
  try{
   bible.createOrUpdateProviderJob({id:'conflict',series_id:'s',episode_number:1,shot_id:'shot',provider:'api_kling',spec_hash:'hash',status:'completed',provider_job_id:'conflict-remote',estimated_cost_usd:1,reserved_cost_usd:0,confirmed_cost_usd:1,uncertain_cost_usd:0,cost_category:'confirmed',attempt_count:1,max_attempts:1,metadata_json:JSON.stringify({cost_source:'rate_card_estimate'})} as any);
   store.register({id:'conflict',seriesId:'s',seriesDbPath:path,provider:'api_kling',remoteId:'conflict-remote',state:'completed'});
   for(const amount of [0.5,0.75,0]){store.receiveWebhook('api_kling',{jobId:'conflict-remote',status:'completed',invoicedCostUsd:amount,isConfirmedInvoice:true});await reconcileProviderAttempts(store,'owner');}
   const job=bible.getProviderJob('conflict')!;expect(job.status).toBe('completed');expect(job.cost_category).toBe('uncertain');expect(JSON.parse(job.metadata_json!).invoice_conflict).toBe(true);expect(job.uncertain_cost_usd).toBeGreaterThanOrEqual(0.75);expect(bible.getSeriesBudgetLedger('s').uncertainCostUsd).toBeGreaterThanOrEqual(0.75);
  }finally{bible.close();store.close();}
 });
 it('F06 a live child owns maintenance until confirmed exit, then recovery unlocks it',async()=>{
  const root=await directory(),store=new ProviderDispatchStore(join(root,'queue.db'));
  try{
   await crashAtBarrier('maintenance',root,()=>{expect(()=>store.seriesCoordinator.enter('series')).toThrow('PROJECT_BUSY');store.seriesCoordinator.recoverAbandoned();expect(store.seriesCoordinator.isUnderMaintenance('series')).toBe(true);});
   expect(store.seriesCoordinator.isUnderMaintenance('series')).toBe(true);
   store.seriesCoordinator.recoverAbandoned();const leave=store.seriesCoordinator.enter('series');leave();
  }finally{store.close();}
 });
 it('F11 a crash after Bible commit but before inbox ack replays the receipt without double charging',async()=>{
  const root=await directory(),path=join(root,'bible.db'),store=new ProviderDispatchStore(join(root,'queue.db'));
  let bible=new SqliteStoryStore(path);
  try{
   bible.upsertSeriesMetadata({id:'s',title:'Crash'});
   bible.createOrUpdateProviderJob({id:'invoice-crash',series_id:'s',episode_number:1,shot_id:'shot',provider:'api_kling',spec_hash:'hash',status:'completed',provider_job_id:'remote-crash',estimated_cost_usd:2,reserved_cost_usd:0,confirmed_cost_usd:2,uncertain_cost_usd:0,cost_category:'confirmed',attempt_count:1,max_attempts:1,metadata_json:JSON.stringify({cost_source:'rate_card_estimate'})} as any);
   bible.close();store.register({id:'invoice-crash',seriesId:'s',seriesDbPath:path,provider:'api_kling',remoteId:'remote-crash',state:'completed'});
   store.receiveWebhook('api_kling',{jobId:'remote-crash',status:'completed',invoicedCostUsd:0.5,isConfirmedInvoice:true});
   await crashAtBarrier('invoice',root);expect(store.pendingInvoices()).toHaveLength(1);
   const expired=new DatabaseSync(path);try{expired.exec('UPDATE provider_attempt_ownership SET lease_until=0');}finally{expired.close();}
   await reconcileProviderAttempts(store,'restart');bible=new SqliteStoryStore(path);
   expect(bible.getProviderJob('invoice-crash')?.confirmed_cost_usd).toBe(0.5);
   expect(bible.listAudit('invoice-crash').filter(row=>row.action==='cost_confirmation')).toHaveLength(1);
   expect(store.pendingInvoices()).toHaveLength(0);
  }finally{bible.close();store.close();}
 });
 it.each(['../x','x\\..\\x','C:x','file://x','CON','NUL','COM1','x.y','x\u0000','x'.repeat(129)])('F01 rejects unsafe asset identity %s',id=>expect(AssetId.safeParse(id).success).toBe(false));
 it.each(['127.0.0.1','::1','::ffff:127.0.0.1','::ffff:7f00:1'])('F02 permits loopback peer %s',remoteAddress=>expect(()=>checkRequestOrigin({headers:{host:'localhost:3456'},socket:{remoteAddress}} as any,'127.0.0.1',3456)).not.toThrow());
 it('F06 migration v2 to v3 is backed up, repeatable and shared by both stores',async()=>{
  const dir=await directory(),path=join(dir,'queue.db'),db=new DatabaseSync(path);db.exec('CREATE TABLE fixture(value TEXT); INSERT INTO fixture VALUES (\'kept\'); PRAGMA user_version=2');db.close();
  const jobs=new JobStore(path),dispatch=new ProviderDispatchStore(path);try{const inspect=new DatabaseSync(path);try{expect(inspect.prepare('PRAGMA user_version').get()?.user_version).toBe(3);expect(inspect.prepare('SELECT value FROM fixture').get()?.value).toBe('kept');}finally{inspect.close();}expect((await readdir(dir)).filter(name=>name.includes('.pre-v3-'))).toHaveLength(1);}finally{dispatch.close();jobs.close();}
 });
 it('F06 independently opened stores block enqueue during maintenance and while a handle is held',async()=>{
  const path=join(await directory(),'queue.db'),one=new ProviderDispatchStore(path),two=new ProviderDispatchStore(path),jobs=new JobStore(path);
  try{const leave=one.seriesCoordinator.enter('series');expect(()=>two.seriesCoordinator.beginMaintenance('series')).toThrow('PROJECT_BUSY');leave();const lock=one.seriesCoordinator.beginMaintenance('series');try{expect(()=>jobs.enqueue({seriesId:'series',rawScreenplay:'text'})).toThrow('PROJECT_BUSY');expect(()=>two.seriesCoordinator.enter('series')).toThrow('PROJECT_BUSY');}finally{lock.release();}expect(jobs.enqueue({seriesId:'series',rawScreenplay:'text'}).status).toBe('queued');}finally{jobs.close();two.close();one.close();}
 });
 it('F06 inspects all queued jobs rather than the latest 200',async()=>{
  const path=join(await directory(),'queue.db'),jobs=new JobStore(path),dispatch=new ProviderDispatchStore(path);try{jobs.enqueue({seriesId:'target',rawScreenplay:'text'});for(let i=0;i<205;i++)jobs.enqueue({seriesId:'s'+i,rawScreenplay:'text'});expect(jobs.list().some(job=>job.request.seriesId==='target')).toBe(false);expect(()=>dispatch.seriesCoordinator.beginMaintenance('target')).toThrow('PROJECT_BUSY');}finally{dispatch.close();jobs.close();}
 });
 it('F07 a durable unknown submit is never replayed after reopening the store',async()=>{
  const root=await directory(),queue=join(root,'queue.db'),generate=vi.fn().mockRejectedValue(new Error('timeout after provider accepted'));
  const make=()=>new DurableTtsClient({generate},'elevenlabs',()=>new SqliteTtsAttemptStore(queue));
  await expect(make().generate('text',join(root,'voice.mp3'))).rejects.toMatchObject({code:'TTS_RECOVERY_REQUIRED'});
  await expect(make().generate('text',join(root,'voice.mp3'))).rejects.toMatchObject({code:'TTS_SUBMIT_UNCERTAIN'});expect(generate).toHaveBeenCalledTimes(1);
 });
 it('F07 accepted remote ID is persisted before polling and resumed without a second submission',async()=>{
  const root=await directory(),queue=join(root,'queue.db');let submits=0,fail=true;
  const generate=vi.fn(async(_text:string,out:string,_srt?:string,options?:import('../../../../contracts/tts.js').TtsGenerateOptions)=>{if(!options?.remoteId){submits++;await options?.onAccepted?.('remote');}if(fail)throw new Error('poll timeout');await createValidMockMp3File(out,1);});
  const make=()=>new DurableTtsClient({generate},'lucylab',()=>new SqliteTtsAttemptStore(queue));
  await expect(make().generate('text',join(root,'voice.mp3'))).rejects.toThrow();fail=false;await make().generate('text',join(root,'voice.mp3'));expect(submits).toBe(1);expect(generate.mock.calls[1][3]?.remoteId).toBe('remote');
 });
 it('F07 failed publication retains a downloaded response and recovers using local bytes',async()=>{
  const root=await directory(),queue=join(root,'queue.db'),out=join(root,'destination');await mkdir(out);
  const generate=vi.fn(async(_text:string,path:string)=>{await createValidMockMp3File(path,1);});
  const make=()=>new DurableTtsClient({generate},'elevenlabs',()=>new SqliteTtsAttemptStore(queue));
  await expect(make().generate('text',out)).rejects.toThrow();await rm(out,{recursive:true});await make().generate('text',out);expect(generate).toHaveBeenCalledTimes(1);expect((await readFile(out)).length).toBeGreaterThan(100);
 });
 it('F03 bounded downloads reject private redirects and preserve an existing destination',async()=>{
  const root=await directory(),out=join(root,'audio.mp3');await writeFile(out,'preserved');
  nock('https://public.example').get('/audio').reply(302,undefined,{location:'https://127.0.0.1/private'});
  await expect(downloadTtsAsset('https://public.example/audio',out)).rejects.toThrow('SSRF');expect(await readFile(out,'utf8')).toBe('preserved');expect((await readdir(root)).filter(value=>value.endsWith('.tmp'))).toHaveLength(0);
 });
 it('F03 actual streamed bytes enforce the subtitle limit and do not publish invalid text',async()=>{
  const out=join(await directory(),'sub.srt');nock('https://public.example').get('/sub').reply(200,Buffer.alloc(2*1024*1024+1));await expect(downloadTtsAsset('https://public.example/sub',out,true)).rejects.toThrow('TTS_DOWNLOAD_LIMIT');
 });
 it('F15 streamed reference hash matches bytes and rejects missing/oversized files',async()=>{
  const root=await directory(),path=join(root,'reference.png'),bytes=Buffer.alloc(4*1024*1024,7);await writeFile(path,bytes);const hasher=new StreamingReferenceHasher();expect(await hasher.hash(path)).toBe(createHash('sha256').update(bytes).digest('hex'));await expect(hasher.hash(join(root,'missing.png'))).rejects.toThrow();const large=join(root,'large');const handle=await import('node:fs/promises').then(fs=>fs.open(large,'w'));try{await handle.truncate(64*1024*1024+1);}finally{await handle.close();}await expect(hasher.hash(large)).rejects.toThrow('REFERENCE_SIZE_INVALID');await expect(hasher.hash(path,AbortSignal.abort())).rejects.toThrow();
 });
 it('F11 an invoice arriving after terminal execution is applied once across recovery restarts',async()=>{
  const root=await directory(),path=join(root,'bible.db'),queue=new ProviderDispatchStore(join(root,'queue.db')),bible=new SqliteStoryStore(path);
  try{bible.upsertSeriesMetadata({id:'s',title:'Invoice'});bible.createOrUpdateProviderJob({id:'invoice',series_id:'s',episode_number:1,shot_id:'shot',provider:'api_kling',spec_hash:'hash',status:'completed',provider_job_id:'remote',estimated_cost_usd:1,reserved_cost_usd:0,confirmed_cost_usd:1,uncertain_cost_usd:0,cost_category:'confirmed',attempt_count:1,max_attempts:1,metadata_json:JSON.stringify({cost_source:'rate_card_estimate'})} as any);
   queue.register({id:'invoice',seriesId:'s',seriesDbPath:path,provider:'api_kling',remoteId:'remote',state:'completed'});queue.receiveWebhook('api_kling',{jobId:'remote',status:'completed',invoicedCostUsd:0,isConfirmedInvoice:true});await reconcileProviderAttempts(queue,'owner');await reconcileProviderAttempts(queue,'owner2');expect(bible.getProviderJob('invoice')?.confirmed_cost_usd).toBe(0);expect(queue.pendingInvoices()).toHaveLength(0);expect(bible.listAudit('invoice').filter(value=>value.action==='cost_confirmation')).toHaveLength(1);
  }finally{bible.close();queue.close();}
 });
 it('F06 restore recovery rolls back a rename interrupted before its journal update',async()=>{
  const root=await directory(),token=randomUUID(),live=join(root,'output/series/s'),staged=live+'.restore-'+token,previous=live+'.before-restore-'+token;await mkdir(live,{recursive:true});await mkdir(staged);await writeFile(join(live,'file'),'old');await writeFile(join(staged,'file'),'new');await mkdir(join(root,'data/maintenance'),{recursive:true});await writeFile(join(root,'data/maintenance/s.restore.json'),JSON.stringify({version:1,seriesId:'s',pid:2147483000,state:'installing',moves:[{live,staged,previous,hadPrevious:true,installed:false}]}));await rename(live,previous);await rename(staged,live);expect(await recoverProjectRestores(root)).toEqual(['s']);expect(await readFile(join(live,'file'),'utf8')).toBe('old');expect(await recoverProjectRestores(root)).toEqual([]);
 });
});

it('F06 unresolved TTS blocks maintenance and maintenance blocks preparation atomically',async()=>{
 const root=await directory(),path=join(root,'queue.db'),dispatch=new ProviderDispatchStore(path),tts=new SqliteTtsAttemptStore(path);
 try{
  const lock=dispatch.seriesCoordinator.beginMaintenance('s');try{expect(()=>tts.begin({id:'blocked',seriesId:'s',provider:'f5tts',state:'prepared'})).toThrow('PROJECT_BUSY');expect(tts.get('blocked')).toBeNull();}finally{lock.release();}
  expect(tts.begin({id:'active',seriesId:'s',provider:'f5tts',state:'prepared'})).toBe(true);
  expect(()=>dispatch.seriesCoordinator.beginMaintenance('s')).toThrow('REMOTE_ATTEMPTS_ACTIVE');
  const other=dispatch.seriesCoordinator.beginMaintenance('other');other.release();
  tts.save({id:'active',seriesId:'s',provider:'f5tts',state:'completed'});const resolved=dispatch.seriesCoordinator.beginMaintenance('s');resolved.release();
 }finally{tts.close();dispatch.close();}
});
