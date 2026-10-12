import { WorkflowError } from "../../../../platform/workflow-error.js";
import { withDeadline } from "../../../../platform/processes/async-deadline.js";
import { randomUUID } from "node:crypto";
import { dirname, basename, extname, join } from "node:path";
import { mkdir, copyFile, rm } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import type { DurableHedgeStore } from "../../ports/durable-hedge-store.js";
import type { ProviderJobRecord } from "../../../../contracts/story.js";

import { BudgetLedger } from "./budget-ledger.js";
import { ProviderDispatcher, type DispatcherOptions, type DispatchResult } from "./provider-dispatcher.js";
import type {DispatchCoordination} from '../../ports/runtime-services.js';
import { withProviderRequestContext } from "./provider-request-context.js";
import { BudgetExceededError, type VideoModelGateway } from "./video-gateway.js";
import { type BackendProvider, type ShotExecutionSpec } from "../../../../contracts/video.js";
import { hashFile } from "../../../media/index.js";
import { probeVideoFile } from "../../../media/index.js";
import { assertMediaOwnership,publishMediaRename } from "../../../../platform/processes/media-process-runner.js";
import { validateSpecAgainstCapabilities, PROVIDER_CAPABILITY_REGISTRY } from "../../domain/provider-capabilities.js";

export type CandidateQa = (path:string,spec:ShotExecutionSpec)=>Promise<"PASS"|"FAIL"|"UNAVAILABLE">;
export interface HedgeDependencies {
  bible:DurableHedgeStore; gateway:VideoModelGateway; store:DispatchCoordination; options:DispatcherOptions;
  estimate:(provider:BackendProvider,spec:ShotExecutionSpec)=>{cost:number;model:string;duration:number};
}

