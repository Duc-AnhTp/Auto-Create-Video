import {describe,it,expect} from "vitest";
import {ScopedRequests,StaleResponse} from "./scoped-requests.js";
const deferred=<T>()=>{let resolve!:(value:T)=>void,reject!:(error:Error)=>void;const promise=new Promise<T>((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
describe("Studio request ownership",()=>{
  it("a slow A response cannot overwrite fast B after changing series/episode/branch",async()=>{const requests=new ScopedRequests();requests.setScope("A:1:canon");const slow=deferred<string>(),a=requests.load("A:1:canon","takes",()=>slow.promise);const handled=a.catch(error=>error);requests.setScope("B:2:fork");expect(await requests.load("B:2:fork","takes",async()=>"B")).toBe("B");slow.resolve("A");expect(await handled).toBeInstanceOf(StaleResponse);});
  it("a late catch cannot clear the newer selection",async()=>{const requests=new ScopedRequests();requests.setScope("A");const slow=deferred<string>(),a=requests.load("A","graph",()=>slow.promise).catch(error=>error);expect(await requests.load("A","graph",async()=>"new graph")).toBe("new graph");slow.reject(new Error("old failure"));expect(await a).toBeInstanceOf(StaleResponse);});
  it("scope changes and unsubscribe abort the in-flight loader",async()=>{const requests=new ScopedRequests();requests.setScope("A");let signal!:AbortSignal;const slow=deferred<string>(),a=requests.load("A","draft",value=>{signal=value;return slow.promise;}).catch(error=>error);requests.dispose();expect(signal.aborted).toBe(true);slow.resolve("stale");expect(await a).toBeInstanceOf(StaleResponse);});
});
