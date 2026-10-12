import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, request } from "./client.js";

afterEach(() => vi.unstubAllGlobals());
describe("API error contracts", () => {
    it.each([
        [{ error: "Episode is busy", code: "EPISODE_BUSY" }, "EPISODE_BUSY"],
        [{ error: { message: "Episode is busy", code: "EPISODE_BUSY" } }, "EPISODE_BUSY"],
        [{ error: "Episode is busy" }, "REQUEST_FAILED"],
    ])("preserves the message and available code for %j", (body, code) => {
        const error = new ApiError(409, body);
        expect(error.message).toBe("Episode is busy");
        expect(error.code).toBe(code);
        expect(error.status).toBe(409);
    });
    it("keeps a legacy HTTP error code through the fetch client", async () => {
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: "Not found", code: "TIMELINE_REQUIRED" }), { status: 404 })));
        await expect(request("/fixture")).rejects.toMatchObject({ status: 404, code: "TIMELINE_REQUIRED", message: "Not found" });
    });
});
