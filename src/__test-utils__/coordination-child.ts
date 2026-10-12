import {writeFileSync} from "node:fs";
import { readFile,writeFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import axios from "axios";
import { SqliteStoryStore } from "../bootstrap/sqlite-story-store.js";
import { BudgetLedger } from "../modules/production/application/dispatch/budget-ledger.js";
import { ProviderDispatchStore } from "../modules/production/adapters/sqlite/provider-dispatch-store.js";
import { withProviderRequestContext } from "../modules/production/application/dispatch/provider-request-context.js";
import { VideoModelGateway } from "../modules/production/application/dispatch/video-gateway.js";
import { ProviderDispatcher } from "../modules/production/application/dispatch/provider-dispatcher.js";
import { withMediaContext } from "../platform/processes/media-process-runner.js";
const config=JSON.parse(await readFile(process.argv[2],"utf8"));
const store=new ProviderDispatchStore(config.queue),bible=new SqliteStoryStore(config.bible);
try {
  while(config.gate&&!await readFile(config.gate).then(()=>true).catch(()=>false))await delay(10);
  let result:Record<string,unknown>={};
  if(config.action==="rpm") {
    let accepted=0;
    for(let i=0;i<3;i++)try{await withProviderRequestContext(store,"api_kling","poll",()=>axios.get(config.url+"/request"),AbortSignal.timeout(400));accepted++;}catch{break;}
    result={accepted};
  } else if(config.action==="slot"){
    store.register({id:config.id,provider:"api_kling",seriesId:"s",seriesDbPath:config.bible,state:"reserved"});result={allowed:store.trySlot(config.id)};
  }else{
    const spec={shotId:config.id,backend:"api_kling" as const,prompt:"offline fixture",durationSec:1};
    if(config.action==="reserve"){
      const reservation=new BudgetLedger(bible).atomicReserveForJob({id:config.id,series_id:"s",episode_number:1,shot_id:config.id,provider:"api_kling",spec_hash:config.id,estimated_cost_usd:0.1},{budgetCapUsd:0.15});
      if(!reservation.allowed)result={allowed:false};else result={allowed:true};
    }
    if(config.action==="attempt"||config.action.startsWith("crash-")||result.allowed===true){
      const crash=()=>{writeFileSync(config.result,JSON.stringify({crashed:true}));process.exit(71);};
      if(config.action==="crash-after-id"){const persist=store.recordRemoteId.bind(store);store.recordRemoteId=(id,remoteId)=>{persist(id,remoteId);crash();};}
      const gateway=new VideoModelGateway();gateway.registerAdapter({providerName:"api_kling",submitJob:async()=>{if(config.action==="crash-before-post")crash();const remote=(await axios.post(config.url+"/submit",{attempt:config.id})).data.id;if(config.action==="crash-after-post")crash();return {jobId:remote};},pollStatus:async id=>({...(await axios.get(config.url+"/poll/"+id)).data,jobId:id})});
      try{await withMediaContext({publish:work=>{if(config.action==="crash-before-publication")crash();work();if(config.action==="crash-after-publication")crash();}},()=>new ProviderDispatcher(bible,gateway,store,{workerId:config.owner,pollIntervalMs:10,pollTimeoutMs:2000,submitTimeoutMs:1000}).execute(bible.getProviderJob(config.id)!,spec,config.destination));result={...result,completed:true};}catch(error){result={...result,error:String(error)};}
    }
  }
  await writeFile(config.result,JSON.stringify(result));
}finally{bible.close();store.close();}
