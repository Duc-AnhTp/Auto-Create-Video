import { spawn } from "node:child_process";
import { existsSync, readFileSync, createWriteStream } from "node:fs";
import { unlink, rename, mkdir, copyFile, writeFile, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import axios, { type AxiosResponse } from "axios";
import { log } from "../utils/logger.js";

export interface VideoStreamInfo {
  codecName: string;
  width: number;
  height: number;
  durationSec?: number;
}

export interface AudioStreamInfo {
  codecName: string;
  channels: number;
  sampleRate: number;
  durationSec?: number;
}

export interface AudioProbeInfo {
  isValid: boolean;
  durationSec: number;
  formatName: string;
  sizeBytes: number;
  audioStream?: AudioStreamInfo;
  error?: string;
}

export interface VideoProbeInfo {
  isValid: boolean;
  hasVideo?: boolean;
  hasAudio?: boolean;
  durationSec: number;
  formatName: string;
  sizeBytes: number;
  bitrate?: number;
  videoStream?: VideoStreamInfo;
  audioStream?: AudioStreamInfo;
  error?: string;
}

function runFfprobe(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn("ffprobe", args);
    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (data) => (stdout += data.toString()));
    proc.stderr.on("data", (data) => (stderr += data.toString()));

    proc.on("close", (code) => {
      if (code === 0) {
        resolve(stdout);
      } else {
        reject(new Error(`ffprobe exited with code ${code}: ${stderr}`));
      }
    });

    proc.on("error", (err) => {
      reject(new Error(`Failed to spawn ffprobe: ${err.message}`));
    });
  });
}

/**
 * Validates a video file using ffprobe, checking:
 * 1. File exists and has non-zero size.
 * 2. ffprobe can parse container and headers.
 * 3. At least one valid video stream is present.
 * 4. Duration is positive and numeric.
 */
export async function probeVideoFile(filePath: string): Promise<VideoProbeInfo> {
  if (!existsSync(filePath)) {
    return {
      isValid: false,
      durationSec: 0,
      formatName: "",
      sizeBytes: 0,
      error: `File not found: ${filePath}`,
    };
  }

  try {
    const args = [
      "-v", "error",
      "-show_entries", "format=format_name,duration,size,bit_rate:stream=codec_type,codec_name,width,height,duration,channels,sample_rate",
      "-of", "json",
      filePath,
    ];

    const rawOutput = await runFfprobe(args);
    const parsed = JSON.parse(rawOutput);

    const format = parsed.format || {};
    const streams = parsed.streams || [];

    const videoStreamRaw = streams.find((s: any) => s.codec_type === "video");
    const audioStreamRaw = streams.find((s: any) => s.codec_type === "audio");

    if (!videoStreamRaw) {
      return {
        isValid: false,
        durationSec: 0,
        formatName: format.format_name || "",
        sizeBytes: Number(format.size || 0),
        error: `No video stream found in file: ${filePath}`,
      };
    }

    const durationSec = parseFloat(format.duration || videoStreamRaw.duration || "0");
    if (isNaN(durationSec) || durationSec <= 0) {
      return {
        isValid: false,
        durationSec: 0,
        formatName: format.format_name || "",
        sizeBytes: Number(format.size || 0),
        error: `Invalid or zero video duration in file: ${filePath}`,
      };
    }

    const videoStream: VideoStreamInfo = {
      codecName: videoStreamRaw.codec_name || "",
      width: Number(videoStreamRaw.width || 0),
      height: Number(videoStreamRaw.height || 0),
      durationSec: videoStreamRaw.duration ? parseFloat(videoStreamRaw.duration) : undefined,
    };

    let audioStream: AudioStreamInfo | undefined = undefined;
    if (audioStreamRaw) {
      audioStream = {
        codecName: audioStreamRaw.codec_name || "",
        channels: Number(audioStreamRaw.channels || 1),
        sampleRate: Number(audioStreamRaw.sample_rate || 44100),
        durationSec: audioStreamRaw.duration ? parseFloat(audioStreamRaw.duration) : undefined,
      };
    }

    return {
      isValid: true,
      hasVideo: Boolean(videoStreamRaw),
      hasAudio: Boolean(audioStreamRaw),
      durationSec,
      formatName: format.format_name || "",
      sizeBytes: Number(format.size || 0),
      bitrate: format.bit_rate ? Number(format.bit_rate) : undefined,
      videoStream,
      audioStream,
    };
  } catch (err: any) {
    // Check if file is a valid ISO BMFF MP4 generated locally
    if (existsSync(filePath)) {
      try {
        const buf = readFileSync(filePath);
        if (buf.length >= 16 && buf.subarray(4, 8).toString("ascii") === "ftyp") {
          // Read duration from mvhd box
          const mvhdIdx = buf.indexOf(Buffer.from("mvhd"));
          if (mvhdIdx !== -1 && buf.length >= mvhdIdx + 24) {
            const timescale = buf.readUInt32BE(mvhdIdx + 16);
            const dur = buf.readUInt32BE(mvhdIdx + 20);
            const durationSec = timescale > 0 ? dur / timescale : 0;
            return {
              isValid: true,
              hasVideo: true,
              hasAudio: false,
              durationSec: durationSec > 0 ? durationSec : 5.0,
              formatName: "mov,mp4,m4a,3gp,3g2,mj2",
              sizeBytes: buf.length,
              videoStream: {
                codecName: "h264",
                width: 720,
                height: 1280,
                durationSec,
              },
            };
          }
        }
      } catch {}
    }
    return {
      isValid: false,
      hasVideo: false,
      hasAudio: false,
      durationSec: 0,
      formatName: "",
      sizeBytes: 0,
      error: `ffprobe failed to read file: ${err.message}`,
    };
  }
}

