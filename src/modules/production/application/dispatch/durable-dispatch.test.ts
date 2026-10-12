import { afterEach,beforeEach,describe,expect,it } from "vitest";
import { mkdtemp,rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SqliteStoryStore } from "../../../../bootstrap/sqlite-story-store.js";
import { ProviderDispatchStore } from "../../adapters/sqlite/provider-dispatch-store.js";
import { VideoModelGateway } from "./video-gateway.js";
import { type BackendProvider, type VideoProviderAdapter, type ShotExecutionSpec } from "../../../../contracts/video.js";
import { createValidMockMp4File } from "../../../media/adapters/assets/mock-media-generator.js";
import { ResilientJobOrchestrator } from "../../../../bootstrap/shot-orchestrator.js";
import { BudgetLedger } from "./budget-ledger.js";
import { ProviderDispatcher } from "./provider-dispatcher.js";
import { reconcileProviderAttempts,repairProviderDispatches } from "../../../../bootstrap/provider-recovery.js";
import { ProjectPaths } from "../../../../platform/filesystem/project-paths.js";

class OfflinePaidAdapter implements VideoProviderAdapter {
  submits=0;polls=0;cancelled=0;
  constructor(public providerName:BackendProvider,private path:string,private completeAt=0){}
  async submitJob(){this.submits++;return {jobId:this.providerName+"_"+this.submits};}
  async pollStatus(jobId:string){this.polls++;return Date.now()>=this.completeAt?{jobId,status:"completed" as const,localPath:this.path,invoicedCostUsd:0.1,isConfirmedInvoice:true}:{jobId,status:"running" as const};}
  async cancelJob(){this.cancelled++;}
}
describe("durable dispatch and paid hedge offline",()=>{
  let dir:string,bible:SqliteStoryStore,store:ProviderDispatchStore,gateway:VideoModelGateway,fixture:string;
  const spec:ShotExecutionSpec={shotId:"shot",backend:"api_kling",priority:"standard",prompt:"fixture",durationSec:5,aspectRatio:"16:9"};
  beforeEach(async()=>{dir=await mkdtemp(join(tmpdir(),"durable-dispatch-"));bible=new SqliteStoryStore(join(dir,"bible.db"));bible.upsertSeriesMetadata({id:"s",title:"Test",aspect_ratio:"16:9",fps:30,created_at:new Date().toISOString()});bible.setSeriesBudget("s",10,0);store=new ProviderDispatchStore(join(dir,"queue.db"));gateway=new VideoModelGateway();fixture=join(dir,"fixture.mp4");await createValidMockMp4File(fixture,1,64,64);});
  afterEach(async()=>{bible.close();store.close();await rm(dir,{recursive:true,force:true});});
  const orchestrator=()=>new ResilientJobOrchestrator(bible,gateway,{dispatchStore:store,pollIntervalMs:5,pollTimeoutMs:2000,workerId:"test"});
  it("startup repairs a remote-terminal crash gap without a parent retry or live slot",async()=>{
    const root=join(dir,"data","series"),path=join(root,"s","story_bible.db"),target=join(dir,"recovered.mp4");let recoveryBible=new SqliteStoryStore(path);
    const adapter=new OfflinePaidAdapter("api_kling",fixture);gateway.registerAdapter(adapter);
    try {
      recoveryBible.upsertSeriesMetadata({id:"s",title:"Recovery"});recoveryBible.setSeriesBudget("s",1,0);
      const ledger=new BudgetLedger(recoveryBible);ledger.atomicReserveForJob({id:"gap",series_id:"s",episode_number:1,shot_id:"shot",provider:"api_kling",spec_hash:"gap",estimated_cost_usd:0.1});ledger.markSubmitted("gap","remote-known");
      const job=recoveryBible.getProviderJob("gap")!;recoveryBible.createOrUpdateProviderJob({...job,output_local_path:target,metadata_json:JSON.stringify({execution_spec:spec})});
      store.register({id:"gap",seriesId:"s",seriesDbPath:path,provider:"api_kling",state:"submitted",remoteId:"remote-known",spec:{...spec},destinationPath:target});store.trySlot("gap");store.update("gap",{state:"completed",remoteTerminal:true},true);
      recoveryBible.close();recoveryBible=new SqliteStoryStore(path);
      expect(store.active()).toHaveLength(0);repairProviderDispatches(store,root,new ProjectPaths(dir));expect(store.active()).toHaveLength(1);expect(store.metrics().activeJobs).toHaveLength(0);
      await reconcileProviderAttempts(store,"recovery",{gateway});expect(adapter.submits).toBe(0);expect(recoveryBible.getProviderJob("gap")?.status).toBe("completed");expect(recoveryBible.getSeriesBudgetLedger("s").confirmedCostUsd).toBeCloseTo(0.1);expect(store.metrics().activeJobs).toHaveLength(0);
    }finally{recoveryBible.close();}
  });
  it("the emergency hedge switch prevents reservations and submissions",async()=>{
    const previous=process.env.PAID_HEDGE_DISABLED;process.env.PAID_HEDGE_DISABLED="1";
    const primary=new OfflinePaidAdapter("api_kling",fixture),hedge=new OfflinePaidAdapter("api_runway",fixture);gateway.registerAdapter(primary);gateway.registerAdapter(hedge);
    try {
      await expect(orchestrator().executeShot("s",1,{...spec,enableHedge:true,hedgeFallbackProvider:"api_runway"},{destinationPath:join(dir,"winner.mp4"),validateCandidate:async()=>"PASS"})).rejects.toThrow("PAID_HEDGE_DISABLED");
      expect(primary.submits+hedge.submits).toBe(0);expect(bible.listProviderJobs("s")).toHaveLength(0);
    }finally{if(previous===undefined)delete process.env.PAID_HEDGE_DISABLED;else process.env.PAID_HEDGE_DISABLED=previous;}
  });
  it("zero cap and absent reservation cause zero paid submissions",async()=>{
    const adapter=new OfflinePaidAdapter("api_kling",fixture);gateway.registerAdapter(adapter);
    await expect(orchestrator().executeShot("s",1,spec,{budgetCapUsd:0,destinationPath:join(dir,"out.mp4")})).rejects.toThrow();expect(adapter.submits).toBe(0);
    const job={id:"unreserved",series_id:"s",episode_number:1,shot_id:"shot",provider:"api_kling",spec_hash:"hash",status:"failed" as const,estimated_cost_usd:1,reserved_cost_usd:0,confirmed_cost_usd:0,uncertain_cost_usd:0,attempt_count:1,max_attempts:1,is_retryable:false};
    bible.createOrUpdateProviderJob(job);
    await expect(new ProviderDispatcher(bible,gateway,store,{workerId:"test",pollIntervalMs:5,pollTimeoutMs:100,submitTimeoutMs:100}).execute(job,spec)).rejects.toThrow("RESERVATION_REQUIRED");expect(adapter.submits).toBe(0);
  });
  it("fast primary releases the unsubmitted hedge reservation",async()=>{
    const primary=new OfflinePaidAdapter("api_kling",fixture),hedge=new OfflinePaidAdapter("api_runway",fixture);gateway.registerAdapter(primary);gateway.registerAdapter(hedge);
    const result=await orchestrator().executeShot("s",1,{...spec,enableHedge:true,hedgeFallbackProvider:"api_runway",hedgeDelayMs:45_000},{destinationPath:join(dir,"winner.mp4"),validateCandidate:async()=>"PASS"});
    expect(result.status).toBe("completed");expect(primary.submits).toBe(1);expect(hedge.submits).toBe(0);expect(bible.getSeriesBudgetLedger("s").reservedCostUsd).toBe(0);expect(bible.listGroups()[0].winnerId).toBe(result.jobId);
  });
  it("a completed response with QA FAIL cannot beat the hedge",async()=>{
    const primary=new OfflinePaidAdapter("api_kling",fixture),hedge=new OfflinePaidAdapter("api_runway",fixture);gateway.registerAdapter(primary);gateway.registerAdapter(hedge);
    const result=await orchestrator().executeShot("s",1,{...spec,enableHedge:true,hedgeFallbackProvider:"api_runway",hedgeDelayMs:0},{destinationPath:join(dir,"winner.mp4"),validateCandidate:async(_path,candidate)=>candidate.backend==="api_kling"?"FAIL":"PASS"});
    expect(result.jobId).toContain("hedge");expect(bible.getSeriesBudgetLedger("s").confirmedCostUsd).toBeCloseTo(0.2);expect(primary.submits+hedge.submits).toBe(2);
  });
  it("billing zero is confirmed and is retained during manual reconciliation",()=>{
    const ledger=new BudgetLedger(bible);ledger.atomicReserveForJob({id:"zero",series_id:"s",episode_number:1,shot_id:"zero",provider:"api_kling",spec_hash:"zero",estimated_cost_usd:1});ledger.markUncertainTimeout("zero","unknown");
    expect(ledger.reconcileUncertainJob("zero","confirmed_billed_failure",{actualCostUsd:0}).confirmed_cost_usd).toBe(0);expect(bible.getProviderJob("zero")?.cost_category).toBe("confirmed");
  });
  it("an explicit zero-dollar invoice replaces an earlier estimate",()=>{
    const ledger=new BudgetLedger(bible);ledger.atomicReserveForJob({id:"invoice-zero",series_id:"s",episode_number:1,shot_id:"zero",provider:"api_kling",spec_hash:"zero",estimated_cost_usd:1});
    ledger.markConfirmed("invoice-zero",1,{isInvoiced:false});ledger.markConfirmed("invoice-zero",0,{isInvoiced:true});expect(bible.getProviderJob("invoice-zero")?.confirmed_cost_usd).toBe(0);expect(ledger.getLedgerSummary("s").confirmedInvoicedCostUsd).toBe(0);
  });
  it("shared slots survive reopening and duplicate/out-of-order callbacks remain terminal",()=>{
    store.configure("api_kling",{maxConcurrent:1,maxRpm:2});store.register({id:"a",seriesId:"s",seriesDbPath:bible.getDbPath(),provider:"api_kling",state:"reserved"});store.register({id:"b",seriesId:"s",seriesDbPath:bible.getDbPath(),provider:"api_kling",state:"reserved"});expect(store.trySlot("a")).toBe(true);
    const second=new ProviderDispatchStore(store.path);try{expect(second.trySlot("b")).toBe(false);store.receiveWebhook("api_kling",{jobId:"early",status:"completed",videoUrl:"https://fixture.invalid/video"});second.receiveWebhook("api_kling",{jobId:"early",status:"failed"});expect(second.webhook("api_kling","early")?.status).toBe("completed");store.update("a",{state:"completed"},true);expect(second.trySlot("b")).toBe(true);}finally{second.close();}
  });
  it("a definitive submit rejection fails over through separately reserved dispatch",async()=>{
    const primary=new OfflinePaidAdapter("api_kling",fixture),fallback=new OfflinePaidAdapter("api_runway",fixture);
    primary.submitJob=async()=>{primary.submits++;throw Object.assign(new Error("rejected"),{response:{status:400}});};gateway.registerAdapter(primary);gateway.registerAdapter(fallback);
    const result=await orchestrator().executeShot("s",1,{...spec,fallbackProviders:["api_runway"]},{destinationPath:join(dir,"failover.mp4")});
    expect(result.providerJobId).toContain("api_runway");expect(primary.submits).toBe(1);expect(fallback.submits).toBe(1);expect(bible.getSeriesBudgetLedger("s").reservedCostUsd).toBe(0);
  });
  it("unknown POST outcome cannot trigger a failover submission",async()=>{
    const primary=new OfflinePaidAdapter("api_kling",fixture),fallback=new OfflinePaidAdapter("api_runway",fixture);
    primary.submitJob=async()=>{primary.submits++;throw new Error("connection reset after POST");};gateway.registerAdapter(primary);gateway.registerAdapter(fallback);
    await expect(orchestrator().executeShot("s",1,{...spec,fallbackProviders:["api_runway"]})).rejects.toThrow("UNCERTAIN");expect(primary.submits).toBe(1);expect(fallback.submits).toBe(0);expect(bible.getSeriesBudgetLedger("s").uncertainCostUsd).toBeGreaterThan(0);
  });
  it("only enough budget for primary records HEDGE_SKIPPED_BUDGET",async()=>{
    const primary=new OfflinePaidAdapter("api_kling",fixture),hedge=new OfflinePaidAdapter("api_runway",fixture);gateway.registerAdapter(primary);gateway.registerAdapter(hedge);
    const runner=orchestrator(),effective=runner.resolveEffectiveExecutionParams("api_kling",spec),cap=effective.effectiveDurationSec*runner.getRateManager().resolveRate("api_kling",effective.modelName).ratePerSecUsd;
    await runner.executeShot("s",1,{...spec,enableHedge:true,hedgeFallbackProvider:"api_runway"},{budgetCapUsd:cap,destinationPath:join(dir,"winner.mp4"),validateCandidate:async()=>"PASS"});
    expect(primary.submits).toBe(1);expect(hedge.submits).toBe(0);expect(bible.listGroups()[0].reason).toBe("HEDGE_SKIPPED_BUDGET");
  });
  it("restart reuses a winning group without submitting or resetting the hedge deadline",async()=>{
    const primary=new OfflinePaidAdapter("api_kling",fixture),hedge=new OfflinePaidAdapter("api_runway",fixture);gateway.registerAdapter(primary);gateway.registerAdapter(hedge);
    const request={...spec,enableHedge:true,hedgeFallbackProvider:"api_runway" as const,hedgeDelayMs:45_000},options={destinationPath:join(dir,"winner.mp4"),validateCandidate:async()=>"PASS" as const};
    await orchestrator().executeShot("s",1,request,options);const group=bible.listGroups()[0];bible.close();store.close();bible=new SqliteStoryStore(join(dir,"bible.db"));store=new ProviderDispatchStore(join(dir,"queue.db"));
    await orchestrator().executeShot("s",1,request,options);expect(primary.submits).toBe(1);expect(hedge.submits).toBe(0);expect(bible.listGroups()[0].hedgeDueAt).toBe(group.hedgeDueAt);
  });
  it("QA unavailable cannot select a winner or lose either attempt's charge",async()=>{
    const primary=new OfflinePaidAdapter("api_kling",fixture),hedge=new OfflinePaidAdapter("api_runway",fixture);gateway.registerAdapter(primary);gateway.registerAdapter(hedge);
    await expect(orchestrator().executeShot("s",1,{...spec,enableHedge:true,hedgeFallbackProvider:"api_runway",hedgeDelayMs:0},{destinationPath:join(dir,"winner.mp4"),validateCandidate:async()=>"UNAVAILABLE"})).rejects.toThrow("HEDGE_REVIEW_REQUIRED");
    expect(bible.listGroups()[0].winnerId).toBeUndefined();expect(bible.getSeriesBudgetLedger("s").confirmedCostUsd).toBeCloseTo(0.2);
  });
  it("cancelled parent keeps both remote slots and charges until independent reconciliation",async()=>{
    const primary=new OfflinePaidAdapter("api_kling",fixture,Date.now()+10_000),hedge=new OfflinePaidAdapter("api_runway",fixture,Date.now()+10_000);gateway.registerAdapter(primary);gateway.registerAdapter(hedge);const abort=new AbortController();
    const runner=new ResilientJobOrchestrator(bible,gateway,{dispatchStore:store,pollIntervalMs:5,pollTimeoutMs:2000,workerId:"cancel",signal:abort.signal});
    const timer=setTimeout(()=>abort.abort(),150);try{await expect(runner.executeShot("s",1,{...spec,enableHedge:true,hedgeFallbackProvider:"api_runway",hedgeDelayMs:0},{destinationPath:join(dir,"winner.mp4"),validateCandidate:async()=>"PASS"})).rejects.toThrow("HEDGE_REVIEW_REQUIRED");}finally{clearTimeout(timer);}
    expect(primary.submits+hedge.submits).toBe(2);expect(bible.getSeriesBudgetLedger("s").uncertainCostUsd).toBeGreaterThan(0);expect(store.metrics().activeJobs.reduce((sum,row)=>sum+row.count,0)).toBe(2);
    for(const adapter of [primary,hedge])adapter.pollStatus=async jobId=>({jobId,status:"completed",localPath:fixture,invoicedCostUsd:0.1,isConfirmedInvoice:true});
    await reconcileProviderAttempts(store,"independent",{gateway});expect(bible.getSeriesBudgetLedger("s").confirmedCostUsd).toBeCloseTo(0.2);expect(bible.getSeriesBudgetLedger("s").uncertainCostUsd).toBe(0);expect(store.metrics().activeJobs).toHaveLength(0);
  });
});
