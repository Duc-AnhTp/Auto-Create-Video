import {spawn,type ChildProcess} from "node:child_process";
import {existsSync} from "node:fs";
import {resolve} from "node:path";
import {fileURLToPath} from "node:url";
export class WorkerSupervisor {
 private children=new Set<ChildProcess>();private timer?:ReturnType<typeof setInterval>;private closing=false;
 constructor(private dbPath:string,private enabled:boolean){}
 start():void {
  if(!this.enabled||this.closing)return;
  if(!this.timer){this.timer=setInterval(()=>{try{this.start();}catch{}},3000);this.timer.unref();}
  const count=Math.max(1,Math.min(8,Number(process.env.STUDIO_WORKERS)||2));
  const compiled=fileURLToPath(new URL("./main.js",import.meta.url)),source=fileURLToPath(new URL("./main.ts",import.meta.url));
  const args=existsSync(compiled)?[compiled]:[resolve("node_modules/tsx/dist/cli.mjs"),source];
  while(this.children.size<count){const child=spawn(process.execPath,[...args,this.dbPath,String(process.pid)],{windowsHide:true,stdio:"ignore",env:{...process.env,STUDIO_JOB_DB:this.dbPath}});this.children.add(child);child.on("error",()=>this.children.delete(child));child.on("exit",()=>this.children.delete(child));}
 }
 async close():Promise<void>{
  this.closing=true;if(this.timer)clearInterval(this.timer);
  const killTree=(child:ChildProcess,signal:"SIGTERM"|"SIGKILL")=>{
   if(process.platform==="win32"&&child.pid){
    try{spawn("taskkill",["/pid",String(child.pid),"/T","/F"],{windowsHide:true,stdio:"ignore"});return;}catch{}
   }
   child.kill(signal);
  };
  await Promise.all([...this.children].map(child=>new Promise<void>(done=>{const timer=setTimeout(()=>{killTree(child,"SIGKILL");done();},5000);child.once("exit",()=>{clearTimeout(timer);done();});killTree(child,"SIGTERM");})));
 }
}
