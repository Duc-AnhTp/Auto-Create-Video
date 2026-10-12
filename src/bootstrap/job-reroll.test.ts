import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { EpisodeRuntime } from "./episode-runtime.js";
import { SqliteStoryStore } from "./sqlite-story-store.js";
import { AudioAssembler } from "./audio-assembler.js";
import { executeProductionJob } from "./job-executor.js";
import { JobStore } from "../modules/production/adapters/sqlite/job-store.js";
import { ProviderDispatchStore } from "../modules/production/adapters/sqlite/provider-dispatch-store.js";
import { ProductionRequestSchema } from "../contracts/studio.js";
import { EpisodicScriptSchema } from "../contracts/episode.js";
import { FileCheckpointStore } from "../modules/production/adapters/filesystem/checkpoint-store.js";
import { MockVideoAdapter } from "../modules/production/adapters/providers/mock-adapter.js";
import { WorkflowError } from "../platform/workflow-error.js";

describe("queued shot reroll", () => {
    const id = "reroll-" + randomUUID(), directory = resolve("output", "series", id, "ep-01"), dbDir = resolve("data", "series", id);
    let queue: JobStore, dispatchStore: ProviderDispatchStore, bible: SqliteStoryStore;
    beforeAll(async () => {
        await mkdir(join(directory, "shots"), { recursive: true });
        await mkdir(dbDir, { recursive: true });
        bible = new SqliteStoryStore(join(dbDir, "story_bible.db"));
        bible.upsertSeriesMetadata({ id, title: "Reroll", fps: 30, aspect_ratio: "9:16" });
        const script = EpisodicScriptSchema.parse({ seriesId: id, episodeNumber: 1, title: "Reroll", logline: "Isolation", scenes: [{ sceneNumber: 1, locationId: "room", locationName: "Room", shots: ["sc01_sh01", "sc01_sh02"].map(shotId => ({ shotId, durationSec: 1, visualPrompt: "Original " + shotId, shotType: "wide" })) }] });
        await writeFile(join(directory, "script-normalized.json"), JSON.stringify(script));
        for (const name of ["video.mp4", "audio.wav", "timeline.json", "shots/sc01_sh01.mp4", "shots/sc01_sh02.mp4"]) await writeFile(join(directory, name), "original " + name);
        for (const shotId of ["sc01_sh01", "sc01_sh02"]) bible.recordShotTake({ id: shotId + "_old", series_id: id, episode_number: 1, shot_id: shotId, take_number: 1, provider: "mock", prompt: "Original", duration_sec: 1, local_path: join(directory, "shots", shotId + ".mp4"), is_approved: true, qa_status: "PASS" });
        queue = new JobStore(":memory:"); dispatchStore = new ProviderDispatchStore(":memory:");
    });
    afterAll(async () => {
        queue.close(); dispatchStore.close(); bible.close();
        await rm(resolve("output", "series", id), { recursive: true, force: true });
        await rm(dbDir, { recursive: true, force: true });
    });
    it("queues the selected shot and override, creates one pending take, and reuses it on retry", async () => {
        const unchanged = ["video.mp4", "audio.wav", "timeline.json", "script-normalized.json", "shots/sc01_sh01.mp4", "shots/sc01_sh02.mp4"];
        const before = await Promise.all(unchanged.map(name => readFile(join(directory, name))));
        const produce = vi.spyOn(EpisodeRuntime.prototype, "produceEpisode"), audio = vi.spyOn(AudioAssembler.prototype, "assembleEpisodeAudio");
        const submit = vi.spyOn(MockVideoAdapter.prototype, "submitJob");
        const save = vi.spyOn(FileCheckpointStore.prototype, "save").mockRejectedValueOnce(new WorkflowError("WORKER_LEASE_LOST"));
        try {
            const queued = queue.enqueue({ seriesId: id, rawScreenplay: "TẬP 1: REROLL", targetShotId: "sc01_sh02", promptOverride: "New camera angle", provider: "mock" });
            expect(queue.get(queued.id).request).toMatchObject({ targetShotId: "sc01_sh02", promptOverride: "New camera angle" });
            const job = queue.claim("test-owner")!;
            const context = { signal: new AbortController().signal, checkpoint: async () => {}, assertOwnership: () => { expect(queue.isOwner(job.id, "test-owner", job.leaseVersion!)).toBe(true); }, progress: vi.fn() };
            await expect(executeProductionJob(job, context, { dispatchStore })).rejects.toMatchObject({ code: "WORKER_LEASE_LOST" });
            expect(bible.listShotTakes(id, 1, "sc01_sh02")).toHaveLength(2);
            const first = await executeProductionJob(job, context, { dispatchStore });
            expect(first.ready).toBe(false);
            expect(first.result.reroll).toMatchObject({ shotId: "sc01_sh02", isApproved: false });
            expect(first.result.qaStatus).toBe("NEEDS_REVIEW");
            const takes = bible.listShotTakes(id, 1, "sc01_sh02");
            expect(takes).toHaveLength(2);
            expect(takes.find(take => take.id === first.result.reroll!.takeId)).toMatchObject({ prompt: "New camera angle", is_approved: false });
            expect(bible.getApprovedTakeForShot(id, 1, "sc01_sh02")?.id).toBe("sc01_sh02_old");
            expect(bible.listShotTakes(id, 1, "sc01_sh01")).toHaveLength(1);
            const second = await executeProductionJob(job, context, { dispatchStore });
            expect(second.result.reroll?.takeId).toBe(first.result.reroll?.takeId);
            expect(bible.listShotTakes(id, 1, "sc01_sh02")).toHaveLength(2);
            expect(submit).toHaveBeenCalledOnce();
            expect(await Promise.all(unchanged.map(name => readFile(join(directory, name))))).toEqual(before);
            expect(produce).not.toHaveBeenCalled(); expect(audio).not.toHaveBeenCalled();
            const artifact = bible.getArtifact(first.result.artifactIds![0]);
            expect(artifact).toMatchObject({ kind: "shot", approved: false });
            await writeFile(first.result.videoPath, "corrupted candidate");
            await expect(executeProductionJob(job, context, { dispatchStore })).rejects.toMatchObject({ code: "REROLL_MEDIA_CHANGED", disposition: "needs_review" });
            expect(submit).toHaveBeenCalledOnce();
        } finally { produce.mockRestore(); audio.mockRestore(); submit.mockRestore(); save.mockRestore(); }
    }, 30_000);
    it("submits again for a new reroll with the same prompt instead of reusing the previous take", async () => {
        const previous = queue.list()[0];
        queue.update(previous.id, "test-owner", {}, "needs_review");
        queue.control(previous.id, "cancel");
        const submit = vi.spyOn(MockVideoAdapter.prototype, "submitJob");
        const ids: string[] = [];
        try {
            for (let attempt = 0; attempt < 2; attempt++) {
                queue.enqueue({ seriesId: id, rawScreenplay: "TẬP 1: REROLL", targetShotId: "sc01_sh02", provider: "mock" });
                const job = queue.claim("test-owner")!;
                const context = { signal: new AbortController().signal, checkpoint: async () => {}, assertOwnership: () => { expect(queue.isOwner(job.id, "test-owner", job.leaseVersion!)).toBe(true); }, progress: vi.fn() };
                const result = await executeProductionJob(job, context, { dispatchStore });
                ids.push(result.result.reroll!.takeId);
                queue.update(job.id, "test-owner", { result: result.result }, "needs_review", job.leaseVersion);
                queue.control(job.id, "cancel");
            }
            expect(new Set(ids).size).toBe(2);
            expect(submit).toHaveBeenCalledTimes(2);
            expect(bible.getApprovedTakeForShot(id, 1, "sc01_sh02")?.id).toBe("sc01_sh02_old");
        } finally { submit.mockRestore(); }
    }, 30_000);
    it.each([
        { targetShotId: "../../outside" }, { promptOverride: "Orphan override" },
        { kind: "season", season: { toEpisode: 2 }, targetShotId: "sc01_sh01" },
        { mode: "production", targetShotId: "sc01_sh01", provider: "api_kling" },
    ])("rejects invalid or underfunded rerolls: %j", (extra) => {
        expect(ProductionRequestSchema.safeParse({ seriesId: id, rawScreenplay: "script", ...extra }).success).toBe(false);
    });
});
