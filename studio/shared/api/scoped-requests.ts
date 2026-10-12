export class StaleResponse extends Error {constructor(){super("STALE_RESPONSE");}}
export class ScopedRequests {
  private scope="";
  private requests=new Map<string,{generation:number;controller:AbortController}>();
  setScope(scope:string):void{if(this.scope===scope)return;this.dispose();this.scope=scope;}
  current(scope:string):boolean{return scope===this.scope;}
  dispose():void{for(const request of this.requests.values())request.controller.abort();this.requests.clear();}
  async load<T>(scope:string,key:string,loader:(signal:AbortSignal)=>Promise<T>):Promise<T>{
    if(!this.current(scope))throw new StaleResponse();
    const previous=this.requests.get(key);previous?.controller.abort();
    const request={generation:(previous?.generation??0)+1,controller:new AbortController()};this.requests.set(key,request);
    try{const result=await loader(request.controller.signal);if(!this.current(scope)||this.requests.get(key)!==request||request.controller.signal.aborted)throw new StaleResponse();return result;}
    catch(error){if(!this.current(scope)||this.requests.get(key)!==request||request.controller.signal.aborted)throw new StaleResponse();throw error;}
  }
}
