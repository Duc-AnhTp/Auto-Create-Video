import { errorCode } from '../../../../platform/workflow-error.js';
import { WorkflowError } from "../../../../platform/workflow-error.js";
import { existsSync } from "node:fs";
import { copyFile, mkdir, rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { dirname } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import type { ProviderDispatcherStore } from "../../ports/provider-dispatcher-store.js";
import type { ProviderJobRecord } from "../../../../contracts/story.js";
import type { AttemptLease } from "../../../../contracts/production.js";
import { BudgetLedger } from "./budget-ledger.js";
import type {DispatchCoordination} from '../../ports/runtime-services.js';
import { withProviderRequestContext } from "./provider-request-context.js";
import { downloadVideoFromUrl, type VideoModelGateway } from "./video-gateway.js";
import { type ShotExecutionSpec, type VideoJobStatus, type BackendProvider } from "../../../../contracts/video.js";
import { probeVideoFile } from "../../../media/index.js";
import { hashFile } from "../../../media/index.js";
import { assertMediaOwnership,publishMediaRename } from "../../../../platform/processes/media-process-runner.js";
import { countRuntime } from "../../../../platform/observability/runtime-metrics.js";
import { withDeadline } from "../../../../platform/processes/async-deadline.js";

export interface DispatchResult {jobId:string;providerJobId?:string;status:"completed";videoPath?:string;videoUrl?:string;costUsd:number;isInvoiced:boolean;specHash:string;isCacheHit:false;attemptsUsed:number}
export interface DispatcherOptions {workerId:string;pollIntervalMs:number;pollTimeoutMs:number;submitTimeoutMs:number;signal?:AbortSignal;checkpoint?:()=>Promise<void>;parentJobId?:string}
export class DispatchUncertainError extends Error {readonly code="PROVIDER_SUBMIT_UNCERTAIN";
  constructor(readonly jobId:string,readonly provider:string,readonly specHash:string,message:string){super(`UNCERTAIN_TIMEOUT: ${message}`);}
}
export class ProviderDispatcher {
  private ledger:BudgetLedger;
  constructor(private bible:ProviderDispatcherStore,private gateway:VideoModelGateway,readonly store:DispatchCoordination,private options:DispatcherOptions){this.ledger=new BudgetLedger(bible);}
  private snapshot(job:ProviderJobRecord,spec:ShotExecutionSpec,destinationPath?:string){return {id:job.id,seriesId:job.series_id,seriesDbPath:this.bible.getDbPath(),provider:job.provider,state:job.status==="uncertain_timeout"?"uncertain" as const:job.status==="reserved"?"reserved" as const:job.status==="completed"?"completed" as const:job.status==="failed"?"failed" as const:job.status==="submitting"?"submitting" as const:job.status==="running"?"running" as const:"submitted" as const,remoteId:job.provider_job_id,parentJobId:this.options.parentJobId??JSON.parse(job.metadata_json??"{}").parent_job_id,spec:{...spec},destinationPath};}
  async execute(job:ProviderJobRecord,spec:ShotExecutionSpec,destinationPath?:string):Promise<DispatchResult> {
    const repository=this.bible;const lease=repository.claim(job.id,this.options.workerId);
    if(!lease)throw new WorkflowError("WORKER_LOCK_CONFLICT", "WORKER_LOCK_CONFLICT", "failed");
    let lost=false;
    const abort=new AbortController();
    const signal=AbortSignal.any([abort.signal,...(this.options.signal?[this.options.signal]:[])]);
    const heartbeat=setInterval(()=>{try{if(!repository.heartbeat(lease)){lost=true;abort.abort();}}catch{lost=true;abort.abort();}},20_000);
    const assertLease=()=>{if(lost)throw new WorkflowError("WORKER_LEASE_LOST", "WORKER_LEASE_LOST", "lease_lost");repository.withLease(lease,()=>undefined);};
    try {
      const persisted=this.bible.getProviderJob(job.id);
      if(!persisted)throw new WorkflowError("BUDGET_RESERVATION_REQUIRED", "BUDGET_RESERVATION_REQUIRED", "needs_review");
      job=persisted;
      if(!["reserved","submitting","submitted","running","uncertain_timeout"].includes(job.status))throw new WorkflowError("BUDGET_RESERVATION_REQUIRED", "BUDGET_RESERVATION_REQUIRED", "needs_review");
      if(job.provider!==(spec.backend??"mock"))throw new WorkflowError("DISPATCH_PROVIDER_MISMATCH", "DISPATCH_PROVIDER_MISMATCH", "failed");
      this.store.register(this.snapshot(job,spec,destinationPath));
      const dispatch=this.store.get(job.id)!;
      if(!job.provider_job_id&&dispatch.remoteId) {job.provider_job_id=dispatch.remoteId;repository.withLease(lease,()=>this.bible.createOrUpdateProviderJob(job));}
      if(!job.provider_job_id&&["submitting","uncertain_timeout"].includes(job.status)) {
        this.store.recoverSlot(this.snapshot(job,spec,destinationPath));
        return this.uncertain(job,lease,"Submission outcome is unknown; reconcile before dispatching again");
      }
      const adapter=this.gateway.getAdapter(job.provider as BackendProvider);if(!adapter)throw new Error(`Provider adapter '${job.provider}' unavailable`);
      if((adapter.capabilities?.requiresLocalRestore??job.provider==="mock")&&job.provider_job_id)adapter.restoreJob?.(job.provider_job_id,{...spec,destinationLocalPath:destinationPath??job.output_local_path});
      if(!job.provider_job_id) {
        await this.store.waitSlot(job.id,signal);await this.options.checkpoint?.();assertLease();signal.throwIfAborted();
        job.status="submitting";job.output_local_path=destinationPath;
        job.metadata_json=JSON.stringify({...JSON.parse(job.metadata_json??"{}"),execution_spec:spec,destination_path:destinationPath});
        repository.withLease(lease,()=>this.bible.createOrUpdateProviderJob(job));this.store.update(job.id,{state:"submitting"});
        let timer:ReturnType<typeof setTimeout>|undefined;
        try {
          const submission=withProviderRequestContext(this.store,job.provider,"submit",()=>{countRuntime("providerSubmit");return adapter.submitJob({...spec,enableHedge:false,metadata:{...spec.metadata,idempotencyKey:job.idempotency_key}});},signal,this.options.checkpoint)
            .then(response=>{if(!response.jobId)throw new WorkflowError("REMOTE_ID_REQUIRED", "REMOTE_ID_REQUIRED", "failed");this.store.recordRemoteId(job.id,response.jobId);return response;});
          const response=await Promise.race([submission,new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Error("Submit timed out")),this.options.submitTimeoutMs);})]);
          assertLease();repository.withLease(lease,()=>this.ledger.markSubmitted(job.id,response.jobId,job.idempotency_key));
          job=this.bible.getProviderJob(job.id)!;
        } catch(error) {
          if(errorCode(error)==="WORKER_LEASE_LOST")throw error;
          const status=(error as {response?:{status?:number}})?.response?.status;
          if(status&&[400,401,403,404,422,429].includes(status)) {
            repository.withLease(lease,()=>this.ledger.markFailed(job.id,{errorMessage:String(error),isBillableFailure:false,isRetryable:false}));this.store.update(job.id,{state:"failed"},true);throw error;
          }
          return this.uncertain(job,lease,String(error));
        } finally {if(timer)clearTimeout(timer);}
      } else this.store.recoverSlot(this.snapshot(job,spec,destinationPath));
      return await this.poll(job,spec,destinationPath,lease,assertLease,signal);
    } finally {clearInterval(heartbeat);abort.abort();repository.release(lease);}
  }
  private uncertain(job:ProviderJobRecord,lease:AttemptLease,message:string):never {
    this.bible.withLease(lease,()=>this.ledger.markUncertainTimeout(job.id,message,job.provider_job_id));
    this.store.update(job.id,{state:"uncertain",remoteId:job.provider_job_id??this.store.get(job.id)?.remoteId});
    throw new DispatchUncertainError(job.id,job.provider,job.spec_hash,message);
  }
  private async poll(job:ProviderJobRecord,spec:ShotExecutionSpec,destinationPath:string|undefined,lease:AttemptLease,assertLease:()=>void,signal:AbortSignal):Promise<DispatchResult> {
    const adapter=this.gateway.getAdapter(job.provider as BackendProvider)!;const start=Date.now();let wait=this.options.pollIntervalMs;
    const cancel=async()=>{if(adapter.cancelJob)try{await withProviderRequestContext(this.store,job.provider,"poll",()=>withDeadline(adapter.cancelJob!(job.provider_job_id!),10_000),AbortSignal.timeout(10_000));this.bible.audit(job.id,{action:"cancel_requested",remoteId:job.provider_job_id});}catch{this.bible.audit(job.id,{action:"cancel_request_failed",remoteId:job.provider_job_id});}};
    while(Date.now()-start<this.options.pollTimeoutMs) {
      if(signal?.aborted){await cancel();return this.uncertain(job,lease,"Local processing cancelled; remote billing remains under reconciliation");}
      assertLease();let status:VideoJobStatus;
      try {status=this.store.webhook(job.provider,job.provider_job_id!)??await withProviderRequestContext(this.store,job.provider,"poll",()=>withDeadline(adapter.pollStatus(job.provider_job_id!),Math.min(30_000,Math.max(1,this.options.pollTimeoutMs-(Date.now()-start)))),signal);}
      catch(error){return this.uncertain(job,lease,String(error));}
      assertLease();
      if(status.status==="failed") {
        this.store.update(job.id,{state:"failed",remoteTerminal:true},true);
        const amount=status.invoicedCostUsd??(status.isConfirmedInvoice?status.costUsd:undefined);
        if(amount===undefined||!Number.isFinite(amount)||amount<0)return this.uncertain(job,lease,"Provider failed; billing is unknown or invalid");
        this.bible.withLease(lease,()=>this.ledger.markFailed(job.id,{errorMessage:status.error??"Provider failed",isBillableFailure:true,actualCostUsd:amount,isRetryable:false}));
        throw new Error(`Remote job failed: ${status.error??job.provider_job_id}`);
      }
      if(status.status==="completed") {
        this.store.update(job.id,{state:"completed",remoteTerminal:true},true);
        let path=status.localPath;const target=destinationPath??job.output_local_path??spec.destinationLocalPath;
        try {
          if(target) await mkdir(dirname(target),{recursive:true});
          if(target&&((status.videoUrl&&(!path||!existsSync(path)))||(path&&target!==path&&existsSync(path)))){
            const temporary=target+"."+randomUUID()+".tmp.mp4";
            try{if(path&&existsSync(path))await copyFile(path,temporary);else await downloadVideoFromUrl(status.videoUrl!,temporary,job.provider!=="mock");
              if(!(await probeVideoFile(temporary)).isValid)throw new WorkflowError("PROVIDER_MEDIA_INVALID", "PROVIDER_MEDIA_INVALID", "failed");
              assertLease();assertMediaOwnership();this.bible.withLease(lease,()=>publishMediaRename(temporary,target));path=target;
            }finally{await rm(temporary,{force:true});}
          }
          if(target&&(!path||!(await probeVideoFile(path)).isValid))throw new WorkflowError("PROVIDER_MEDIA_INVALID", "PROVIDER_MEDIA_INVALID", "failed");
          assertLease();
        }catch(error){return this.uncertain(job,lease,String(error));}
        const invoiced=job.provider!=="mock"&&(status.invoicedCostUsd!==undefined||status.isConfirmedInvoice===true&&status.costUsd!==undefined);
        if(job.provider!=='mock'&&status.isConfirmedInvoice===true&&status.invoicedCostUsd===undefined&&status.costUsd===undefined)return this.uncertain(job,lease,'Confirmed invoice missing amount');
        const cost=job.provider==="mock"?0:status.invoicedCostUsd??status.costUsd??job.estimated_cost_usd;
        if(!Number.isFinite(cost)||cost<0)return this.uncertain(job,lease,"Invalid provider cost");
        const sha=path&&existsSync(path)?await hashFile(path):undefined;
        this.bible.withLease(lease,()=>this.ledger.markConfirmed(job.id,cost,{localPath:path,url:status.videoUrl,isInvoiced:invoiced,metadata:{asset_sha256:sha,cost_source:job.provider==="mock"?"mock":invoiced?"provider_invoice":"rate_card_estimate"}}));
        this.store.update(job.id,{billingSettled:job.provider==='mock'||invoiced});
        return {jobId:job.id,providerJobId:job.provider_job_id,status:"completed",videoPath:path,videoUrl:status.videoUrl,costUsd:cost,isInvoiced:invoiced,specHash:job.spec_hash,isCacheHit:false,attemptsUsed:job.attempt_count};
      }
      try{await delay(wait,undefined,{signal:signal});}catch{await cancel();return this.uncertain(job,lease,"Local polling cancelled; remote billing remains under reconciliation");}wait=Math.min(6000,wait*1.25);
    }
    return this.uncertain(job,lease,"Polling timed out");
  }
}
