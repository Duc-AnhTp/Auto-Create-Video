import {migrateQueue} from '../../../../platform/sqlite/queue-schema.js';
import {SqliteSeriesOperationCoordinator} from './series-operation-coordinator.js';
import { WorkflowError } from "../../../../platform/workflow-error.js";
import { DatabaseSync } from "node:sqlite";
import { mkdirSync,existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { randomUUID,createHash } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { DEFAULT_PROVIDER_RATE_LIMITS, type ProviderRateConfig } from "../../application/dispatch/provider-rate-limiter.js";
import type { VideoJobStatus } from "../../../../contracts/video.js";

export interface DispatchAttempt {
  id:string;seriesId:string;seriesDbPath:string;provider:string;account?:string;
  state:"reserved"|"submitting"|"submitted"|"running"|"completed"|"failed"|"uncertain"|"cancelled";
  remoteId?:string;groupId?:string;spec?:Record<string,unknown>;destinationPath?:string;
  remoteTerminal?:boolean;
  billingSettled?:boolean;
  parentJobId?:string;
}
export class ProviderDispatchStore {
  private db:DatabaseSync;
  private isClosed = false;
  readonly seriesCoordinator:SqliteSeriesOperationCoordinator;
  private resourceReleases=new Set<()=>void>();
  constructor(readonly path=process.env.STUDIO_JOB_DB??resolve("data/studio-jobs.db")) {
    if(path!==':memory:')mkdirSync(dirname(path),{recursive:true});
    this.db=new DatabaseSync(path);
    try{migrateQueue(this.db,path);}catch(error){this.db.close();throw error;}
    this.seriesCoordinator=new SqliteSeriesOperationCoordinator(this.db);
  }
  close(): void {
    if (this.isClosed) return;
    for(const release of this.resourceReleases){try{release();}catch{ /* Timer was cleared before attempting DB cleanup. */ }}
    this.isClosed = true;
    try { this.db.close(); } catch {}
  }
  transaction<T>(fn:()=>T):T {this.db.exec("BEGIN IMMEDIATE");try{const value=fn();this.db.exec("COMMIT");return value;}catch(error){this.db.exec("ROLLBACK");throw error;}}
  configure(provider:string,config:ProviderRateConfig,account="default"):void {
    if(!Number.isInteger(config.maxConcurrent)||config.maxConcurrent<1||!Number.isInteger(config.maxRpm)||config.maxRpm<1)throw new WorkflowError("INVALID_PROVIDER_LIMIT", "INVALID_PROVIDER_LIMIT", "failed");
    this.db.prepare("INSERT OR REPLACE INTO provider_limit_config VALUES(?,?,?,?)").run(provider,account,provider==="local_comfyui"?1:config.maxConcurrent,config.maxRpm);
  }
  limits(provider:string,account="default"):ProviderRateConfig {
    const row=this.db.prepare("SELECT max_jobs,max_rpm FROM provider_limit_config WHERE provider=? AND account=?").get(provider,account);
    const limit=row?{maxConcurrent:Number(row.max_jobs),maxRpm:Number(row.max_rpm)}:DEFAULT_PROVIDER_RATE_LIMITS[provider]??{maxConcurrent:2,maxRpm:10};return provider==="local_comfyui"?{...limit,maxConcurrent:1}:limit;
  }
  register(attempt:DispatchAttempt):void {
    const old=this.get(attempt.id);if(old){if(old.provider!==attempt.provider||old.seriesId!==attempt.seriesId)throw new WorkflowError("DISPATCH_ID_CONFLICT", "DISPATCH_ID_CONFLICT", "failed");return;}
    this.db.prepare("INSERT OR IGNORE INTO provider_dispatches(id,series_id,provider,account,state,remote_id,payload) VALUES(?,?,?,?,?,?,?)").run(attempt.id,attempt.seriesId,attempt.provider,attempt.account??"default",attempt.state,attempt.remoteId??null,JSON.stringify(attempt));
  }
  get(id:string):DispatchAttempt|null {const row=this.db.prepare("SELECT payload FROM provider_dispatches WHERE id=?").get(id);return row?JSON.parse(String(row.payload)):null;}
  active():DispatchAttempt[]{return this.db.prepare("SELECT payload FROM provider_dispatches WHERE state IN ('reserved','submitting','submitted','running','uncertain')").all().map(row=>JSON.parse(String(row.payload)));}
  parentCancelled(id:string):boolean {try{return this.db.prepare("SELECT control FROM studio_jobs WHERE id=?").get(id)?.control==="cancel";}catch{return false;}}
  recordRemoteId(id:string,remoteId:string):void {
    this.transaction(()=>{const value=this.get(id);if(!value)throw new WorkflowError("DISPATCH_NOT_FOUND", "DISPATCH_NOT_FOUND", "failed");if(value.remoteId&&value.remoteId!==remoteId)throw new WorkflowError("REMOTE_ID_CONFLICT", "REMOTE_ID_CONFLICT", "failed");
      value.remoteId=remoteId;if(!["completed","failed","cancelled"].includes(value.state))value.state="submitted";
      this.db.prepare("UPDATE provider_dispatches SET remote_id=?,state=?,payload=? WHERE id=?").run(remoteId,value.state,JSON.stringify(value),id);
    });
  }
  update(id:string,patch:Partial<DispatchAttempt>,terminal=false):void {
    this.transaction(()=>{const value=this.get(id);if(!value)throw new WorkflowError("DISPATCH_NOT_FOUND", "DISPATCH_NOT_FOUND", "failed");Object.assign(value,patch);
      this.db.prepare("UPDATE provider_dispatches SET state=?,remote_id=?,payload=?,slot_held=CASE WHEN ? THEN 0 ELSE slot_held END WHERE id=?").run(value.state,value.remoteId??null,JSON.stringify(value),terminal?1:0,id);
    });
  }
  trySlot(id:string):boolean {
    return this.transaction(()=>{const row=this.db.prepare("SELECT provider,account,slot_held FROM provider_dispatches WHERE id=?").get(id);if(!row)throw new WorkflowError("DISPATCH_NOT_FOUND", "DISPATCH_NOT_FOUND", "failed");if(Number(row.slot_held)===1)return true;
      const limit=this.limits(String(row.provider),String(row.account));const count=Number(row.provider==="local_comfyui"?this.db.prepare("SELECT count(*) AS n FROM provider_dispatches WHERE provider=? AND slot_held=1").get(row.provider)?.n??0:this.db.prepare("SELECT count(*) AS n FROM provider_dispatches WHERE provider=? AND account=? AND slot_held=1").get(row.provider,row.account)?.n??0);
      if(count>=limit.maxConcurrent)return false;this.db.prepare("UPDATE provider_dispatches SET slot_held=1 WHERE id=?").run(id);return true;
    });
  }
  async waitSlot(id:string,signal?:AbortSignal):Promise<void>{while(!this.trySlot(id)){signal?.throwIfAborted();await delay(100,undefined,{signal});}}
  recoverSlot(attempt:DispatchAttempt):void{this.register(attempt);this.db.prepare("UPDATE provider_dispatches SET slot_held=? WHERE id=?").run(this.get(attempt.id)?.remoteTerminal?0:1,attempt.id);}
  async requestPermit(provider:string,kind:"submit"|"poll",signal?:AbortSignal,account="default"):Promise<void> {
    const id=randomUUID();
    try {while(true){signal?.throwIfAborted();const acquired=this.transaction(()=>{const now=Date.now();
      this.db.prepare("DELETE FROM provider_request_waiters WHERE updated_at<?").run(now-2000);
      this.db.prepare("INSERT OR REPLACE INTO provider_request_waiters VALUES(?,?,?,?,?)").run(id,provider,account,kind,now);
      this.db.prepare("DELETE FROM provider_requests WHERE created_at<=?").run(now-60_000);
      if(kind==="submit"&&this.db.prepare("SELECT id FROM provider_request_waiters WHERE provider=? AND account=? AND kind='poll' AND id!=? LIMIT 1").get(provider,account,id))return false;
      const count=Number(this.db.prepare("SELECT count(*) AS n FROM provider_requests WHERE provider=? AND account=?").get(provider,account)?.n??0);
      if(count>=this.limits(provider,account).maxRpm)return false;
      this.db.prepare("INSERT INTO provider_requests(provider,account,created_at) VALUES(?,?,?)").run(provider,account,now);this.db.prepare("DELETE FROM provider_request_waiters WHERE id=?").run(id);return true;
    });if(acquired)return;await delay(100,undefined,{signal});}}
    finally {this.db.prepare("DELETE FROM provider_request_waiters WHERE id=?").run(id);}
  }
  receiveWebhook(provider:string,status:VideoJobStatus):void {
    this.transaction(()=>{const old=this.webhook(provider,status.jobId);
      if(old&&["completed","failed"].includes(old.status)&&!["completed","failed"].includes(status.status))return;
      const amount=status.invoicedCostUsd??(status.isConfirmedInvoice?status.costUsd:undefined);
      if(amount!==undefined&&Number.isFinite(amount)&&amount>=0){
        const id=createHash('sha256').update(JSON.stringify([provider,status.jobId,amount])).digest('hex');
        this.db.prepare('INSERT OR IGNORE INTO provider_invoice_events(id,provider,remote_id,payload,received_at) VALUES(?,?,?,?,?)').run(id,provider,status.jobId,JSON.stringify({...status,invoicedCostUsd:amount,isConfirmedInvoice:true}),Date.now());
      }
      const merged=old&&['completed','failed'].includes(old.status)?{...old,...status,status:old.status}:status;
      this.db.prepare("INSERT OR REPLACE INTO provider_webhook_inbox VALUES(?,?,?,?)").run(provider,status.jobId,JSON.stringify(merged),Date.now());
    });
  }
  pendingInvoices(limit=100,afterId=""):{id:string;attempt:DispatchAttempt;status:VideoJobStatus}[]{return this.db.prepare("SELECT e.id,e.payload,d.payload AS attempt FROM provider_invoice_events e JOIN provider_dispatches d ON d.provider=e.provider AND d.remote_id=e.remote_id WHERE e.applied=0 AND e.id>? ORDER BY e.id LIMIT ?").all(afterId,limit).map(row=>({id:String(row.id),attempt:JSON.parse(String(row.attempt)),status:JSON.parse(String(row.payload))}));}
  acknowledgeInvoice(id:string):void{this.db.prepare('UPDATE provider_invoice_events SET applied=1 WHERE id=?').run(id);}
  reconciliationCandidates(limit=100,afterId=""):DispatchAttempt[]{return this.db.prepare("SELECT payload FROM provider_dispatches WHERE id>? AND (state IN ('reserved','submitting','submitted','running','uncertain') OR (provider!='mock' AND remote_id IS NOT NULL AND COALESCE(json_extract(payload,'$.billingSettled'),0)=0)) ORDER BY id LIMIT ?").all(afterId,limit).map(row=>JSON.parse(String(row.payload)));}
  webhook(provider:string,remoteId:string):VideoJobStatus|null {const row=this.db.prepare("SELECT payload FROM provider_webhook_inbox WHERE provider=? AND remote_id=?").get(provider,remoteId);return row?JSON.parse(String(row.payload)):null;}
  async acquireResource(resource:string,limit=1,signal?:AbortSignal):Promise<(()=>void)&{assertOwned:()=>void}> {
    const id=randomUUID();while(true){signal?.throwIfAborted();const acquired=this.transaction(()=>{this.db.prepare("DELETE FROM studio_resource_locks WHERE lease_until<=?").run(Date.now());
      const count=Number(this.db.prepare("SELECT count(*) AS n FROM studio_resource_locks WHERE resource=?").get(resource)?.n??0);if(count>=limit)return false;
      this.db.prepare("INSERT INTO studio_resource_locks VALUES(?,?,?)").run(id,resource,Date.now()+30_000);return true;
    });if(acquired)break;await delay(100,undefined,{signal});}
    let lost=false;
    const timer=setInterval(()=>{try{const now=Date.now();if(Number(this.db.prepare("UPDATE studio_resource_locks SET lease_until=? WHERE id=? AND lease_until>?").run(now+30_000,id,now).changes)!==1)lost=true;}catch{lost=true;clearInterval(timer);}},5000);
    let released=false;const release=()=>{if(released)return;released=true;clearInterval(timer);this.resourceReleases.delete(release);this.db.prepare("DELETE FROM studio_resource_locks WHERE id=?").run(id);};
    this.resourceReleases.add(release);
    return Object.assign(release,{assertOwned:()=>{const row=this.db.prepare("SELECT lease_until FROM studio_resource_locks WHERE id=?").get(id);if(lost||released||!row||Number(row.lease_until)<=Date.now())throw new WorkflowError("MEDIA_RESOURCE_LEASE_LOST", "MEDIA_RESOURCE_LEASE_LOST", "failed");}});
  }
  metrics() {
    const counts=(rows:Record<string,unknown>[])=>rows.map(row=>({provider:String(row.provider),account:String(row.account??"default"),count:Number(row.count)}));
    return {activeJobs:counts(this.db.prepare("SELECT provider,account,count(*) AS count FROM provider_dispatches WHERE slot_held=1 GROUP BY provider,account").all()),
      requestsLastMinute:counts(this.db.prepare("SELECT provider,account,count(*) AS count FROM provider_requests WHERE created_at>? GROUP BY provider,account").all(Date.now()-60_000)),
      waiting:this.db.prepare("SELECT provider,kind,count(*) AS count FROM provider_request_waiters WHERE updated_at>? GROUP BY provider,kind").all(Date.now()-2000).map(row=>({provider:String(row.provider),kind:String(row.kind),count:Number(row.count)})),
      recovery:{ttsAttempts:Number(this.db.prepare("SELECT count(*) AS n FROM tts_attempts WHERE state!='completed'").get()?.n??0),pendingInvoices:Number(this.db.prepare('SELECT count(*) AS n FROM provider_invoice_events WHERE applied=0').get()?.n??0),maintenance:Number(this.db.prepare('SELECT count(*) AS n FROM series_maintenance').get()?.n??0)},
      uncertain:this.db.prepare("SELECT count(*) AS count FROM provider_dispatches WHERE state='uncertain'").get(),webhooks:this.db.prepare("SELECT count(*) AS count FROM provider_webhook_inbox").get()};
  }
}