/** Every paid attempt owns its reservation, lease, remote ID and immutable output. */
export async function executeDurableHedge(deps:HedgeDependencies,seriesId:string,episode:number,spec:ShotExecutionSpec,hash:string,options:{destinationPath?:string;budgetCapUsd?:number;forceReRender?:boolean;maxReRolls?:number;validateCandidate?:CandidateQa}):Promise<DispatchResult> {
  const {bible,gateway,store}=deps,repository=bible,ledger=new BudgetLedger(bible);
  if(process.env.PAID_HEDGE_DISABLED==="1")throw new WorkflowError("PAID_HEDGE_DISABLED", "PAID_HEDGE_DISABLED", "failed");
  const primary=spec.backend??"mock",fallback=spec.hedgeFallbackProvider;
  if(primary==="mock"||!fallback||fallback==="mock"||primary===fallback||!gateway.getAdapter(primary)||!gateway.getAdapter(fallback))throw new WorkflowError("HEDGE_PROVIDER_INVALID", "HEDGE_PROVIDER_INVALID", "failed");
  if(!options.destinationPath||!options.validateCandidate)throw new WorkflowError("HEDGE_QA_REQUIRED", "HEDGE_QA_REQUIRED", "needs_review");
  for(const provider of [primary,fallback]){const caps=gateway.getAdapter(provider)?.capabilities??PROVIDER_CAPABILITY_REGISTRY[provider];if(caps)validateSpecAgainstCapabilities({...spec,backend:provider,durationSec:deps.estimate(provider,spec).duration},caps);}
  const groupHash=hash+":"+fallback+":"+(spec.hedgeDelayMs??45_000);
  if(options.forceReRender&&repository.listGroups().filter(group=>group.seriesId===seriesId&&group.episodeNumber===episode&&group.shotId===spec.shotId&&group.specHash===groupHash).length>=(options.maxReRolls??2)+1)throw new WorkflowError("MAX_REROLLS_REACHED", "MAX_REROLLS_REACHED", "failed");
  let group=options.forceReRender?null:repository.findGroup(seriesId,episode,spec.shotId,groupHash);
  if(!group){
    const id=randomUUID(),now=new Date().toISOString();
    group={id,seriesId,episodeNumber:episode,shotId:spec.shotId,specHash:groupHash,primaryId:id+"_primary",hedgeId:id+"_hedge",hedgeDueAt:Date.now()+(spec.hedgeDelayMs??45_000),status:"reserved",spec:{...spec},destinationPath:options.destinationPath,createdAt:now};
    const record=(provider:BackendProvider,attemptId:string,role:string):ProviderJobRecord=>{const price=deps.estimate(provider,spec);return {id:attemptId,series_id:seriesId,episode_number:episode,shot_id:spec.shotId,provider,model_name:price.model,spec_hash:groupHash+":"+provider,status:"reserved",cost_category:"reserved",estimated_cost_usd:price.cost,reserved_cost_usd:price.cost,confirmed_cost_usd:0,uncertain_cost_usd:0,attempt_count:1,max_attempts:1,is_retryable:false,worker_id:deps.options.workerId,created_at:now,updated_at:now,metadata_json:JSON.stringify({attempt_group_id:id,attempt_role:role,parent_job_id:deps.options.parentJobId,execution_spec:{...spec,backend:provider,enableHedge:false}})};};
    const jobs=[record(primary,group.primaryId,"primary"),record(fallback,group.hedgeId!,"hedge")];
    if(!bible.atomicReserveProviderGroup(group,jobs,options.budgetCapUsd,options.forceReRender,options.maxReRolls)){
      group.hedgeId=undefined;group.reason="HEDGE_SKIPPED_BUDGET";
      if(!bible.atomicReserveProviderGroup(group,[jobs[0]],options.budgetCapUsd,options.forceReRender,options.maxReRolls))throw new BudgetExceededError(ledger.getLedgerSummary(seriesId).totalCommittedUsd,options.budgetCapUsd??bible.getSeriesBudget(seriesId).max_budget_usd,jobs[0].estimated_cost_usd);
    }
  }
  if(!group.winnerId){group.status="running";repository.putGroup(group);}
  const currentGroup=group;
  const destination=options.destinationPath;
  const attemptPath=(id:string)=>join(dirname(destination),basename(destination,extname(destination))+"."+id+extname(destination));
  for(const id of [group.primaryId,group.hedgeId].filter((value):value is string=>Boolean(value))){
    const job=bible.getProviderJob(id)!;
    store.register({id,seriesId,seriesDbPath:bible.getDbPath(),provider:job.provider,state:job.status==="reserved"?"reserved":"submitted",remoteId:job.provider_job_id,groupId:group.id,parentJobId:deps.options.parentJobId,spec:{...spec,backend:job.provider,enableHedge:false},destinationPath:attemptPath(id)});
  }
  const controllers=new Map<string,AbortController>();
  let earlyFallback:()=>void=()=>undefined;
  const early=new Promise<void>(resolve=>{earlyFallback=resolve;});
  const run=async(id:string,isHedge:boolean):Promise<DispatchResult>=>{
    const controller=new AbortController();controllers.set(id,controller);
    const abort=()=>controller.abort(deps.options.signal?.reason);deps.options.signal?.addEventListener("abort",abort,{once:true});if(deps.options.signal?.aborted)abort();
    try{
      if(isHedge){await Promise.race([delay(Math.max(0,currentGroup.hedgeDueAt-Date.now()),undefined,{signal:controller.signal}),early]);controller.signal.throwIfAborted();}
      if(repository.getGroup(currentGroup.id)?.winnerId&&repository.getGroup(currentGroup.id)?.winnerId!==id)throw new WorkflowError("HEDGE_SUPERSEDED", "HEDGE_SUPERSEDED", "failed");
      let job=bible.getProviderJob(id)!;
      const provider=job.provider as BackendProvider,price=deps.estimate(provider,spec);
      const candidateSpec={...spec,backend:provider,enableHedge:false,durationSec:price.duration,destinationLocalPath:attemptPath(id)};
      let result:DispatchResult;
      if(job.status==="completed")result={jobId:id,providerJobId:job.provider_job_id,status:"completed",videoPath:job.output_local_path,videoUrl:job.output_url,costUsd:job.confirmed_cost_usd,isInvoiced:JSON.parse(job.metadata_json??"{}").is_invoiced===true,specHash:job.spec_hash,isCacheHit:false,attemptsUsed:1};
      else if(["failed","cancelled"].includes(job.status))throw new WorkflowError("ATTEMPT_TERMINAL", "ATTEMPT_TERMINAL", "failed");
      else result=await new ProviderDispatcher(bible,gateway,store,{...deps.options,signal:controller.signal}).execute(job,candidateSpec,attemptPath(id));
      controller.signal.throwIfAborted();
      const path=result.videoPath;
      const qa=path&&(await probeVideoFile(path)).isValid?await options.validateCandidate!(path,candidateSpec):"FAIL";
      await deps.options.checkpoint?.();assertMediaOwnership();
      const lease=repository.claim(id,deps.options.workerId+"_qa");if(!lease)throw new WorkflowError("WORKER_LOCK_CONFLICT", "WORKER_LOCK_CONFLICT", "failed");
      try{repository.withLease(lease,()=>{job=bible.getProviderJob(id)!;job.metadata_json=JSON.stringify({...JSON.parse(job.metadata_json??"{}"),candidate_qa:qa});bible.createOrUpdateProviderJob(job);});}finally{repository.release(lease);}
      if(qa!=="PASS")throw new Error(qa==="UNAVAILABLE"?"HEDGE_QA_UNAVAILABLE":"HEDGE_QA_FAILED");
      if(!repository.chooseWinner(currentGroup.id,id))throw new WorkflowError("HEDGE_SUPERSEDED", "HEDGE_SUPERSEDED", "failed");
      return result;
    }catch(error){if(!isHedge&&bible.getProviderJob(id)?.status==="failed")earlyFallback();throw error;}
    finally{deps.options.signal?.removeEventListener("abort",abort);}
  };
  const attempts=[run(currentGroup.primaryId,false),...(currentGroup.hedgeId?[run(currentGroup.hedgeId,true)]:[])];
  let winner:DispatchResult|undefined;
  try{winner=await Promise.any(attempts);}
  catch(error){const latest=repository.getGroup(currentGroup.id)!;if(!latest.winnerId){latest.status="needs_review";latest.reason=String(error);repository.putGroup(latest);}throw new WorkflowError("HEDGE_REVIEW_REQUIRED", "HEDGE_REVIEW_REQUIRED: no candidate passed verified QA", "needs_review");}
  finally{
    for(const [id,controller] of controllers){if(id===winner?.jobId)continue;controller.abort();}
    await Promise.allSettled(attempts);
    if(winner)for(const id of [currentGroup.primaryId,currentGroup.hedgeId].filter((value):value is string=>Boolean(value)&&value!==winner?.jobId)){
      const loser=bible.getProviderJob(id)!;
      if(loser.status==="reserved"){const lease=repository.claim(id,deps.options.workerId+"_cancel");if(lease)try{repository.withLease(lease,()=>ledger.markFailed(id,{errorCode:"HEDGE_NOT_SUBMITTED",errorMessage:"Winner selected before submit",isBillableFailure:false}));store.update(id,{state:"cancelled"},true);}finally{repository.release(lease);}}
      else if(loser.provider_job_id&&!["completed","failed"].includes(loser.status)){
        const adapter=gateway.getAdapter(loser.provider as BackendProvider);
        if(adapter?.cancelJob)try{await withProviderRequestContext(store,loser.provider,"poll",()=>withDeadline(adapter.cancelJob!(loser.provider_job_id!),10_000),AbortSignal.timeout(10_000));repository.audit(id,{action:"cancel_requested",groupId:currentGroup.id});}catch{repository.audit(id,{action:"cancel_request_failed",groupId:currentGroup.id});}
      }
    }
  }
  if(!winner)throw new WorkflowError("HEDGE_REVIEW_REQUIRED", "HEDGE_REVIEW_REQUIRED", "needs_review");
  const winningPath=winner.videoPath!;
  const winningJob=bible.getProviderJob(winner.jobId)!;
  if(!(await probeVideoFile(winningPath)).isValid||await hashFile(winningPath)!==JSON.parse(winningJob.metadata_json??"{}").asset_sha256)throw new WorkflowError("HEDGE_WINNER_MEDIA_INVALID", "HEDGE_WINNER_MEDIA_INVALID", "failed");
  deps.options.signal?.throwIfAborted();await mkdir(dirname(destination),{recursive:true});const temporary=destination+"."+randomUUID()+".tmp";
  try{await copyFile(winningPath,temporary);deps.options.signal?.throwIfAborted();assertMediaOwnership();publishMediaRename(temporary,destination);}finally{await rm(temporary,{force:true});}
  return {...winner,videoPath:destination};
}
