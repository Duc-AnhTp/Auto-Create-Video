import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({
    getSeriesMetadata: vi.fn(), listCharacters: vi.fn(), dispose: vi.fn(), open: vi.fn(),
}));
vi.mock("../../bootstrap/cli-session.js", () => ({ openCliSeries: state.open }));
vi.mock("../../modules/media/index.js", async (original) => ({ ...await original<typeof import("../../modules/media/index.js")>(), isFfmpegAvailable: async () => false, runFfmpeg: vi.fn(), runFfprobe: vi.fn() }));
vi.mock("axios", () => ({ default: { get: vi.fn().mockRejectedValue(new Error("offline")) } }));
import { runSeriesCli } from "./series.js";

describe("doctor database ownership", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        state.open.mockReturnValue({ store: { getSeriesMetadata: state.getSeriesMetadata, listCharacters: state.listCharacters }, dispose: state.dispose });
        state.getSeriesMetadata.mockReturnValue({ id: "fixture" });
        state.listCharacters.mockReturnValue([]);
        vi.spyOn(console, "log").mockImplementation(() => {});
    });
    afterEach(() => vi.restoreAllMocks());
    it.each([false, true])("uses the CLI connection and disposes it once (read failure: %s)", async (fails) => {
        if (fails) state.getSeriesMetadata.mockImplementationOnce(() => { throw new Error("DB unavailable"); });
        await runSeriesCli(["series:doctor", "--bible", ":memory:", "--series", "fixture"]);
        expect(state.open).toHaveBeenCalledExactlyOnceWith(":memory:");
        expect(state.getSeriesMetadata).toHaveBeenCalledExactlyOnceWith("fixture");
        expect(state.dispose).toHaveBeenCalledOnce();
    });
});
