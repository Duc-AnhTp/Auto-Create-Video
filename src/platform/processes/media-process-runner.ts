import { WorkflowError } from "../workflow-error.js";
import { renameSync } from "node:fs";
import { spawn } from "node:child_process";
import { AsyncLocalStorage } from "node:async_hooks";
import { basename, dirname, extname, join, isAbsolute, toNamespacedPath } from "node:path";
import { rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { countRuntime } from "../observability/runtime-metrics.js";

export interface MediaExecutionContext {
  signal?:AbortSignal; durationSec?:number;
  checkpoint?:()=>Promise<void>;
  acquireEncode?:()=>Promise<(()=>void)&{assertOwned?:()=>void}>;
  assertOwnership?:()=>void;
  publish?:(work:()=>void)=>void;
}
const contexts=new AsyncLocalStorage<MediaExecutionContext>();
export function assertMediaOwnership():void {const context=contexts.getStore();context?.signal?.throwIfAborted();context?.assertOwnership?.();}
export function publishMedia(work:()=>void):void {assertMediaOwnership();const context=contexts.getStore();if(context?.publish)context.publish(work);else work();assertMediaOwnership();}
export function publishMediaRename(source:string,target:string):void {publishMedia(()=>renameSync(source,target));}
export function withMediaContext<T>(context:MediaExecutionContext,fn:()=>Promise<T>):Promise<T>{return contexts.run({...contexts.getStore(),...context},fn);}
export interface MediaCommandOptions {timeoutMs?:number;durationSec?:number;signal?:AbortSignal;captureStderr?:boolean;mediaTask?:boolean;outputLimitBytes?:number;cwd?:string;atomicOutput?:boolean}

export async function runMediaCommand(command:string,args:string[],options:MediaCommandOptions={}):Promise<string> {
  const context=contexts.getStore();const signal=options.signal??context?.signal;
  signal?.throwIfAborted();await context?.checkpoint?.();
  const binary=basename(command).replace(/\.exe$/i,"").toLowerCase();
  const encode=options.mediaTask===true||binary==="ffmpeg"&&!args.includes("-version");
  const release=encode?await context?.acquireEncode?.():undefined;
  const output=args.at(-1),atomic=encode&&options.atomicOutput!==false&&output&&!output.includes("%")&&/\.(mp4|mov|mkv|wav|mp3|aac|flac|jpg|jpeg|png|webp)$/i.test(output);
  const temporary=atomic?join(dirname(output),"."+basename(output,extname(output))+"."+randomUUID()+".tmp"+extname(output)):undefined;
  try {
    signal?.throwIfAborted();assertMediaOwnership();release?.assertOwned?.();
    const index=args.indexOf("-t");const duration=options.durationSec??context?.durationSec??(index>=0?Number(args[index+1]):0);
    const timeout=options.timeoutMs??(binary==="ffprobe"?30_000:Math.min(7_200_000,Math.max(120_000,(Number.isFinite(duration)?duration:0)*10_000)));
    const result=await new Promise<string>((resolve,reject)=>{
      const commandArgs=temporary?[...args.slice(0,-1),temporary]:args;
      const nativeArgs=process.platform==='win32'&&['ffmpeg','ffprobe'].includes(binary)?commandArgs.map(argument=>isAbsolute(argument)?toNamespacedPath(argument):argument):commandArgs;
      const progressArgs=binary==="ffmpeg"&&encode&&!args.includes("-progress")?["-progress","pipe:1","-nostats",...nativeArgs]:nativeArgs;
      const proc=spawn(command,progressArgs,{windowsHide:true,shell:false,cwd:options.cwd,stdio:["ignore","pipe","pipe"],detached:process.platform!=="win32"});
      const streamCopy=args.some((arg,index)=>["-c","-c:v","-codec"].includes(arg)&&args[index+1]==="copy");
      const actualEncode=encode&&Boolean(output&&/\.(mp4|mov|mkv|wav|mp3|aac|flac)$/i.test(output))&&!streamCopy;
      countRuntime(actualEncode?"encode":binary==="ffprobe"?"probe":streamCopy?"streamCopy":"mediaProcess");
      const limit=options.outputLimitBytes??4*1024*1024;let stdout="",stderr="",settled=false,lastProgress=Date.now();const progressValues=new Map<string,string>();
      let failure:Error|undefined;
      const stop=(error:Error)=>{if(failure)return;failure=error;
        if(proc.pid&&process.platform==="win32")spawn("taskkill",["/PID",String(proc.pid),"/T","/F"],{windowsHide:true,shell:false,stdio:"ignore"}).on("error",()=>proc.kill("SIGKILL")).on("exit",code=>{if(code!==0)proc.kill("SIGKILL");});
        else if(proc.pid){try{process.kill(-proc.pid,"SIGKILL");}catch{proc.kill("SIGKILL");}}else proc.kill("SIGKILL");
      };
      const abort=()=>stop(new WorkflowError("MEDIA_CANCELLED", "MEDIA_CANCELLED", "failed"));
      const timer=setTimeout(()=>stop(new Error(`MEDIA_TIMEOUT: ${command} after ${timeout}ms`)),timeout);
      const stall=encode?setInterval(()=>{if(Date.now()-lastProgress>300_000)stop(new WorkflowError("MEDIA_STALLED", "MEDIA_STALLED", "failed"));},10_000):undefined;
      const ownership=setInterval(()=>{try{assertMediaOwnership();release?.assertOwned?.();}catch(error){stop(error instanceof Error?error:new Error(String(error)));}},1000);
      const cleanup=()=>{clearTimeout(timer);clearInterval(ownership);if(stall)clearInterval(stall);signal?.removeEventListener("abort",abort);};
      signal?.addEventListener("abort",abort,{once:true});if(signal?.aborted)abort();
      proc.stdout.on("data",data=>{const value=String(data);stdout=(stdout+value).slice(-limit);
        for(const match of value.matchAll(/(out_time_us|frame)=(\d+)/g)){if(match[2]!==progressValues.get(match[1])){progressValues.set(match[1],match[2]);lastProgress=Date.now();}}
      });
      proc.stderr.on("data",data=>{stderr=(stderr+String(data)).slice(-256*1024);});
      proc.once("error",error=>{if(settled)return;settled=true;cleanup();reject(error);});
      proc.once("close",code=>{if(settled)return;settled=true;cleanup();if(failure||code!==0)reject(failure??new Error(`${command} exited ${code}: ${stderr}`));else resolve(options.captureStderr?stderr:stdout);});
    });
    if(temporary){
      const probe=JSON.parse(await runMediaCommand("ffprobe",["-v","error","-show_entries","stream=codec_type,width,height,channels","-of","json",temporary],{signal,atomicOutput:false}));
      if(!probe.streams?.some((stream:{codec_type:string;width?:number;height?:number;channels?:number})=>stream.codec_type==="video"&&Number(stream.width)>0&&Number(stream.height)>0||stream.codec_type==="audio"&&Number(stream.channels)>0))throw new WorkflowError("MEDIA_OUTPUT_INVALID", "MEDIA_OUTPUT_INVALID", "failed");
      assertMediaOwnership();release?.assertOwned?.();publishMediaRename(temporary,output!);assertMediaOwnership();
    }
    return result;
  } finally {if(temporary)await rm(temporary,{force:true});release?.();}
}
