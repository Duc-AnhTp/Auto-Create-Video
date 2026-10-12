import { AsyncLocalStorage } from "node:async_hooks";
import { monitorEventLoopDelay, performance } from "node:perf_hooks";
type Counters=Record<string,number>;
export interface RuntimeMetrics { elapsedMs:number;peakRssBytes:number;eventLoopLagP95Ms:number;counters:Counters;phases?:Array<{step:number;message:string;elapsedMs:number}> }
export class RuntimePhases {
  private started=performance.now();private active?:{step:number;message:string};private rows:NonNullable<RuntimeMetrics["phases"]>=[];
  progress(step:number,message:string):void {if(this.active?.step===step)return;this.flush();this.active={step,message};this.started=performance.now();}
  private flush():void {if(this.active)this.rows.push({...this.active,elapsedMs:performance.now()-this.started});}
  finish():NonNullable<RuntimeMetrics["phases"]>{this.flush();this.active=undefined;return [...this.rows];}
}
const contexts=new AsyncLocalStorage<Counters>();
const totals:Counters={};
export function countRuntime(name:string,value=1):void {totals[name]=(totals[name]??0)+value;const current=contexts.getStore();if(current)current[name]=(current[name]??0)+value;}
export function runtimeTotals():Counters{return {...totals};}
export async function measureRuntime<T>(work:()=>Promise<T>,onMetrics?:(metrics:RuntimeMetrics)=>void){
  const counters:Counters={},lag=monitorEventLoopDelay({resolution:10});lag.enable();const start=performance.now();let peakRss=process.memoryUsage().rss;
  const sample=setInterval(()=>{peakRss=Math.max(peakRss,process.memoryUsage().rss);},25);
  const metrics=():RuntimeMetrics=>({elapsedMs:performance.now()-start,peakRssBytes:Math.max(peakRss,process.memoryUsage().rss),eventLoopLagP95Ms:Number(lag.percentile(95))/1e6,counters});
  try {const value=await contexts.run(counters,work);return {value,metrics:metrics()};}
  finally{clearInterval(sample);lag.disable();onMetrics?.(metrics());}
}
