import { WorkflowError } from "../../../../platform/workflow-error.js";
import type { ManualReconciliationStore } from "../../ports/manual-reconciliation-store.js";
import type {DispatchCoordination} from '../../ports/runtime-services.js';
import { BudgetLedger } from "./budget-ledger.js";
import { z } from "zod";
export const ManualReconciliationSchema=z.object({attemptId:z.string().min(1),action:z.enum(["attach_remote_id","confirmed_success","confirmed_no_charge","confirmed_billed_failure"]),remoteId:z.string().min(1).optional(),actualCostUsd:z.number().finite().nonnegative().optional(),evidence:z.string().min(10).max(20_000)}).strict().superRefine((value,ctx)=>{if(value.action==="attach_remote_id"&&!value.remoteId)ctx.addIssue({code:"custom",message:"Remote ID required"});if(["confirmed_success","confirmed_billed_failure"].includes(value.action)&&value.actualCostUsd===undefined)ctx.addIssue({code:"custom",message:"Confirmed amount required, including zero"});});
export function reconcileManually(bible:ManualReconciliationStore,store:Pick<DispatchCoordination,"get"|"recordRemoteId"|"update">,seriesId:string,input:z.infer<typeof ManualReconciliationSchema>){
  const job=bible.getProviderJob(input.attemptId);if(!job||job.series_id!==seriesId)throw new WorkflowError("ATTEMPT_NOT_FOUND", "ATTEMPT_NOT_FOUND", "failed");
  const repository=bible,lease=repository.claim(job.id,"manual_"+process.pid);
  if(!lease)throw new WorkflowError("WORKER_LOCK_CONFLICT", "WORKER_LOCK_CONFLICT", "failed");
  try{repository.withLease(lease,()=>{
    if(input.action==="attach_remote_id"){
      if(job.provider_job_id&&job.provider_job_id!==input.remoteId)throw new WorkflowError("REMOTE_ID_CONFLICT", "REMOTE_ID_CONFLICT", "failed");
      bible.createOrUpdateProviderJob({...job,provider_job_id:input.remoteId,status:"uncertain_timeout"});
    }else{
      const ledger=new BudgetLedger(bible);
      if(input.action==="confirmed_success")ledger.markConfirmed(job.id,input.actualCostUsd!,{localPath:job.output_local_path,url:job.output_url,isInvoiced:false,metadata:{cost_source:"manual_reconciliation"}});
      else {ledger.reconcileUncertainJob(job.id,input.action,{actualCostUsd:input.actualCostUsd,error:input.evidence});const updated=bible.getProviderJob(job.id)!;updated.confirmed_cost_usd=input.action==="confirmed_no_charge"?0:input.actualCostUsd!;updated.uncertain_cost_usd=0;updated.reserved_cost_usd=0;updated.metadata_json=JSON.stringify({...JSON.parse(updated.metadata_json??"{}"),cost_source:"manual_reconciliation",is_invoiced:false});bible.createOrUpdateProviderJob(updated);}
    }
    repository.audit(job.id,{...input,previous:job,source:"manual_reconciliation",timestamp:new Date().toISOString()});
  });}finally{repository.release(lease);}
  if(store.get(job.id)){if(input.action==="attach_remote_id")store.recordRemoteId(job.id,input.remoteId!);else store.update(job.id,{state:input.action==="confirmed_success"?"completed":"failed"},true);}
  return bible.getProviderJob(job.id)!;
}
