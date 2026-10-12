import { WorkflowError } from "../workflow-error.js";
export async function withDeadline<T>(work:Promise<T>,timeoutMs:number):Promise<T>{
  let timer:ReturnType<typeof setTimeout>|undefined;
  try{return await Promise.race([work,new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new WorkflowError("OPERATION_TIMEOUT", "OPERATION_TIMEOUT", "failed")),timeoutMs);})]);}
  finally{if(timer)clearTimeout(timer);}
}
