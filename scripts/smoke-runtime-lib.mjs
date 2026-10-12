import { mkdir,cp,writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { resolve,join } from 'node:path';
import { randomUUID } from 'node:crypto';
export async function createRuntime(label) {
  const root=resolve('output',label+'-'+randomUUID());await mkdir(root,{recursive:true});
  await cp(resolve('dist'),join(root,'dist'),{recursive:true});
  await cp(resolve('scripts/smoke-host-template.mjs'),join(root,'host.mjs'));
  await writeFile(join(root,'package.json'),' {"type":"module"}');
  return root;
}
export async function startRuntime(root,workers=false) {
  const env={...process.env,OFFLINE_RUNTIME:'1',OFFLINE_WORKER:'1',SMOKE_WORKERS:workers?'1':'0',STUDIO_WORKERS:'2'};
  for(const key of Object.keys(env))if(/(API_KEY|ACCESS_TOKEN|SECRET|ENDPOINT|BASE_URL)$/.test(key))delete env[key];
  const child=spawn(process.execPath,[join(root,'host.mjs')],{cwd:root,env,windowsHide:true,stdio:['ignore','pipe','pipe','ipc']});let output='';
  child.stdout.on('data',chunk=>{output=(output+chunk).slice(-16000);});child.stderr.on('data',chunk=>{output=(output+chunk).slice(-16000);});
  const url=await new Promise((done,reject)=>{const timer=setTimeout(()=>{child.kill();reject(new Error('Runtime startup timeout: '+output));},30_000);child.once('message',message=>{clearTimeout(timer);done(message.url);});child.once('exit',code=>{clearTimeout(timer);reject(new Error(`Runtime exited ${code}: ${output}`));});});
  return {child,url,output:()=>output,close:()=>new Promise(done=>{if(child.exitCode!==null)return done();const timer=setTimeout(()=>{child.kill();done();},10_000);child.once('exit',()=>{clearTimeout(timer);done();});child.send('close');})};
}
export async function api(url,path,body,headers={}) {
  const response=await fetch(url+path,body===undefined?{headers}:{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify(body)});
  const text=await response.text();if(!response.ok)throw new Error(`${response.status} ${path}: ${text}`);return text?JSON.parse(text):null;
}
export async function waitFor(test,timeoutMs=90000){const end=Date.now()+timeoutMs;while(Date.now()<end){const result=await test();if(result)return result;await new Promise(done=>setTimeout(done,250));}throw new Error('SMOKE_TIMEOUT');}
