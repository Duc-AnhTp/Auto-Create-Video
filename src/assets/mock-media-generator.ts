import { writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";

function runCmd(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args);
    let out = "", err = "";
    proc.stdout.on("data", (d) => (out += d.toString()));
    proc.stderr.on("data", (d) => (err += d.toString()));
    proc.on("close", (code) => {
      if (code === 0) resolve(out);
      else reject(new Error(`${cmd} exited with code ${code}: ${err}`));
    });
    proc.on("error", reject);
  });
}

let ffmpegCheckCache: boolean | null = null;
export async function hasFfmpeg(): Promise<boolean> {
  if (ffmpegCheckCache !== null) return ffmpegCheckCache;
  try {
    await runCmd("ffmpeg", ["-version"]);
    ffmpegCheckCache = true;
  } catch {
    ffmpegCheckCache = false;
  }
  return ffmpegCheckCache;
}

/**
 * Builds an MP4 box: [4 bytes big-endian length][4 bytes type][payload]
 */
function box(type: string, ...payloads: (Buffer | number[])[]): Buffer {
  const payloadBuf = Buffer.concat(payloads.map((p) => (Buffer.isBuffer(p) ? p : Buffer.from(p))));
  const len = payloadBuf.length + 8;
  const header = Buffer.alloc(8);
  header.writeUInt32BE(len, 0);
  header.write(type, 4, 4, "ascii");
  return Buffer.concat([header, payloadBuf]);
}

function fullBox(type: string, version: number, flags: number, ...payloads: (Buffer | number[])[]): Buffer {
  const vf = Buffer.alloc(4);
  vf.writeUInt8(version, 0);
  vf.writeUIntBE(flags, 1, 3);
  return box(type, vf, ...payloads);
}

/**
 * Generates a valid MPEG-1 Layer 3 silent audio stream.
 * Standard frame at 128 kbps, 44.1 kHz = 417 bytes, 1152 samples (~26.12 ms).
 */
export function generateValidMockMp3(durationSec: number): Buffer {
  const targetDur = Math.max(0.1, durationSec);
  const frameDuration = 1152 / 44100; // ~0.026122 sec
  const frameCount = Math.max(1, Math.ceil(targetDur / frameDuration));
  const frameSize = 417;

  const frame = Buffer.alloc(frameSize, 0);
  // MPEG-1 Layer 3, 128 kbps, 44100 Hz, Joint Stereo, no CRC: 0xFF, 0xFB, 0x90, 0x64
  frame[0] = 0xff;
  frame[1] = 0xfb;
  frame[2] = 0x90;
  frame[3] = 0x64;

  const total = Buffer.alloc(frameCount * frameSize);
  for (let i = 0; i < frameCount; i++) {
    frame.copy(total, i * frameSize);
  }
  return total;
}

/**
 * Generates a structurally valid MP4 container (ISO Base Media File / QuickTime).
 */