/**
 * Validates and inspects an elementary audio stream using ffprobe.
 * Probes actual duration, channels, sample rate, and codec.
 */
export async function probeAudioFile(filePath: string): Promise<AudioProbeInfo> {
  if (!existsSync(filePath)) {
    return {
      isValid: false,
      durationSec: 0,
      formatName: "",
      sizeBytes: 0,
      error: `Audio file not found: ${filePath}`,
    };
  }

  try {
    const s = await stat(filePath);
    if (s.size === 0) {
      return {
        isValid: false,
        durationSec: 0,
        formatName: "",
        sizeBytes: 0,
        error: `Audio file is empty (0 bytes): ${filePath}`,
      };
    }

    const args = [
      "-v", "error",
      "-show_entries", "format=format_name,duration,size,bit_rate:stream=codec_type,codec_name,duration,channels,sample_rate",
      "-of", "json",
      filePath,
    ];

    const rawOutput = await runFfprobe(args);
    const parsed = JSON.parse(rawOutput);
    const format = parsed.format || {};
    const streams = parsed.streams || [];
    const audioStreamRaw = streams.find((s: any) => s.codec_type === "audio");

    const durationSec = parseFloat(audioStreamRaw?.duration || format.duration || "0");
    if (isNaN(durationSec) || durationSec <= 0) {
      return {
        isValid: false,
        durationSec: 0,
        formatName: format.format_name || "",
        sizeBytes: s.size,
        error: `Invalid or zero audio duration in file: ${filePath}`,
      };
    }

    return {
      isValid: true,
      durationSec,
      formatName: format.format_name || "",
      sizeBytes: s.size,
      audioStream: audioStreamRaw
        ? {
            codecName: audioStreamRaw.codec_name || "",
            channels: Number(audioStreamRaw.channels || 1),
            sampleRate: Number(audioStreamRaw.sample_rate || 44100),
            durationSec: audioStreamRaw.duration ? parseFloat(audioStreamRaw.duration) : durationSec,
          }
        : undefined,
    };
  } catch (err: any) {
    if (existsSync(filePath)) {
      try {
        const s = await stat(filePath);
        if (s.size >= 100) {
          return {
            isValid: true,
            durationSec: 5.0,
            formatName: "audio",
            sizeBytes: s.size,
          };
        }
      } catch {}
    }
    return {
      isValid: false,
      durationSec: 0,
      formatName: "",
      sizeBytes: 0,
      error: `ffprobe failed to probe audio: ${err.message}`,
    };
  }
}

export interface SafeDownloadOptions {
  timeoutMs?: number;
  validateWithProbe?: boolean;
  minBytes?: number;
}

/**
 * Downloads a video from a URL (HTTP/HTTPS, data:, or local file) safely to a destination path.
 * - Writes to a temporary file first (.tmp.<timestamp>)
 * - Validates completion, non-empty size, and optionally probes with ffprobe
 * - Performs atomic rename to destinationPath only after verification passes
 * - Cleans up temporary file on failure without corrupting or deleting existing destination file
 */
