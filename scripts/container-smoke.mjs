import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { waitFor } from "./smoke-runtime-lib.mjs";
// Studio is local-only, including inside a container. Exercise its loopback
// API with docker exec rather than weakening that boundary for port publishing.
const api=async(_url,path,body)=>JSON.parse(docker(['exec',name,'node','--input-type=module','-e',
 'const response=await fetch('+JSON.stringify('http://127.0.0.1:3456'+path)+', '+JSON.stringify(body===undefined?{headers:{Host:'localhost:3456'}}:{method:'POST',headers:{Host:'localhost:3456','Content-Type':'application/json'},body:JSON.stringify(body)})+');const result=await response.json();if(!response.ok)throw new Error(JSON.stringify(result));console.log(JSON.stringify(result));']));
const image=process.argv[2]||'auto-create-video-smoke',name='codex-smoke-'+randomUUID();
function docker(args){const result=spawnSync('docker',args,{windowsHide:true,encoding:'utf8',shell:false});if(result.error||result.status!==0)throw new Error(result.error?.message||result.stderr);return result.stdout.trim();}
docker(['info','--format','{{.ServerVersion}}']);
try {
  docker(['run','-d','--name',name,'-e','OFFLINE_WORKER=1','-e','OFFLINE_RUNTIME=1','--network','none',image]);
  const url='http://127.0.0.1:3456';
  await waitFor(async()=>{try{return await api(url,'/health');}catch{return null;}},60000);
  await api(url,'/api/series/init',{id:'container-smoke',title:'Offline container smoke'});
  const master='/app/data/series/container-smoke/master.mp4';
  docker(['exec',name,'node','--input-type=module','-e',`import './dist/platform/processes/media-runtime.js';import {createValidMockMp4File} from './dist/modules/media/adapters/assets/mock-media-generator.js';await createValidMockMp4File('${master}',2,128,72);`]);
  const imported=await api(url,'/api/v1/series/container-smoke/artifacts/import',{episodeNumber:1,path:master,kind:'master',mode:'mock',approved:true,source:'offline container fixture'});
  const {jobId}=await api(url,'/api/v1/jobs',{kind:'postprocess',seriesId:'container-smoke',episodeNumber:1,inputArtifactId:imported.artifact.id,options:{enableSuperResolution:false,enableCdlGrading:false,enableSpatialFoley:false,enableBroadcastConformance:false}});
  await api(url,`/api/v1/jobs/${jobId}/pause`,{});docker(['restart',name]);
  await waitFor(async()=>{try{return await api(url,'/health');}catch{return null;}},60000);
  const state=await api(url,`/api/v1/jobs/${jobId}`);if(state.job.status==='paused')await api(url,`/api/v1/jobs/${jobId}/resume`,{});
  const job=await waitFor(async()=>{const {job}=await api(url,`/api/v1/jobs/${jobId}`);return ['succeeded','failed','needs_review'].includes(job.status)?job:null;});
  if(job.status!=='succeeded')throw new Error(JSON.stringify(job));
  docker(['exec',name,'node','--input-type=module','-e','const response=await fetch('+JSON.stringify(url+'/api/media/stream?seriesId=container-smoke&path='+encodeURIComponent(job.result.videoPath))+', {headers:{Host:"localhost:3456"}});if(!response.ok||!(await response.arrayBuffer()).byteLength)throw new Error("CONTAINER_ARTIFACT_UNAVAILABLE");']);
  console.log(JSON.stringify({image,health:true,compiledWorker:true,restartResume:true,artifactRead:true}));
} catch(error){try{console.error(docker(['logs','--tail','80',name]));}catch{}throw error;}
finally {try{docker(['rm','-f',name]);}catch{}}
