import { describe, expect, it, vi } from "vitest";
import { subscribeJobs } from "./job-events.js";
import { ProductionRequestSchema } from '../../../src/contracts/studio.js';

describe("scoped job subscriptions", () => {
  it('accepts a redacted episode snapshot without weakening submission validation',()=>{
    const source=new EventTarget(),onSnapshot=vi.fn(),onError=vi.fn();
    const stop=subscribeJobs({seriesId:'active',episode:1,active:()=>true,onSnapshot,onJob:vi.fn(),onError},()=>({addEventListener:source.addEventListener.bind(source),close:vi.fn()}));
    const request={seriesId:'active',episodeNumber:1,kind:'episode',rawScreenplay:'',provider:'mock',mode:'mock'};
    source.dispatchEvent(new MessageEvent('snapshot',{data:JSON.stringify({jobs:[{id:'redacted',request,status:'running',control:'run',progress:null,result:null,error:null,createdAt:'now',updatedAt:'now'}]})}));
    expect(onSnapshot).toHaveBeenCalledWith([expect.objectContaining({id:'redacted'})]);expect(onError).not.toHaveBeenCalled();
    expect(ProductionRequestSchema.safeParse(request).success).toBe(false);stop();
  });
  it("ignores another project's jobs and all events after cleanup", () => {
    const source = new EventTarget();
    const close = vi.fn(), onJob = vi.fn(), onError = vi.fn();
    const stop = subscribeJobs({ seriesId: "active", episode: 1, active: () => true, onSnapshot: vi.fn(), onJob, onError }, () => ({ addEventListener: source.addEventListener.bind(source), close }));
    const job = (seriesId: string) => ({ id: "fixture", request: { seriesId, episodeNumber: 1, rawScreenplay: "fixture" }, status: "running", control: "run", progress: null, result: null, error: null, createdAt: "now", updatedAt: "now" });
    source.dispatchEvent(new MessageEvent("job", { data: JSON.stringify(job("other")) }));
    expect(onJob).not.toHaveBeenCalled();
    source.dispatchEvent(new MessageEvent("job", { data: JSON.stringify(job("active")) }));
    expect(onJob).toHaveBeenCalledOnce();
    stop();
    source.dispatchEvent(new MessageEvent("job", { data: JSON.stringify(job("active")) }));
    expect(onJob).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();
    expect(onError).not.toHaveBeenCalled();
  });

  it("reports malformed events only while the scope is current", () => {
    const source = new EventTarget();
    let current = true;
    const onError = vi.fn();
    const stop = subscribeJobs({ seriesId: "active", episode: 1, active: () => current, onSnapshot: vi.fn(), onJob: vi.fn(), onError }, () => ({ addEventListener: source.addEventListener.bind(source), close: vi.fn() }));
    source.dispatchEvent(new MessageEvent("snapshot", { data: "invalid JSON" }));
    expect(onError).toHaveBeenCalledOnce();
    current = false;
    source.dispatchEvent(new MessageEvent("snapshot", { data: "invalid JSON" }));
    expect(onError).toHaveBeenCalledOnce();
    stop();
  });
});
