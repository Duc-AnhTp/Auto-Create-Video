import { describe, it, expect } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { JobStore } from "./job-store.js";
import { ProductionRequestSchema } from "./studio-contract.js";

const input = () => ProductionRequestSchema.parse({ seriesId: "pilot", episodeNumber: 1, rawScreenplay: "TẬP 1: Test" });
describe("Durable Studio jobs", () => {
  it("recovers an expired worker with resume without two workers claiming the same episode", () => {
    const dir = mkdtempSync(join(tmpdir(), "studio-queue-")), path = join(dir,"queue.db");
    const first = new JobStore(path), second = new JobStore(path);
    try {
      const job = first.enqueue(input());
      expect(first.claim("one", 1000)?.id).toBe(job.id);
      expect(second.claim("two", 2000)).toBeNull();
      expect(second.claim("two", 31001)?.request.resume).toBe(true);
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
});
