import {it,expect,vi} from 'vitest';
import {reconcileCommand} from './reconcile.js';
import {SqliteStoryStore} from '../../../bootstrap/sqlite-story-store.js';
it('listing uncertain invoices never changes cost; mutation requires an explicit in-series job and action',async()=>{
 const bible=new SqliteStoryStore(':memory:'),output=vi.spyOn(console,'log').mockImplementation(()=>{});
 try{
  bible.createOrUpdateProviderJob({id:'attempt',series_id:'series',episode_number:1,shot_id:'shot',provider:'api_kling',spec_hash:'hash',status:'uncertain_timeout',cost_category:'uncertain',attempt_count:1,max_attempts:1,estimated_cost_usd:1,reserved_cost_usd:0,uncertain_cost_usd:1,confirmed_cost_usd:0,is_retryable:false});
  const run=(subArgs:string[],seriesId='series')=>reconcileCommand({bible,seriesId,subArgs} as any);
  await run([]);expect(bible.getSeriesBudgetLedger('series').uncertainCostUsd).toBe(1);
  await expect(run(['--job','attempt','--action','typo'])).rejects.toThrow('RECONCILIATION_ACTION_INVALID');
  await expect(run(['--job','attempt','--action','confirm'])).rejects.toThrow('RECONCILIATION_AMOUNT_REQUIRED');
  await expect(run(['--job','attempt','--action','discard'],'other')).rejects.toThrow('RECONCILIATION_JOB_NOT_IN_SERIES');
  await run(['--job','attempt','--action','confirm','--cost','0']);expect(bible.getSeriesBudgetLedger('series').uncertainCostUsd).toBe(0);expect(bible.getProviderJob('attempt')?.confirmed_cost_usd).toBe(0);expect(JSON.parse(bible.getProviderJob('attempt')!.metadata_json!).cost_source).toBe('manual_reconciliation');
 }finally{output.mockRestore();bible.close();}
});
