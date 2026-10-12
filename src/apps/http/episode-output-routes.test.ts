import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import axios from "axios";
import { StudioServer } from "../../bootstrap/studio-server.js";
import { createTimelineFixture } from "../../__test-utils__/timeline-fixture.js";

describe("episode output consumers", () => {
    const id = "output-routes-" + randomUUID();
    const directory = resolve("output", "series", id, "ep-02");
    let server: StudioServer, base: string;
    const timeline = createTimelineFixture({ seriesId: id, episodeNumber: 2, targetTotalDurationSec: 3, targetTotalFrames: 72, videoTrack: [
        { shotId: "real_shot", sceneId: "scene_actual", durationSec: 3, durationFrames: 72, startFrame: 0, endFrame: 72, startSec: 0, endSec: 3, visualPrompt: "Real scene", shotType: "wide", trimStartSec: 0, approvedClipPath: join(directory, "real.mp4") },
    ] });
    beforeAll(async () => {
        await mkdir(join(directory, "assembly"), { recursive: true });
        await writeFile(join(directory, "assembly", "timeline.json"), JSON.stringify(timeline));
        server = new StudioServer({ port: 0, queuePath: ":memory:", workersEnabled: false });
        base = await server.start();
    });
    afterAll(async () => {
        await server.close();
        await rm(resolve("output", "series", id), { recursive: true, force: true });
    });
    it("exports and conforms a timeline from the production output directory", async () => {
        const exported = await axios.get(`${base}/api/v1/series/${id}/episodes/2/nle/export`);
        expect(exported.data.success).toBe(true);
        expect(exported.data.xmlContent).toContain("real_shot");
        expect(await readFile(join(directory, "nle_export", "ep2_davinci_resolve.xml"), "utf8")).toBe(exported.data.xmlContent);
        const conformed = await axios.post(`${base}/api/v1/series/${id}/episodes/2/nle/conform`, { xmlContent: exported.data.xmlContent, apply: false });
        expect(conformed.data.applied).toBe(false);
        expect(conformed.status).toBe(200);
    });
    it.each(["/api/v1", "/api"])("loads actual shots for lighting through %s", async (prefix) => {
        const response = await axios.post(`${base}${prefix}/series/${id}/scenes/scene_actual/lighting/harmonize`, { episodeNumber: 2 });
        expect(response.data.result.profiles.map((shot: { shotId: string }) => shot.shotId)).toEqual(["real_shot"]);
    });
    it("returns the contract error when no production timeline exists", async () => {
        const response = await axios.get(`${base}/api/v1/series/${id}/episodes/99/nle/export`, { validateStatus: () => true });
        expect(response.status).toBe(404);
        expect(response.data.error.code).toBe("TIMELINE_REQUIRED");
    });
});
