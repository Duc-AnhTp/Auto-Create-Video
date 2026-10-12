import {BudgetLedger} from '../../../modules/production/index.js';
import {getArgValue} from '../arguments.js';
import type {SeriesCommandContext} from './context.js';
export async function reconcileCommand({subArgs,seriesId,bible}:Pick<SeriesCommandContext,'subArgs'|'seriesId'|'bible'>):Promise<void>{
 const id=seriesId||'default-series',jobId=getArgValue(subArgs,'--job'),action=getArgValue(subArgs,'--action');
 if(!action){
  const pending=bible.listProviderJobs(id).filter(job=>job.status==='uncertain_timeout'||job.cost_category==='uncertain');
  console.log(JSON.stringify({seriesId:id,scope:'video_attempts_only',pending:pending.map(job=>({jobId:job.id,provider:job.provider,state:job.status,costCategory:job.cost_category}))}));
  console.log('Chỉ xem dữ liệu. Đối soát cần --job và --action; confirm/fail cần --cost rõ ràng.');return;
 }
 const actions:Record<string,'confirmed_success'|'confirmed_no_charge'|'confirmed_billed_failure'>={confirm:'confirmed_success',confirmed_success:'confirmed_success',discard:'confirmed_no_charge',confirmed_no_charge:'confirmed_no_charge',fail:'confirmed_billed_failure',confirmed_billed_failure:'confirmed_billed_failure'};
 if(!actions[action])throw new Error('RECONCILIATION_ACTION_INVALID');
 if(!jobId)throw new Error('RECONCILIATION_JOB_REQUIRED');
 const job=bible.getProviderJob(jobId);if(!job||job.series_id!==id)throw new Error('RECONCILIATION_JOB_NOT_IN_SERIES');
 const rawCost=getArgValue(subArgs,'--cost'),cost=rawCost!==undefined&&rawCost.trim()?Number(rawCost):undefined;
 if(rawCost!==undefined&&(!Number.isFinite(cost)||cost!<0))throw new Error('RECONCILIATION_AMOUNT_REQUIRED');
 const updated=new BudgetLedger(bible).reconcileUncertainJob(jobId,actions[action],{actualCostUsd:cost});
 console.log(JSON.stringify({jobId:updated.id,state:updated.status,costCategory:updated.cost_category,costSource:'manual_reconciliation',confirmedUsd:updated.confirmed_cost_usd}));
}
