import { WorkflowError } from "../../../../platform/workflow-error.js";
import { AsyncLocalStorage } from "node:async_hooks";
import axios from "axios";
import type {DispatchCoordination} from '../../ports/runtime-services.js';

import { countRuntime } from "../../../../platform/observability/runtime-metrics.js";

interface RequestContext {checkpoint?:()=>Promise<void>;store:DispatchCoordination;provider:string;kind:"submit"|"poll";signal?:AbortSignal;requests:number}
const contexts=new AsyncLocalStorage<RequestContext>();
axios.interceptors?.request?.use(async config=>{
  if(process.env.OFFLINE_RUNTIME==="1"){const url=new URL(config.url??"",config.baseURL);if(!["localhost","127.0.0.1","[::1]"].includes(url.hostname))throw new WorkflowError("OFFLINE_NETWORK_BLOCKED", "OFFLINE_NETWORK_BLOCKED", "failed");}const context=contexts.getStore();if(context){await context.store.requestPermit(context.provider,context.kind,context.signal);await context.checkpoint?.();context.signal?.throwIfAborted();context.requests++;countRuntime("httpRequest");countRuntime("httpRequest:"+context.kind);config.signal??=context.signal;}return config;});
export function getProviderRequestContext():RequestContext|undefined{return contexts.getStore();}
export function withProviderRequestContext<T>(store:DispatchCoordination,provider:string,kind:"submit"|"poll",fn:()=>Promise<T>,signal?:AbortSignal,checkpoint?:()=>Promise<void>):Promise<T> {
  return contexts.run({store,provider,kind,signal,checkpoint,requests:0},fn);
}
