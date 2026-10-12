import { describe,it,expect } from 'vitest';
import { mkdtemp,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHmac } from 'node:crypto';
import { StudioServer } from "../../bootstrap/studio-server.js";
import { ProviderDispatchStore } from "../../modules/production/adapters/sqlite/provider-dispatch-store.js";

describe('signed webhook inbox',()=>{
  it('HTTP callbacks persist before a worker exists and remain terminal after restart',async()=>{
    const root=await mkdtemp(join(tmpdir(),'webhook-inbox-')),queue=join(root,'queue.db');let server=new StudioServer({port:0,queuePath:queue,workersEnabled:false});const secret='offline-test-secret';process.env.WEBHOOK_SECRET_API_KLING=secret;
    try {
      const url=await server.start(),timestamp=String(Math.floor(Date.now()/1000));
      const callback=async(status:string,signed=true)=>{const body=JSON.stringify({jobId:'early-remote',status,videoUrl:'https://fixture.invalid/paid.mp4'}),signature='sha256='+createHmac('sha256',secret).update('api_kling.'+timestamp+'.').update(body).digest('hex');return fetch(url+'/api/v1/gateway/webhook/api_kling',{method:'POST',body,headers:{'Content-Type':'application/json','x-webhook-timestamp':timestamp,'x-webhook-signature':signed?signature:'invalid'}});};
      expect((await callback('completed',false)).status).toBe(401);expect((await callback('completed')).status).toBe(200);expect((await callback('completed')).status).toBe(200);expect((await callback('running')).status).toBe(200);await server.close();
      const worker=new ProviderDispatchStore(queue);try{expect(worker.webhook('api_kling','early-remote')?.status).toBe('completed');expect((worker.metrics().webhooks as {count:number}).count).toBe(1);}finally{worker.close();}
      server=new StudioServer({port:0,queuePath:queue,workersEnabled:false});await server.start();
    }finally{await server.close();delete process.env.WEBHOOK_SECRET_API_KLING;await rm(root,{recursive:true,force:true});}
  });
});
