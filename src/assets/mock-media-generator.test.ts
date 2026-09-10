import { describe, it, expect, afterEach } from "vitest";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { readFile, rm } from "node:fs/promises";
import {
  generateValidMockMp3,
  generateValidMockMp4,
  createValidMockMp3File,
  createValidMockMp4File,
} from "./mock-media-generator.js";

describe("MockMediaGenerator (Container/Codec Compliant Mock Media)", () => {
  const tmpFiles: string[] = [];

  afterEach(async () => {
    for (const f of tmpFiles) {
      await rm(f, { force: true });
    }
  });

  it("generates valid MPEG-1 Layer 3 binary frames with exact sync words", () => {
    const buf = generateValidMockMp3(2.0);
    expect(buf.length).toBeGreaterThan(1000);
    // MPEG-1 Layer 3 Sync header
    expect(buf[0]).toBe(0xff);
    expect(buf[1]).toBe(0xfb);
    expect(buf[2]).toBe(0x90);
    expect(buf[3]).toBe(0x64);
  });

  it("generates valid ISO BMFF MP4 container with standard ftyp and moov atoms", () => {
    const buf = generateValidMockMp4(3.0, 720, 1280);
    expect(buf.length).toBeGreaterThan(400);

    // Box 1: ftyp
    const ftypSize = buf.readUInt32BE(0);
    const ftypType = buf.toString("ascii", 4, 8);
    expect(ftypType).toBe("ftyp");
    expect(ftypSize).toBeGreaterThan(16);

    // Box 2: moov
    const moovOffset = ftypSize;
    const moovType = buf.toString("ascii", moovOffset + 4, moovOffset + 8);
    expect(moovType).toBe("moov");

    // Check embedded string for ISO brand
    const str = buf.toString("ascii");
    expect(str).toContain("isom");
    expect(str).toContain("vide");
    expect(str).toContain("VideoHandler");
  });

  it("writes valid mock MP3 file to disk", async () => {
    const p = join(tmpdir(), `test-mock-${Date.now()}.mp3`);
    tmpFiles.push(p);

    await createValidMockMp3File(p, 1.5);
    const diskBuf = await readFile(p);
    expect(diskBuf.length).toBeGreaterThan(500);
    expect(diskBuf[0]).toBe(0xff);
    expect(diskBuf[1]).toBe(0xfb);
  });

  it("writes valid mock MP4 file to disk", async () => {
    const p = join(tmpdir(), `test-mock-${Date.now()}.mp4`);
    tmpFiles.push(p);

    await createValidMockMp4File(p, 2.5);
    const diskBuf = await readFile(p);
    expect(diskBuf.length).toBeGreaterThan(300);
    expect(diskBuf.toString("ascii", 4, 8)).toBe("ftyp");
  });
});
