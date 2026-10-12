import {describe,it,expect,afterEach} from 'vitest';
import nock from 'nock';
import {KlingAdapter} from './kling-adapter.js';
import {RunwayAdapter} from './runway-adapter.js';
import {SeedanceAdapter} from './seedance-adapter.js';
import {VeoAdapter} from './veo-adapter.js';
import {ServerlessComfyUIAdapter} from './serverless-comfyui-adapter.js';
import {ComfyUiAdapter} from './comfyui-adapter.js';
import {MockVideoAdapter} from './mock-adapter.js';
import type {VideoProviderAdapter} from '../../../../contracts/video.js';
import {validateSpecAgainstCapabilities} from '../../domain/provider-capabilities.js';
const host='https://provider-contract.invalid',key='fixture-key',jobId='contract-job',url=host+'/clip.mp4';
const cloud=[
 {name:'kling',create:()=>new KlingAdapter({baseUrl:host,apiKey:key}),path:'/v1/videos/tasks/'+jobId,complete:{data:{task_status:'succeed',task_result:{videos:[{url}]}}},failed:{data:{task_status:'failed',task_status_msg:'fixture'}}},
 {name:'runway',create:()=>new RunwayAdapter({baseUrl:host,apiKey:key}),path:'/v1/tasks/'+jobId,complete:{status:'SUCCEEDED',output:[url]},failed:{status:'FAILED',failure:'fixture'}},
 {name:'seedance',create:()=>new SeedanceAdapter({baseUrl:host,apiKey:key}),path:'/contents/generations/tasks/'+jobId,complete:{status:'SUCCEEDED',content:{video_url:url}},failed:{status:'FAILED',error:{message:'fixture'}}},
 {name:'veo',create:()=>new VeoAdapter({baseUrl:host,apiKey:key}),path:'/'+jobId,complete:{done:true,response:{generatedSamples:[{video:{uri:url}}]}},failed:{error:{message:'fixture'}}},
 {name:'serverless',create:()=>new ServerlessComfyUIAdapter({endpoint:host,apiKey:key}),path:'/status/'+jobId,complete:{status:'COMPLETED',output:{video_url:url}},failed:{status:'FAILED',error:'fixture'}}
];
afterEach(()=>nock.cleanAll());
describe.each(cloud)('$name shared remote status contract',provider=>{
 it('returns normalized completed and failed status for the same remote ID without submitting',async()=>{const adapter=provider.create(),complete=nock(host).get(provider.path).reply(200,provider.complete),failed=nock(host).get(provider.path).reply(200,provider.failed);expect(await adapter.pollStatus(jobId)).toMatchObject({jobId,status:'completed',videoUrl:url});expect(await adapter.pollStatus(jobId)).toMatchObject({jobId,status:'failed',error:expect.any(String)});expect(complete.isDone()&&failed.isDone()).toBe(true);});
});
const adapters:Array<[string,()=>VideoProviderAdapter]>=[...cloud.map(item=>[item.name,item.create] as [string,()=>VideoProviderAdapter]),['comfyui',()=>new ComfyUiAdapter({baseUrl:host})],['mock',()=>new MockVideoAdapter()]];
describe.each(adapters)('%s shared capability and lifecycle declaration',(name,create)=>{
 it('exposes only supported lifecycle operations and rejects unsupported duration',()=>{const adapter=create(),caps=adapter.capabilities!;expect(caps.providerName).toBe(adapter.providerName);expect(typeof adapter.submitJob).toBe('function');expect(typeof adapter.pollStatus).toBe('function');expect(Boolean(adapter.cancelJob)).toBe(caps.supportsCancellation);expect(Boolean(adapter.restoreJob)).toBe(caps.requiresLocalRestore);expect(()=>validateSpecAgainstCapabilities({shotId:'invalid',prompt:'fixture',durationSec:-1},caps)).toThrow();});
});
