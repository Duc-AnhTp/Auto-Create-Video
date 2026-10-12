import { failureDisposition,errorCode } from "../../platform/workflow-error.js";
import { WorkflowError } from "../../platform/workflow-error.js";
import "../../platform/processes/media-runtime.js";
import { measureRuntime,RuntimePhases,type RuntimeMetrics } from "../../platform/observability/runtime-metrics.js";


import { reconcileProviderAttempts,repairProviderDispatches } from "../../bootstrap/provider-recovery.js";
import { executeProductionJob } from "../../bootstrap/job-executor.js";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { redact } from "../../platform/observability/redact.js";

import { importStory } from "../../bootstrap/studio-story.js";
import {createWorkerRuntime} from '../../bootstrap/worker-runtime.js';
import {log} from '../../platform/observability/logger.js';
const runtime=createWorkerRuntime(process.argv[2]),{store,dispatchStore}=runtime,owner=randomUUID(),parentPid=Number(process.argv[3]);
let currentAbort:AbortController|undefined;
let stopping=false,reconciling:Promise<void>|undefined;
repairProviderDispatches(dispatchStore);
process.on("SIGTERM",()=>{stopping=true;currentAbort?.abort();});process.on("SIGINT",()=>{stopping=true;currentAbort?.abort();});
function refreshSettings(){const settings=runtime.readSettings();if(process.env.OFFLINE_WORKER==="1"){for(const key of Object.keys(process.env))if(/(API_KEY|ACCESS_TOKEN|SECRET|ENDPOINT|BASE_URL)$/.test(key))delete process.env[key];for(const key of Object.keys(settings))if(/(API_KEY|ACCESS_TOKEN|SECRET|ENDPOINT|BASE_URL)$/.test(key))delete settings[key];process.env.OFFLINE_RUNTIME="1";}Object.assign(process.env,settings);}
while(!stopping){
  if (Number.isInteger(parentPid) && parentPid > 0) {
    try { process.kill(parentPid, 0); } catch { break; }
  }
  refreshSettings();
  if(!reconciling)reconciling=reconcileProviderAttempts(dispatchStore,owner+"_reconcile").catch(error=>{log.warn('[WORKER RECONCILIATION] '+redact(String(error)));}).finally(()=>{reconciling=undefined;});
  const job=store.claim(owner);
  if(!job){const source=store.claimStoryImport(owner);if(!source){await delay(500);continue;}
    const heartbeat=setInterval(()=>{try{if(!store.heartbeatStoryImport(source.id,owner))stopping=true;}catch{stopping=true;currentAbort?.abort();}},5000);
    try{const result=await importStory(source.request.seriesId,source.request,async()=>{if(stopping||!store.isStoryImportOwner(source.id,owner))throw new WorkflowError("WORKER_LEASE_LOST", "WORKER_LEASE_LOST", "lease_lost");});store.finishStoryImport(source.id,owner,result);}
    catch(error){try{store.failStoryImport(source.id,owner,{code:"STORY_IMPORT_FAILED",message:redact(String(error))});}catch(error){log.warn('[WORKER STATE] '+redact(String(error)));}}
    finally{clearInterval(heartbeat);}continue;
  }
  const abort=new AbortController();currentAbort=abort;
  const assertOwnership=()=>{if(!store.isOwner(job.id,owner,job.leaseVersion!))throw new WorkflowError("WORKER_LEASE_LOST", "WORKER_LEASE_LOST", "lease_lost");};
  const heartbeat = setInterval(() => {
    try {
      if (!store.heartbeat(job.id, owner, job.leaseVersion)) {
        abort.abort();
        stopping = true;
      } else if (store.get(job.id).control === "cancel") {
        abort.abort();
      }
    } catch (err) {
      abort.abort(); stopping = true;
      log.warn("[WORKER HEARTBEAT] " + redact(String(err)));
    }
  }, 5000);
  const checkpoint=async()=>{while(true){assertOwnership();if(stopping)throw new WorkflowError("WORKER_STOPPING", "WORKER_STOPPING", "lease_lost");const current=store.get(job.id);if(current.control==="cancel")throw new WorkflowError("JOB_CANCELLED", "JOB_CANCELLED", "cancelled");if(current.control!=="pause")return;await delay(250);}};
  const phases=new RuntimePhases();let metrics:RuntimeMetrics|undefined;
  try {
    await checkpoint();
    const measured=await measureRuntime(()=>executeProductionJob(job,{checkpoint,assertOwnership,signal:abort.signal,publish:work=>store.publishOwned(job.id,owner,job.leaseVersion!,work),progress:(step,total,message)=>{phases.progress(step,message);store.update(job.id,owner,{progress:{step,total,message}},undefined,job.leaseVersion);}},{dispatchStore:dispatchStore}),value=>{metrics={...value,phases:phases.finish()};});
    const result=measured.value;Object.assign(result.result,{metrics});
    await checkpoint();store.update(job.id,owner,{metrics,result:result.result,error:result.ready?null:{code:"REVIEW_REQUIRED",message:"Cần kiểm tra chất lượng, canon hoặc đối soát chi phí."}},result.ready?"succeeded":"needs_review",job.leaseVersion);
  } catch (error) {
    const message = redact(error instanceof Error ? error.message : String(error));
    let isCancelled = abort.signal.aborted || failureDisposition(error) === "cancelled";
    try {
      if (store.get(job.id).control === "cancel") isCancelled = true;
    } catch {}
    const review = failureDisposition(error) === "needs_review";
    if (failureDisposition(error) !== "lease_lost") {
      try {
        store.update(
          job.id,
          owner,
          { metrics, error: { code: isCancelled ? "JOB_CANCELLED" : errorCode(error) ?? (review ? "REVIEW_REQUIRED" : "PRODUCTION_FAILED"), message } },
          isCancelled ? "cancelled" : review ? "needs_review" : "failed",
          job.leaseVersion
        );
      } catch (caughtError) {
        log.warn("[main] " + String(caughtError));
      }
    }
  } finally { clearInterval(heartbeat); abort.abort(); currentAbort = undefined; }
}
await reconciling;runtime.dispose();
