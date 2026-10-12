import {withDeadline} from '../platform/processes/async-deadline.js';
import {log} from '../platform/observability/logger.js';
import { SqliteStoryStore } from "./sqlite-story-store.js";
import { createDefaultVideoGateway } from "./video-gateway.js";
import { type ShotExecutionSpec } from "../contracts/video.js";
import { type VideoModelGateway } from "../modules/production/application/dispatch/video-gateway.js";
import type { ProviderDispatchStore } from "../modules/production/adapters/sqlite/provider-dispatch-store.js";
import { ProviderDispatcher } from "../modules/production/application/dispatch/provider-dispatcher.js";
import { existsSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { BudgetLedger } from "../modules/production/application/dispatch/budget-ledger.js";
import { ProjectPaths } from "../platform/filesystem/project-paths.js";
import {withProviderRequestContext} from '../modules/production/application/dispatch/provider-request-context.js';
/** Repairs the gap between the series transaction and the shared dispatch database. */
export function repairProviderDispatches(store: ProviderDispatchStore, root = resolve("data/series"), paths = new ProjectPaths()): void {
    if (!existsSync(root))
        return;
    for (const entry of readdirSync(root, { withFileTypes: true })) {
        if (!entry.isDirectory() || entry.isSymbolicLink() || !/^[a-zA-Z0-9_-]+$/.test(entry.name))
            continue;
        const path = paths.check(entry.name, join(root, entry.name, "story_bible.db"));
        if (!existsSync(path))
            continue;
        const bible = new SqliteStoryStore(path);
        try {
            for (const job of bible.listProviderJobs(entry.name)) {
                let metadata: Record<string, unknown> = {};
                try {
                    metadata = JSON.parse(job.metadata_json ?? "{}");
                }
                catch(error) {log.warn("[DISPATCH REPAIR] Invalid metadata for "+job.id+": "+String(error));}
                if(["completed","failed","cancelled"].includes(job.status)){
                    if(job.provider!=="mock"&&job.provider_job_id&&!['provider_invoice','manual_reconciliation'].includes(String(metadata.cost_source)))store.register({id:job.id,seriesId:job.series_id,seriesDbPath:path,provider:job.provider,state:job.status as 'completed'|'failed'|'cancelled',remoteId:job.provider_job_id,billingSettled:false});
                    continue;
                }
                if (!["reserved", "submitting", "submitted", "running", "uncertain_timeout"].includes(job.status))continue;
                store.register({ id: job.id, seriesId: job.series_id, seriesDbPath: path, provider: job.provider, state: job.status === "uncertain_timeout" ? "uncertain" : job.status as "reserved" | "submitting" | "submitted" | "running", remoteId: job.provider_job_id, parentJobId: metadata.parent_job_id as string | undefined, groupId: metadata.attempt_group_id as string | undefined, spec: metadata.execution_spec as Record<string, unknown> | undefined, destinationPath: job.output_local_path ?? metadata.destination_path as string | undefined });
                // A terminal remote update may have committed before the ledger/media update.
                // Keep this attempt visible to reconciliation without reacquiring a live slot.
                const dispatch = store.get(job.id)!;
                if (["completed", "failed", "cancelled"].includes(dispatch.state))
                    store.update(job.id, { state: "uncertain", remoteTerminal: true }, true);
                if (job.provider_job_id || ["submitting", "uncertain_timeout"].includes(job.status))
                    store.recoverSlot(store.get(job.id)!);
            }
        }
        finally {
            bible.close();
        }
    }
}
/** Reconciliation is independent of the parent job's cancellation or completion. */
export async function reconcileProviderAttempts(store: ProviderDispatchStore, owner: string, options: {
    gateway?: VideoModelGateway;
    pollTimeoutMs?: number;
} = {}): Promise<void> {
    let invoiceCursor:string|undefined;
    while(true){const events=store.pendingInvoices(100,invoiceCursor);if(!events.length)break;invoiceCursor=events.at(-1)!.id;
    for (const event of events) {
        if(event.attempt.seriesDbPath===':memory:')continue;
        const bible=new SqliteStoryStore(event.attempt.seriesDbPath);
        try{
            const lease=bible.claim(event.attempt.id,owner);if(!lease)continue;
            try{bible.withLease(lease,()=>{
                if(bible.invoiceReceipt(event.id))return;
                const job=bible.getProviderJob(event.attempt.id);if(!job)throw new Error('INVOICE_ATTEMPT_MISSING');
                const amount=event.status.invoicedCostUsd!;const meta=JSON.parse(job.metadata_json??'{}');
                const executionStatus=job.status;
                if(meta.invoice_conflict===true||meta.cost_source==='provider_invoice'&&job.confirmed_cost_usd!==amount){
                    job.metadata_json=JSON.stringify({...meta,invoice_conflict:true});job.cost_category='uncertain';job.uncertain_cost_usd=Math.max(amount,job.confirmed_cost_usd);job.confirmed_cost_usd=0;bible.createOrUpdateProviderJob(job);
                    bible.audit(job.id,{action:'invoice_conflict',amount});
                }else{const ledger=new BudgetLedger(bible);if(job.status==='failed')ledger.markFailed(job.id,{isBillableFailure:true,actualCostUsd:amount,errorMessage:job.error_message??"Provider failed"});else {ledger.markConfirmed(job.id,amount,{isInvoiced:true,metadata:{cost_source:'provider_invoice'}});const updated=bible.getProviderJob(job.id)!;updated.status=executionStatus;bible.createOrUpdateProviderJob(updated);}}
                bible.putInvoiceReceipt(event.id,job.id,JSON.stringify({amount}));
            });store.acknowledgeInvoice(event.id);store.update(event.attempt.id,{billingSettled:true});}finally{bible.release(lease);}
        }finally{bible.close();}
    }
    }
    let attemptCursor:string|undefined;
    while(true){const attempts=store.reconciliationCandidates(100,attemptCursor);if(!attempts.length)break;attemptCursor=attempts.at(-1)!.id;
    for (const attempt of attempts) {
        if (attempt.seriesDbPath === ":memory:")
            continue;
        const bible = new SqliteStoryStore(attempt.seriesDbPath);
        try {
            let job = bible.getProviderJob(attempt.id);
            if (!job)
                continue;
            if (job.status === "reserved") {
                const group = attempt.groupId ? bible.getGroup(attempt.groupId) : null;
                if (group?.winnerId && group.winnerId !== job.id || attempt.parentJobId && store.parentCancelled(attempt.parentJobId)) {
                    const repository = bible, lease = repository.claim(job.id, owner);
                    if (!lease)
                        continue;
                    try {
                        repository.withLease(lease, () => new BudgetLedger(bible).markFailed(job!.id, { errorCode: "NOT_SUBMITTED", errorMessage: "Parent cancelled or winner selected before submit", isBillableFailure: false }));
                        store.update(job.id, { state: "cancelled" }, true);
                    }
                    finally {
                        repository.release(lease);
                    }
                }
                continue;
            }
            if (job.status === "completed" || job.status === "failed" || job.status === "cancelled") {
                const meta=JSON.parse(job.metadata_json??'{}');
                if(job.provider==='mock'||meta.cost_source==='provider_invoice'||meta.cost_source==='manual_reconciliation')store.update(attempt.id,{billingSettled:true});
                else if(job.provider_job_id){
                    const gateway=options.gateway??createDefaultVideoGateway(),adapter=gateway.getAdapter(job.provider as import('../contracts/video.js').BackendProvider);
                    const saved=store.webhook(job.provider,job.provider_job_id);
                    if(saved?.invoicedCostUsd!==undefined)store.receiveWebhook(job.provider,saved);
                    else if(adapter)try{const status=await withProviderRequestContext(store,job.provider,'poll',()=>withDeadline(adapter.pollStatus(job!.provider_job_id!),options.pollTimeoutMs??5000),AbortSignal.timeout(options.pollTimeoutMs??5000));store.receiveWebhook(job.provider,status);}catch(error){log.warn('[INVOICE RECOVERY] '+attempt.id);}
                }
                store.update(attempt.id, { state: job.status }, true);
                continue;
            }
            if (!job.provider_job_id && !attempt.remoteId)
                continue;
            if (!job.provider_job_id && attempt.remoteId) {
                const lease = bible.claim(job.id, owner);
                if (!lease)
                    continue;
                try {
                    bible.withLease(lease, () => bible.createOrUpdateProviderJob({ ...job!, provider_job_id: attempt.remoteId }));
                }
                finally {
                    bible.release(lease);
                }
                job = bible.getProviderJob(job.id)!;
            }
            const spec = (attempt.spec ?? JSON.parse(job.metadata_json ?? "{}").execution_spec) as ShotExecutionSpec | undefined;
            if (!spec)
                continue;
            const dispatcher = new ProviderDispatcher(bible, options.gateway ?? createDefaultVideoGateway(), store, { workerId: owner, pollIntervalMs: 500, pollTimeoutMs: options.pollTimeoutMs ?? 5000, submitTimeoutMs: 30000 });
            try {
                await dispatcher.execute(job, spec, attempt.destinationPath);
            }
            catch(error) {log.warn("[DISPATCH RECOVERY] "+attempt.id+": "+String(error));}
        }
        finally {
            bible.close();
        }
    }
    }
}
