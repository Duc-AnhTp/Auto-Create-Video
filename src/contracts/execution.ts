/** Cooperative execution controls; no service locator or workflow facade. */
export interface ExecutionContext {
 signal?:AbortSignal;
 checkpoint?:()=>Promise<void>;
 assertOwnership?:()=>void;
 onProgress?:(step:number,total:number,message:string)=>void;
}
