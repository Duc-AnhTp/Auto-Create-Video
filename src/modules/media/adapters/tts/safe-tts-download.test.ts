import {afterEach,expect,it,vi} from 'vitest';
import {mkdtemp,writeFile,readFile,readdir,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import nock from 'nock';
import * as validator from '../media-validator.js';
import {downloadTtsAsset, promoteStagingFile} from './safe-tts-download.js';

afterEach(()=>{vi.restoreAllMocks();nock.cleanAll();});

it('promoteStagingFile handles retry and atomic promotion', async () => {
  const root = await mkdtemp(join(tmpdir(), 'promote-test-'));
  const src = join(root, 'temp.tmp');
  const dst = join(root, 'target.mp3');
  try {
    await writeFile(src, 'audio-data');
    await promoteStagingFile(src, dst);
    expect(await readFile(dst, 'utf8')).toBe('audio-data');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it.each(['caller','deadline'] as const)('F03 %s cancellation during probe preserves destination and removes staging',async mode=>{
 const root=await mkdtemp(join(tmpdir(),'tts-probe-abort-')),destination=join(root,'audio.mp3'),controller=new AbortController();
 if(mode==='deadline')vi.spyOn(AbortSignal,'timeout').mockReturnValue(controller.signal);
 let begin!:()=>void;const started=new Promise<void>(resolve=>{begin=resolve;});
 vi.spyOn(validator,'probeAudioFile').mockImplementation(async(_path,signal)=>{
  begin();expect(signal).toBeDefined();
  return new Promise(resolve=>signal!.addEventListener('abort',()=>resolve({isValid:false,durationSec:0,formatName:'',sizeBytes:0,error:'Cancelled'}),{once:true}));
 });
 try{
  await writeFile(destination,'preserved');
  nock('https://public.example').get('/audio').reply(200,Buffer.from('downloaded response'));
  const download=downloadTtsAsset('https://public.example/audio',destination,false,mode==='caller'?controller.signal:undefined);
  const rejected=expect(download).rejects.toMatchObject({name:mode==='caller'?'AbortError':'TimeoutError'});
  await Promise.race([started,download.then(()=>{throw new Error('Probe barrier was not reached');},error=>{throw error;})]);
  if(mode==='caller')controller.abort();else controller.abort(new DOMException('Deadline reached','TimeoutError'));
  await rejected;expect(await readFile(destination,'utf8')).toBe('preserved');expect(await readdir(root)).toEqual(['audio.mp3']);
 }finally{controller.abort();await rm(root,{recursive:true,force:true});}
});
