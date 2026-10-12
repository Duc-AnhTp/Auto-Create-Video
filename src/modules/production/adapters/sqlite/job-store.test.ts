import { describe, it, expect } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { JobStore } from "./job-store.js";
import { ProductionRequestSchema } from "../../../../contracts/requests.js";

const input = () => ProductionRequestSchema.parse({ seriesId: "pilot", episodeNumber: 1, rawScreenplay: "TẬP 1: Test" });
describe("Durable Studio jobs", () => {
  it("recovers an expired worker with resume without two workers claiming the same episode", () => {
    const dir = mkdtempSync(join(tmpdir(), "studio-queue-")), path = join(dir,"queue.db");
    const first = new JobStore(path), second = new JobStore(path);
    try {
      const job = first.enqueue(input());
      const now=Date.now();
      expect(first.claim("one", now)?.id).toBe(job.id);
      expect(second.claim("two", now+1000)).toBeNull();
      expect(second.claim("two", now+30001)?.request.resume).toBe(true);
      expect(() => first.update(job.id,"one",{})).toThrow("WORKER_LEASE_LOST");
      second.update(job.id,"two",{},"succeeded");
      expect(first.get(job.id).status).toBe("succeeded");
    } finally { first.close(); second.close(); rmSync(dir,{recursive:true,force:true}); }
  });
  it("persists controls, blocks duplicate work, and does not release a running cancellation early", () => {
    const store = new JobStore(":memory:");
    try {
      const job = store.enqueue(input());
      expect(()=>store.enqueue(input())).toThrow("EPISODE_BUSY");
      expect(store.control(job.id,"pause").status).toBe("paused");
      expect(store.claim("worker")).toBeNull();
      store.control(job.id,"resume"); store.claim("worker");
      expect(store.control(job.id,"cancel").status).toBe("running");
      expect(store.get(job.id).control).toBe("cancel");
      store.update(job.id,"worker",{},"cancelled");
      expect(store.control(job.id,"retry").status).toBe("queued");
      expect(store.events(0).length).toBeGreaterThan(4);
    } finally { store.close(); }
  });
  it("requires a real budget and provider for production and enforces mock mode", () => {
    expect(()=>ProductionRequestSchema.parse({...input(),mode:"production"})).toThrow();
    const store = new JobStore(":memory:");
    try { expect(store.enqueue({...input(),provider:"api_kling"}).request.provider).toBe("mock"); }
    finally {store.close();}
  });
  it("rejects stale drafts and preserves revisions", () => {
    const store = new JobStore(":memory:");
    try {
      expect(store.saveDraft("pilot",1,0,"first").version).toBe(1);
      expect(()=>store.saveDraft("pilot",1,0,"stale")).toThrow("DRAFT_CONFLICT");
      expect(store.draft("pilot",1).text).toBe("first");
      expect(store.saveDraft("pilot",1,1,"second").version).toBe(2);
    } finally {store.close();}
  });
  it("enforces series-level lock on retry when a season job is active", () => {
    const store = new JobStore(":memory:");
    try {
      const ep2 = store.enqueue(ProductionRequestSchema.parse({ seriesId: "pilot", episodeNumber: 2, rawScreenplay: "TẬP 2: Ep2" }));
      store.control(ep2.id, "cancel");
      expect(store.get(ep2.id).status).toBe("cancelled");

      const seasonJob = store.enqueue(ProductionRequestSchema.parse({ seriesId: "pilot", episodeNumber: 1, kind: "season", season: { toEpisode: 2 }, rawScreenplay: "SEASON: Pilot" }));
      expect(seasonJob.status).toBe("queued");

      expect(() => store.control(ep2.id, "retry")).toThrow("SERIES_BUSY");
    } finally {
      store.close();
    }
  });
  it("queues story imports durably, holds the series lock, reclaims expired leases, and clears source text on completion", () => {
    const store = new JobStore(":memory:");
    try {
      const now=Date.now();
      const queued = store.enqueueStoryImport({ seriesId: "pilot", title: "Novel", text: "long source", episodes: 2 });
      expect(store.storyImportSummary(queued).request.text).toBe("");
      expect(() => store.enqueue(input())).toThrow("SERIES_BUSY");
      expect(() => store.enqueueStoryImport({ seriesId: "pilot", title: "Duplicate", text: "again", episodes: 1 })).toThrow("SERIES_BUSY");
      expect(store.claimStoryImport("worker-a", now)?.id).toBe(queued.id);
      expect(store.claimStoryImport("worker-b", now+1000)).toBeNull();
      expect(store.claimStoryImport("worker-b", now+30001)?.id).toBe(queued.id);
      expect(() => store.finishStoryImport(queued.id, "worker-a", { planId: "plan" })).toThrow("WORKER_LEASE_LOST");
      const completed = store.finishStoryImport(queued.id, "worker-b", { planId: "plan" });
      expect(completed.status).toBe("succeeded");
      expect(completed.request.text).toBe("");
      expect(store.getStoryImport(queued.id).request.text).toBe("");
    } finally {
      store.close();
    }
  });
  it("bounds retained event history and never serializes screenplay content into events", () => {
    const store = new JobStore(":memory:", { eventRetention: 10 });
    try {
      const job = store.enqueue({ ...input(), rawScreenplay: "private screenplay" });
      store.claim("worker");
      for (let i = 0; i < 126; i++) store.update(job.id, "worker", { progress: { step: i, total: 126, message: "working" } });
      const events = store.events(0);
      expect(events).toHaveLength(10);
      expect(events.every(event => event.job.request.rawScreenplay === "")).toBe(true);
    } finally {
      store.close();
    }
  });
  it("canon dependencies run in episode order while another series remains independent",()=>{
    const store=new JobStore(":memory:");try {
      const later=store.enqueue({...input(),episodeNumber:2,provider:"api_kling",mode:"production",budgetCapUsd:2});
      const earlier=store.enqueue({...input(),episodeNumber:1,provider:"api_kling",mode:"production",budgetCapUsd:2});
      const independent=store.enqueue({...input(),seriesId:"independent"});
      expect(store.claim("first")?.id).toBe(earlier.id);expect(store.claim("second")?.id).toBe(independent.id);
      store.update(earlier.id,"first",{},"needs_review");expect(store.claim("third")).toBeNull();
      store.control(earlier.id,"retry");expect(store.claim("first")?.id).toBe(earlier.id);store.update(earlier.id,"first",{},"succeeded");expect(store.claim("third")?.id).toBe(later.id);
    }finally{store.close();}
  });
});
