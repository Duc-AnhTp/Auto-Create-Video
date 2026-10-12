import { join } from 'node:path';
import { writeFile } from 'node:fs/promises';
import { createRuntime,startRuntime,api,waitFor } from "./smoke-runtime-lib.mjs";
import '../dist/platform/processes/media-runtime.js';
import { createValidMockMp4File } from '../dist/modules/media/adapters/assets/mock-media-generator.js';
const root=await createRuntime('clean-runtime-smoke');let host=await startRuntime(root,false);
const seriesId='runtime-smoke',master=join(root,'data','series',seriesId,'master.mp4');
try {
  await api(host.url,'/health');await api(host.url,'/api/series/init',{id:seriesId,title:'Offline runtime smoke',aspect_ratio:'16:9'});
  await createValidMockMp4File(master,2,128,72);
  const imported=await api(host.url,`/api/v1/series/${seriesId}/artifacts/import`,{episodeNumber:1,path:master,kind:'master',mode:'mock',approved:true,source:'offline FFmpeg fixture'});
  const request={kind:'postprocess',seriesId,episodeNumber:1,inputArtifactId:imported.artifact.id,options:{enableSuperResolution:false,enableCdlGrading:false,enableSpatialFoley:false,enableBroadcastConformance:false}};
  const accepted=await api(host.url,'/api/v1/jobs',request);await api(host.url,`/api/v1/jobs/${accepted.jobId}/pause`,{});
  await host.close();host=await startRuntime(root,true);
  const persisted=await api(host.url,`/api/v1/jobs/${accepted.jobId}`);if(persisted.job.status!=='paused')throw new Error('Paused job lost at restart');
  await api(host.url,`/api/v1/jobs/${accepted.jobId}/resume`,{});
  const job=await waitFor(async()=>{const {job}=await api(host.url,`/api/v1/jobs/${accepted.jobId}`);return ['succeeded','failed','needs_review'].includes(job.status)?job:null;});
  if(job.status!=='succeeded'||job.result.qaStatus!=='MOCK')throw new Error(JSON.stringify(job));
  const media=await fetch(host.url+'/api/media/stream?seriesId='+seriesId+'&path='+encodeURIComponent(job.result.videoPath));if(!media.ok||(await media.arrayBuffer()).byteLength===0)throw new Error('Published artifact unavailable');
  const reused=await api(host.url,'/api/v1/jobs',request);if(reused.jobId!==accepted.jobId)throw new Error('Duplicate postprocess generated another job');
  await writeFile(join(root,'smoke-result.json'),JSON.stringify({node:process.version,health:true,compiledWorker:true,restartResume:true,artifactRead:true,deduplication:true,job},null,2));
  console.log(JSON.stringify({root,jobId:accepted.jobId,status:job.status}));
} finally {await host.close();}
