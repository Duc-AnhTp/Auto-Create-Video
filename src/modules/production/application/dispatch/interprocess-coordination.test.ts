import { afterEach,beforeEach,describe,expect,it } from "vitest";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join,resolve } from "node:path";
import { spawn } from "node:child_process";
import {DatabaseSync} from "node:sqlite";
import { reconcileManually } from "./manual-reconciliation.js";
import { createServer,type Server } from "node:http";
import { SqliteStoryStore } from "../../../../bootstrap/sqlite-story-store.js";
import { ProviderDispatchStore } from "../../adapters/sqlite/provider-dispatch-store.js";
import { BudgetLedger } from "./budget-ledger.js";
import { createValidMockMp4File } from "../../../media/adapters/assets/mock-media-generator.js";

describe("SQLite coordination across independent processes",()=>{
  let root:string,bible:SqliteStoryStore,store:ProviderDispatchStore,server:Server,url:string,submits:number,requests:number,fixture:string;
  beforeEach(async()=>{root=await mkdtemp(join(tmpdir(),"process-coordination-"));bible=new SqliteStoryStore(join(root,"bible.db"));bible.upsertSeriesMetadata({id:"s",title:"Offline"});bible.setSeriesBudget("s",0.15,0);store=new ProviderDispatchStore(join(root,"queue.db"));store.configure("api_kling",{maxConcurrent:1,maxRpm:100});fixture=join(root,"fixture.mp4");await createValidMockMp4File(fixture,1,64,64);submits=0;requests=0;
    server=createServer((req,res)=>{if(req.url==="/submit"){submits++;req.resume();setTimeout(()=>{res.setHeader("Content-Type","application/json");res.end(JSON.stringify({id:"remote-"+submits}));},150);}else if(req.url?.startsWith("/poll/")){res.setHeader("Content-Type","application/json");res.end(JSON.stringify({status:"completed",localPath:fixture,invoicedCostUsd:0.1,isConfirmedInvoice:true}));}else{requests++;res.end("ok");}});
    await new Promise<void>(resolve=>server.listen(0,"127.0.0.1",resolve));url="http://127.0.0.1:"+(server.address() as {port:number}).port;
  });
  afterEach(async()=>{await new Promise<void>(resolve=>server.close(()=>resolve()));bible.close();store.close();await rm(root,{recursive:true,force:true});});
  async function workers(action:string,ids:string[]){const gate=join(root,"gate-"+action);const children=await Promise.all(ids.map(async(id,index)=>{
    const config={action,id,owner:"worker-"+index,queue:store.path,bible:bible.getDbPath(),url,gate,destination:join(root,id+".mp4"),result:join(root,action+index+".json")},path=join(root,action+index+"-config.json");await writeFile(path,JSON.stringify(config));
    const child=spawn(process.execPath,["--import","tsx",resolve("src/__test-utils__/coordination-child.ts"),path],{shell:false,windowsHide:true,stdio:["ignore","ignore","pipe"],env:{...process.env,OFFLINE_RUNTIME:"1"}});let error="";child.stderr.on("data",chunk=>error+=String(chunk));return {config,finished:new Promise<void>((resolve,reject)=>{child.once("error",reject);child.once("exit",code=>code===0||code===71&&action.startsWith("crash-")?resolve():reject(new Error(error)));})};}));
    await writeFile(gate,"start");await Promise.all(children.map(child=>child.finished));const results = await Promise.all(children.map(child=>readFile(child.config.result,"utf8").then(JSON.parse)));
    if(results.some(value=>value.error))console.error("Coordination child results",results);return results;
  }
  it("two processes sharing a $0.15 cap submit only one $0.10 attempt",async()=>{const results=await workers("reserve",["a","b"]);expect(results.filter(result=>result.completed)).toHaveLength(1);expect(submits).toBe(1);expect(bible.getSeriesBudgetLedger("s").totalCommittedUsd).toBeCloseTo(0.1);});
  it("two processes cannot POST the same reserved attempt twice",async()=>{new BudgetLedger(bible).atomicReserveForJob({id:"same",series_id:"s",episode_number:1,shot_id:"same",provider:"api_kling",spec_hash:"same",estimated_cost_usd:0.1});const results=await workers("attempt",["same","same"]);expect(submits).toBe(1);expect(results.filter(result=>result.completed)).toHaveLength(1);expect(bible.getProviderJob("same")?.provider_job_id).toBe("remote-1");});
  it("a provider slot survives the owning process exiting",async()=>{const results=await workers("slot",["a","b"]);expect(results.filter(result=>result.allowed)).toHaveLength(1);expect((store.metrics().activeJobs as unknown[])).toHaveLength(1);});
  it("poll HTTP requests from two processes consume one shared RPM window",async()=>{store.configure("api_kling",{maxConcurrent:1,maxRpm:2});const results=await workers("rpm",["a","b"]);expect(results.reduce((sum,result)=>sum+result.accepted,0)).toBe(2);expect(requests).toBe(2);});
  it.each(["crash-before-post","crash-after-post","crash-after-id"])("%s restart never blindly repeats POST",async action=>{
    new BudgetLedger(bible).atomicReserveForJob({id:"crash",series_id:"s",episode_number:1,shot_id:"crash",provider:"api_kling",spec_hash:"crash",estimated_cost_usd:0.1});
    await workers(action,["crash"]);const originalSubmits=submits;
    const db=new DatabaseSync(bible.getDbPath());db.exec("UPDATE provider_attempt_ownership SET lease_until=0");db.close();
    const results=await workers("attempt",["crash"]);expect(submits).toBe(originalSubmits);
    if(action==="crash-after-id"){expect(results[0].completed).toBe(true);expect(bible.getProviderJob("crash")?.status).toBe("completed");}
    else {expect(bible.getProviderJob("crash")?.status).toBe("uncertain_timeout");expect((store.metrics().activeJobs as unknown[]).length).toBe(1);
      if(action==="crash-after-post"){reconcileManually(bible,store,"s",{attemptId:"crash",action:"attach_remote_id",remoteId:"remote-1",evidence:"Local provider confirms request received"});expect((await workers("attempt",["crash"]))[0].completed).toBe(true);expect(submits).toBe(1);}
    }
  });
  it.each(["crash-before-publication","crash-after-publication"])("%s resumes the same remote ID without a second charge",async action=>{
    new BudgetLedger(bible).atomicReserveForJob({id:"publish",series_id:"s",episode_number:1,shot_id:"publish",provider:"api_kling",spec_hash:"publish",estimated_cost_usd:0.1});
    await workers(action,["publish"]);expect(submits).toBe(1);expect(bible.getProviderJob("publish")?.provider_job_id).toBe("remote-1");
    const db=new DatabaseSync(bible.getDbPath());db.exec("UPDATE provider_attempt_ownership SET lease_until=0");db.close();
    expect((await workers("attempt",["publish"]))[0].completed).toBe(true);expect(submits).toBe(1);expect(bible.getSeriesBudgetLedger("s").confirmedCostUsd).toBeCloseTo(0.1);
  });
});