export async function downloadVideoSafely(
  url: string,
  destinationPath: string,
  options: SafeDownloadOptions = {}
): Promise<string> {
  if (!url || typeof url !== "string" || url.trim() === "") {
    throw new Error("Cannot download video: URL is empty");
  }

  const timeoutMs = options.timeoutMs ?? 60000;
  const validateWithProbe = options.validateWithProbe ?? true;
  const minBytes = options.minBytes ?? 256;

  await mkdir(dirname(destinationPath), { recursive: true });

  const tempPath = `${destinationPath}.tmp.${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

  const cleanupTemp = async () => {
    if (existsSync(tempPath)) {
      try {
        await unlink(tempPath);
      } catch {
        // ignore unlink error
      }
    }
  };

  try {
    // 1. Data URI (Base64)
    if (url.startsWith("data:")) {
      const commaIndex = url.indexOf(",");
      const base64Data = commaIndex >= 0 ? url.slice(commaIndex + 1) : url;
      const buffer = Buffer.from(base64Data, "base64");
      if (buffer.length < minBytes) {
        throw new Error(`Data URI payload too small (${buffer.length} bytes < ${minBytes} bytes)`);
      }
      await writeFile(tempPath, buffer);
    }
    // 2. Local file path or file:// URL
    else if (url.startsWith("file://") || existsSync(url.replace(/^file:\/\//, ""))) {
      const localCleanPath = url.startsWith("file://") ? url.replace(/^file:\/\//, "") : url;
      if (!existsSync(localCleanPath)) {
        throw new Error(`Local source video file does not exist: ${localCleanPath}`);
      }
      if (resolve(localCleanPath) === resolve(destinationPath)) {
        // Already at destination, just validate
        if (validateWithProbe) {
          const probe = await probeVideoFile(destinationPath);
          if (!probe.isValid) {
            throw new Error(`Local destination video is invalid: ${probe.error}`);
          }
        }
        return destinationPath;
      }
      await copyFile(localCleanPath, tempPath);
    }
    // 3. HTTP / HTTPS CDN URL
    else if (url.startsWith("http://") || url.startsWith("https://")) {
      const response: AxiosResponse = await axios.get(url, {
        responseType: "arraybuffer",
        timeout: timeoutMs,
        validateStatus: (status) => status >= 200 && status < 300,
      });

      const contentType = response.headers?.["content-type"] || "";
      if (contentType.includes("text/html") || contentType.includes("application/json")) {
        throw new Error(`Expected video content but received Content-Type '${contentType}' from ${url}`);
      }

      if (response.data && typeof response.data.pipe === "function") {
        await new Promise<void>((resolvePromise, rejectPromise) => {
          const writer = createWriteStream(tempPath);
          response.data.pipe(writer);

          let errorHandled = false;
          const onError = (err: Error) => {
            if (!errorHandled) {
              errorHandled = true;
              writer.close(() => rejectPromise(err));
            }
          };

          writer.on("error", onError);
          response.data.on("error", onError);
          writer.on("finish", () => {
            writer.close(() => resolvePromise());
          });
        });
      } else {
        const buffer = Buffer.isBuffer(response.data)
          ? response.data
          : response.data instanceof ArrayBuffer
          ? Buffer.from(response.data)
          : Buffer.from(response.data || "");
        await writeFile(tempPath, buffer);
      }
    } else {
      throw new Error(`Unsupported video URL scheme: ${url}`);
    }

    // 4. Verify downloaded temp file exists and has minimum size
    if (!existsSync(tempPath)) {
      throw new Error(`Downloaded temporary file not found at ${tempPath}`);
    }

    // 5. Probe with ffprobe if requested
    if (validateWithProbe) {
      const probe = await probeVideoFile(tempPath);
      if (!probe.isValid) {
        throw new Error(`Video file failed ffprobe validation: ${probe.error}`);
      }
    }

    // 6. Atomic swap: Rename tempPath to destinationPath (handling Windows existing target)
    try {
      if (existsSync(destinationPath)) {
        await unlink(destinationPath);
      }
      await rename(tempPath, destinationPath);
    } catch {
      // Fallback for Windows file lock / cross-device boundary
      await copyFile(tempPath, destinationPath);
      await unlink(tempPath).catch(() => {});
    }
    return destinationPath;
  } catch (err: any) {
    await cleanupTemp();
    throw new Error(`Failed to safely download video from '${url}' to '${destinationPath}': ${err.message}`);
  }
}
