import {FileAudioGenerationStore} from '../adapters/filesystem/audio-generation-store.js';
import {createTimelineFixture} from '../../../__test-utils__/timeline-fixture.js';
import {createValidMockMp3File} from '../../media/adapters/assets/mock-media-generator.js';
import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { loadConfig } from "../../../bootstrap/config.js";
import { ProduceAudio } from "./produce-audio.js";
import { computeAudioFingerprint } from "./episode-fingerprints.js";
import { EpisodicScriptSchema, type EpisodeProductionJob } from "../../../contracts/episode.js";
import { SqliteStoryStore } from "../../../bootstrap/sqlite-story-store.js";
import { hashFile } from "../../media/index.js";

describe("audio resume timing", () => {
    let directory: string | undefined;
    afterEach(async () => { if (directory) await rm(directory, { recursive: true, force: true }); });
    it("restores both script and shot progress without regenerating audio or changing visual planning", async () => {
        await mkdir(resolve("output/test-audio-resume"), { recursive: true });
        directory = await mkdtemp(resolve("output/test-audio-resume/case-"));
        const script = EpisodicScriptSchema.parse({ seriesId: "resume", episodeNumber: 1, title: "Resume", logline: "Timing", scenes: [{ sceneNumber: 1, locationId: "room", locationName: "Room", shots: [{ shotId: "sc01_sh01", durationSec: 3, visualPrompt: "Room", shotType: "medium" }] }] });
        const audioPath = join(directory, "audio.wav");
        await createValidMockMp3File(audioPath,8);
        await writeFile(join(directory, "timeline.json"), JSON.stringify(createTimelineFixture({targetTotalDurationSec:8,targetTotalFrames:240,fps:30,videoTrack:[{shotId:"sc01_sh01",sceneId:"sc01",shotType:"medium",visualPrompt:"Room",startSec:0,endSec:8,durationSec:8,startFrame:0,endFrame:240,durationFrames:240,trimStartSec:0,trimEndSec:0,transitionIn:{type:"cut",durationSec:0,durationFrames:0}}]})));
        const cfg = loadConfig({ validateProvider: false });
        const job: EpisodeProductionJob = { jobId: "resume", seriesId: "resume", episodeNumber: 1, title: "Resume", status: "in_progress", currentPhase: "audio", shots: { sc01_sh01: { shotId: "sc01_sh01", durationSec: 3, status: "completed", retryCount: 0, allTakes: [] } }, totalCostUsd: 0, createdAt: "now", updatedAt: "now", audioPath, audioSha256: await hashFile(audioPath), audioFingerprint: computeAudioFingerprint(script, 0, { ...cfg, mockTts: true, resolvedVoicePlan: [] }) };
        const bible = new SqliteStoryStore(":memory:"), assembleEpisodeAudio = vi.fn(), save = vi.fn();
        try {
            const output = await new ProduceAudio({ bible, audioGenerations:new FileAudioGenerationStore(), audioAssembler: { getCfg: () => cfg, resolveVoicePlan:async()=>[], assembleEpisodeAudio }, checkpoints: { load: vi.fn(), save } }).execute({ script, job, outputDir: directory, mockTts: true, effectiveConfig: { transitionDurationSec: 0, fps: 30, aspectRatio: "9:16", overflowPolicy: "extend_shot", configHash: "fixture" } }, { seriesId: "resume", resume: true });
            expect(output.script.scenes[0].shots[0].durationSec).toBe(8);
            expect(output.job.shots.sc01_sh01.durationSec).toBe(8);
            expect(JSON.parse(await readFile(join(directory, "script-normalized.json"), "utf8")).scenes[0].shots[0].durationSec).toBe(8);
            expect(output.planningDurations.get("sc01_sh01")).toBe(3);
            expect(output.visualDurations.get("sc01_sh01")).toBe(3);
            expect(assembleEpisodeAudio).not.toHaveBeenCalled();
            expect(job.shots.sc01_sh01.durationSec).toBe(3);
        } finally { bible.close(); }
    });
});