export function generateValidMockMp4(durationSec: number, width = 720, height = 1280): Buffer {
  const durMs = Math.max(100, Math.round(durationSec * 1000));

  // 1. ftyp box
  const ftyp = box("ftyp", Buffer.from("isom"), [0, 0, 2, 0], Buffer.from("isomiso2mp41"));

  // 2. mvhd (Movie Header)
  const mvhd = fullBox(
    "mvhd",
    0,
    0,
    [0, 0, 0, 0], // creation time
    [0, 0, 0, 0], // modification time
    [0, 0, 3, 0xe8], // timescale = 1000
    [
      (durMs >> 24) & 0xff,
      (durMs >> 16) & 0xff,
      (durMs >> 8) & 0xff,
      durMs & 0xff,
    ],
    [0, 1, 0, 0], // rate = 1.0
    [1, 0], // volume = 1.0
    Buffer.alloc(10, 0), // reserved
    // Unity matrix (36 bytes)
    [
      0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
      0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0,
      0, 0, 0, 0, 0, 0, 0, 0, 0x40, 0, 0, 0,
    ],
    Buffer.alloc(24, 0), // pre-defined
    [0, 0, 0, 2] // next track ID = 2
  );

  // 3. tkhd (Track Header)
  const tkhd = fullBox(
    "tkhd",
    0,
    3, // enabled + in movie
    [0, 0, 0, 0], // creation
    [0, 0, 0, 0], // mod
    [0, 0, 0, 1], // track ID = 1
    [0, 0, 0, 0], // reserved
    [
      (durMs >> 24) & 0xff,
      (durMs >> 16) & 0xff,
      (durMs >> 8) & 0xff,
      durMs & 0xff,
    ],
    Buffer.alloc(8, 0), // reserved
    [0, 0], // layer
    [0, 0], // alternate group
    [0, 0], // volume
    [0, 0], // reserved
    // Matrix
    [
      0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
      0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0,
      0, 0, 0, 0, 0, 0, 0, 0, 0x40, 0, 0, 0,
    ],
    [(width >> 8) & 0xff, width & 0xff, 0, 0], // width (fixed point 16.16)
    [(height >> 8) & 0xff, height & 0xff, 0, 0] // height (fixed point 16.16)
  );

  // 4. mdhd (Media Header)
  const mdhd = fullBox(
    "mdhd",
    0,
    0,
    [0, 0, 0, 0],
    [0, 0, 0, 0],
    [0, 0, 3, 0xe8], // timescale = 1000
    [
      (durMs >> 24) & 0xff,
      (durMs >> 16) & 0xff,
      (durMs >> 8) & 0xff,
      durMs & 0xff,
    ],
    [0x55, 0xc4], // language: und
    [0, 0]
  );

  // 5. hdlr (Handler)
  const hdlr = fullBox(
    "hdlr",
    0,
    0,
    [0, 0, 0, 0],
    Buffer.from("vide"),
    Buffer.alloc(12, 0),
    Buffer.from("VideoHandler\0")
  );

  // 6. vmhd (Video Media Header)
  const vmhd = fullBox("vmhd", 0, 1, [0, 0], [0, 0, 0, 0, 0, 0]);

  // 7. dinf -> dref -> url
  const urlBox = fullBox("url ", 0, 1);
  const dref = fullBox("dref", 0, 0, [0, 0, 0, 1], urlBox);
  const dinf = box("dinf", dref);

  // 8. stbl (Sample Table) with minimal valid structures
  const avc1 = box("avc1", Buffer.alloc(78, 0));
  const stsd = fullBox("stsd", 0, 0, [0, 0, 0, 1], avc1);
  const stts = fullBox("stts", 0, 0, [0, 0, 0, 0]);
  const stsc = fullBox("stsc", 0, 0, [0, 0, 0, 0]);
  const stsz = fullBox("stsz", 0, 0, [0, 0, 0, 0], [0, 0, 0, 0]);
  const stco = fullBox("stco", 0, 0, [0, 0, 0, 0]);

  const stbl = box("stbl", stsd, stts, stsc, stsz, stco);
  const minf = box("minf", vmhd, dinf, stbl);
  const mdia = box("mdia", mdhd, hdlr, minf);
  const trak = box("trak", tkhd, mdia);
  const moov = box("moov", mvhd, trak);
  const mdat = box("mdat", Buffer.alloc(Math.max(1024, Math.round(durMs * 2))));

  return Buffer.concat([ftyp, moov, mdat]);
}

/**
 * Creates a valid mock MP3 file either via ffmpeg (if available) or binary synthesis.
 */
export async function createValidMockMp3File(outPath: string, durationSec: number): Promise<void> {
  const available = await hasFfmpeg();
  if (available) {
    try {
      await runCmd("ffmpeg", [
        "-y",
        "-f", "lavfi",
        "-i", "anullsrc=r=44100:cl=mono",
        "-t", String(Math.max(0.1, durationSec)),
        "-c:a", "libmp3lame",
        "-b:a", "128k",
        outPath,
      ]);
      return;
    } catch {
      // Fallback to binary generation below
    }
  }

  const buf = generateValidMockMp3(durationSec);
  await writeFile(outPath, buf);
}

/**
 * Creates a valid mock MP4 file either via ffmpeg (if available) or binary ISO BMFF synthesis.
 */
export async function createValidMockMp4File(
  outPath: string,
  durationSec: number,
  width = 720,
  height = 1280
): Promise<void> {
  const available = await hasFfmpeg();
  if (available) {
    try {
      await runCmd("ffmpeg", [
        "-y",
        "-f", "lavfi",
        "-i", `color=c=black:s=${width}x${height}:r=30`,
        "-t", String(Math.max(0.1, durationSec)),
        "-c:v", "libx264",
        "-pix_fmt", "yuv420p",
        outPath,
      ]);
      return;
    } catch {
      // Fallback to binary generation below
    }
  }

  const buf = generateValidMockMp4(durationSec, width, height);
  await writeFile(outPath, buf);
}

export const generateValidMp4Buffer = generateValidMockMp4;
export const generateValidMp3Buffer = generateValidMockMp3;

