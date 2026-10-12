import { describe, expect, it, vi } from "vitest";
import { SqliteStoryStore } from "./sqlite-story-store.js";
import { VideoModelGateway } from "../modules/production/application/dispatch/video-gateway.js";
import {SeasonOrchestrator} from './season-runtime.js';
import {MultiEpisodeRunner} from './multi-episode-runtime.js';
import { EpisodeRuntime } from "./episode-runtime.js";

describe("episode runtime dependency ownership", () => {
  it("keeps an injected provider and leaves the caller's database open", async () => {
    const bible = new SqliteStoryStore(":memory:");
    const close = vi.spyOn(bible, "close");
    const submitJob = vi.fn().mockResolvedValue({ jobId: "injected" });
    const gateway = new VideoModelGateway({ pollIntervalMs: 1 });
    gateway.registerAdapter({
      providerName: "mock", submitJob,
      pollStatus: vi.fn().mockResolvedValue({ jobId: "injected", status: "completed", localPath: "fixture.mp4" }),
    });
    const runtime = new EpisodeRuntime(bible, { gateway });
    try {
      await gateway.executeShot({ shotId: "fixture", backend: "mock", durationSec: 1, prompt: "fixture" });
      expect(submitJob).toHaveBeenCalledOnce();
      runtime.close();
      expect(close).not.toHaveBeenCalled();
      expect(bible.getRevision()).toBeTypeOf("number");
    } finally { bible.close(); }
  });

  it("closes a database it created", () => {
    const runtime = new EpisodeRuntime(":memory:");
    const close = vi.spyOn(runtime.getBible(), "close");
    runtime.close();
    expect(close).toHaveBeenCalledOnce();
  });
  it.each([['season', (store:SqliteStoryStore)=>new SeasonOrchestrator(store)],['demo', (store:SqliteStoryStore)=>new MultiEpisodeRunner(store)]] as const)('does not close an injected store in the %s runtime',(_name,create)=>{const store=new SqliteStoryStore(':memory:'),close=vi.spyOn(store,'close');try{const runtime=create(store);runtime.close();expect(close).not.toHaveBeenCalled();expect(store.getRevision()).toBeTypeOf('number');}finally{store.close();}});
});
