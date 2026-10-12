import { describe,it,expect } from 'vitest';
import { runMediaCommand } from "./media-process-runner.js";
import {mkdtemp,mkdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

describe('media process lifecycle',()=>{
  it('encodes and probes a real media file beyond the Windows MAX_PATH boundary',async()=>{
    const root=await mkdtemp(join(tmpdir(),'long-media-'));
    try{
      const directory=join(root,...Array.from({length:5},(_,index)=>String(index)+'x'.repeat(60)));
      await mkdir(directory,{recursive:true});const output=join(directory,'clip with spaces.mp4');
      expect(output.length).toBeGreaterThan(260);
      await runMediaCommand('ffmpeg',['-y','-f','lavfi','-i','color=c=black:s=64x64:r=24','-t','0.25','-c:v','libx264','-pix_fmt','yuv420p',output]);
      const probe=JSON.parse(await runMediaCommand('ffprobe',['-v','error','-show_entries','format=duration:stream=codec_type','-of','json',output]));
      expect(probe.streams[0].codec_type).toBe('video');expect(Number(probe.format.duration)).toBeGreaterThan(0);
    }finally{await rm(root,{recursive:true,force:true});}
  });
  it('passes arguments literally without invoking a shell',async()=>{
    const literal='name with spaces & $(echo unsafe) `literal`';
    const result=await runMediaCommand(process.execPath,['-e','console.log(JSON.stringify(process.argv[1]))',literal]);expect(JSON.parse(result)).toBe(literal);
  });
  it('terminates a process that exceeds its deadline',async()=>{
    await expect(runMediaCommand(process.execPath,['-e','setInterval(()=>{},1000)'],{timeoutMs:100})).rejects.toThrow('MEDIA_TIMEOUT');
  });
  it('honors cancellation before starting a process',async()=>{
    const controller=new AbortController();controller.abort();await expect(runMediaCommand(process.execPath,['-e','throw Error("must not run")'],{signal:controller.signal})).rejects.toThrow();
  });
});
