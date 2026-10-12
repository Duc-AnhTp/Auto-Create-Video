import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { mkdirSync } from "node:fs";
import { resolveImageToDataUriOrUrl } from "./asset-resolver.js";

describe("reference image file URLs", () => {
    let directory: string;
    beforeAll(async () => {
        mkdirSync(resolve("output/test-assets"), { recursive: true });
        directory = await mkdtemp(resolve("output/test-assets/file-url-"));
    });
    afterAll(async () => { await rm(directory, { recursive: true, force: true }); });
    it("decodes file URLs with spaces, Unicode and escaped punctuation", async () => {
        const image = join(directory, "ảnh #1 %.png"), bytes = Buffer.from([1, 2, 3, 4]);
        await writeFile(image, bytes);
        const expected = "data:image/png;base64," + bytes.toString("base64");
        expect(await resolveImageToDataUriOrUrl(pathToFileURL(image).href)).toBe(expected);
        expect(await resolveImageToDataUriOrUrl(image)).toBe(expected);
    });
    it("reports a missing local file instead of forwarding its URL", async () => {
        await expect(resolveImageToDataUriOrUrl(pathToFileURL(join(directory, "missing.jpg")).href)).rejects.toThrow("không tồn tại");
    });
    it("leaves remote URLs and data URIs intact", async () => {
        for (const value of ["https://example.test/face.png", "data:image/png;base64,AQ=="]) expect(await resolveImageToDataUriOrUrl(value)).toBe(value);
    });
});
