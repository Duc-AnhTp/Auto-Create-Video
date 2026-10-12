import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
vi.mock("../src/bootstrap/config.js", () => ({ loadConfig: () => ({ ttsProvider: "lucylab" }) }));
vi.mock("../src/modules/media/adapters/assets/audio-tools.js", () => ({
    getDurationSec: vi.fn().mockResolvedValue(2),
    concatWithSilence: vi.fn(async (_inputs: string[], _gap: number, output: string) => writeFile(output, "reused audio")),
    mixSfxOntoVoice: vi.fn(async (input: string, _sfx: unknown[], output: string) => writeFile(output, await readFile(input))), mixBgmWithDucking: vi.fn(),
}));
vi.mock("../src/modules/media/adapters/assets/sfx-selector.js", () => ({ indexSfxLibrary: () => [], pickSfxForScene: () => null, defaultPlayback: () => ({}) }));
vi.mock("../src/modules/media/adapters/render/hyperframes-runner.js", () => ({ renderWithHyperframes: vi.fn().mockResolvedValue(undefined) }));
import { rerenderExisting } from "../rerender.js";
import { renderWithHyperframes } from "../src/modules/media/adapters/render/hyperframes-runner.js";

describe("existing composition rerender", () => {
    let directory: string;
    beforeAll(async () => {
        await mkdir(resolve("output/test-rerender"), { recursive: true });
        directory = await mkdtemp(resolve("output/test-rerender/case-"));
        await mkdir(join(directory, "voice"));
        const script = JSON.parse(await readFile(resolve("tests/fixtures/sample-script-no-image.json"), "utf8"));
        for (const scene of script.scenes) await writeFile(join(directory, "voice", `scene-${scene.id}.mp3`), "existing scene voice");
        await writeFile(join(directory, "script.json"), JSON.stringify(script));
    });
    afterAll(async () => { await rm(directory, { recursive: true, force: true }); });
    it("copies the relocated render assets and reaches rendering with existing voices", async () => {
        await rerenderExisting(directory);
        for (const file of ["styles.css", "animations.js"]) expect(await readFile(join(directory, file), "utf8")).toBe(await readFile(resolve("src/modules/media/adapters/render/templates", file), "utf8"));
        expect(await readFile(join(directory, "voice", "scene-hook.mp3"), "utf8")).toBe("existing scene voice");
        expect(await readFile(join(directory, "index.html"), "utf8")).toContain("voice.mp3");
        expect(renderWithHyperframes).toHaveBeenCalledExactlyOnceWith({ compositionDir: directory, durationSec: 14.5, outputPath: join(directory, "video.mp4") });
    });
});
