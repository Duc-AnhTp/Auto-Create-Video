import {log} from '../../../platform/observability/logger.js';
import { runFfprobe } from "./ffmpeg.js";

import { existsSync, createWriteStream } from "node:fs";
import { unlink, rename, mkdir, copyFile, writeFile, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { tmpdir } from "node:os";
import axios, { type AxiosResponse } from "axios";
import { createSafeHttpAgents, safeHttpGet, validateSafePublicUrl } from "../../../platform/filesystem/url-security.js";


export interface VideoStreamInfo {
  codecName: string;
  width: number;
  height: number;
  durationSec?: number;
  pixelFormat?:string;frameRate?:string;timeBase?:string;sampleAspectRatio?:string;profile?:string;level?:number;colorSpace?:string;colorRange?:string;colorTransfer?:string;colorPrimaries?:string;
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
      "-show_entries", "format=format_name,duration,size,bit_rate:stream=codec_type,codec_name,width,height,duration,channels,sample_rate,pix_fmt,r_frame_rate,time_base,sample_aspect_ratio,profile,level,color_space,color_range,color_transfer,color_primaries",
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
    if (!Number.isFinite(durationSec) || durationSec <= 0) {
      return {
        isValid: false,
        durationSec: 0,
        formatName: format.format_name || "",
        sizeBytes: Number(format.size || 0),
        error: `Invalid or zero video duration in file: ${filePath}`,
      };
    }

    const containerDur = format.duration ? parseFloat(format.duration) : undefined;
    const videoStream: VideoStreamInfo = {
      codecName: videoStreamRaw.codec_name || "",
      width: Number(videoStreamRaw.width || 0),
      height: Number(videoStreamRaw.height || 0),
      pixelFormat:videoStreamRaw.pix_fmt,frameRate:videoStreamRaw.r_frame_rate,timeBase:videoStreamRaw.time_base,sampleAspectRatio:videoStreamRaw.sample_aspect_ratio,profile:videoStreamRaw.profile,level:videoStreamRaw.level,colorSpace:videoStreamRaw.color_space,colorRange:videoStreamRaw.color_range,colorTransfer:videoStreamRaw.color_transfer,colorPrimaries:videoStreamRaw.color_primaries,
      durationSec: videoStreamRaw.duration ? parseFloat(videoStreamRaw.duration) : containerDur,
    };

    if (!videoStream.codecName || !Number.isFinite(videoStream.width) || videoStream.width <= 0 || !Number.isFinite(videoStream.height) || videoStream.height <= 0) throw new Error('Invalid video stream metadata');
    let audioStream: AudioStreamInfo | undefined = undefined;
    if (audioStreamRaw) {
      audioStream = {
        codecName: audioStreamRaw.codec_name || "",
        channels: Number(audioStreamRaw.channels || 1),
        sampleRate: Number(audioStreamRaw.sample_rate || 44100),
        durationSec: audioStreamRaw.duration ? parseFloat(audioStreamRaw.duration) : containerDur,
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
export async function probeAudioFile(filePath: string, signal?: AbortSignal): Promise<AudioProbeInfo> {
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

    const rawOutput = await runFfprobe(args, {signal});
    const parsed = JSON.parse(rawOutput);
    const format = parsed.format || {};
    const streams = parsed.streams || [];
    const audioStreamRaw = streams.find((s: any) => s.codec_type === "audio");

    if (!audioStreamRaw || !audioStreamRaw.codec_name || !Number.isFinite(Number(audioStreamRaw.channels)) || !(Number(audioStreamRaw.channels) > 0) || !Number.isFinite(Number(audioStreamRaw.sample_rate)) || !(Number(audioStreamRaw.sample_rate) > 0)) throw new Error('Invalid or missing audio stream');
    const durationSec = parseFloat(audioStreamRaw?.duration || format.duration || "0");
    if (!Number.isFinite(durationSec) || durationSec <= 0) {
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
  allowLocalhost?: boolean;
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
  let safeAgents: ReturnType<typeof createSafeHttpAgents> | undefined;

  const cleanupTemp = async () => {
    if (existsSync(tempPath)) {
      try {
        await unlink(tempPath);
      } catch (caughtError) { log.warn("[media-validator] "+String(caughtError)); }
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
      const resolvedSource = resolve(localCleanPath);
      const allowedRoots = [resolve(process.cwd()), resolve(tmpdir()), dirname(resolve(destinationPath))];
      const isAllowed = allowedRoots.some(
        (root) => resolvedSource === root || resolvedSource.startsWith(root + "\\") || resolvedSource.startsWith(root + "/")
      );
      if (!isAllowed) {
        throw new Error(`Local source video path outside allowed workspace: ${localCleanPath}`);
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
      const urlCheck = validateSafePublicUrl(url, { allowLocalhost: options.allowLocalhost });
      if (!urlCheck.safe) {
        throw new Error(`SSRF policy rejected video URL: ${urlCheck.reason}`);
      }

      safeAgents = createSafeHttpAgents({ allowLocalhost: options.allowLocalhost });
      const response: AxiosResponse = await safeHttpGet(url, {
        responseType: "stream",
        timeout: timeoutMs,
        maxContentLength: 2 * 1024 * 1024 * 1024,
        maxBodyLength: 2 * 1024 * 1024 * 1024,
        validateStatus: (status) => status >= 200 && status < 300,
      }, safeAgents, { allowLocalhost: options.allowLocalhost });

      const contentType = String(response.headers?.["content-type"] || "");
      if (contentType.includes("text/html") || contentType.includes("application/json")) {
        throw new Error(`Expected video content but received Content-Type '${contentType}' from ${url}`);
      }

      const maxBytes = 2 * 1024 * 1024 * 1024; // 2GB
      let receivedBytes = 0;

      await new Promise<void>((resolvePromise, rejectPromise) => {
        const writer = createWriteStream(tempPath);
        let errorHandled = false;

        const onError = (err: Error) => {
          if (!errorHandled) {
            errorHandled = true;
            writer.close(() => rejectPromise(err));
          }
        };

        if (response.data && typeof response.data.on === "function") {
          response.data.on("data", (chunk: Buffer) => {
            receivedBytes += chunk.length;
            if (receivedBytes > maxBytes) {
              response.data.destroy?.();
              onError(new Error(`Video stream exceeded max size limit of ${maxBytes} bytes`));
            }
          });
          response.data.on("error", onError);
          writer.on("error", onError);
          writer.on("finish", () => {
            writer.close(() => resolvePromise());
          });
          response.data.pipe(writer);
        } else {
          const buffer = Buffer.isBuffer(response.data)
            ? response.data
            : response.data instanceof ArrayBuffer
            ? Buffer.from(response.data)
            : Buffer.from(response.data || "");
          writeFile(tempPath, buffer).then(resolvePromise, rejectPromise);
        }
      });
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

    // 6. Atomic swap with rollback: stage to destinationPath, preserving original on failure
    const backupPath = `${destinationPath}.bak.${Date.now()}`;
    let backedUp = false;
    if (existsSync(destinationPath)) {
      try {
        await rename(destinationPath, backupPath);
        backedUp = true;
      } catch {
        await copyFile(destinationPath, backupPath);
        backedUp = true;
      }
    }

    try {
      try {
        await rename(tempPath, destinationPath);
      } catch {
        // Fallback for Windows cross-device boundary
        await copyFile(tempPath, destinationPath);
        await unlink(tempPath).catch(() => {});
      }
      // Promotion succeeded: remove backup
      if (backedUp && existsSync(backupPath)) {
        await unlink(backupPath).catch(() => {});
      }
    } catch (promoteErr) {
      // Promotion failed: restore destination from backup
      if (backedUp && existsSync(backupPath)) {
        try {
          if (existsSync(destinationPath)) {
            await unlink(destinationPath).catch(() => {});
          }
          await rename(backupPath, destinationPath);
        } catch {
          await copyFile(backupPath, destinationPath).catch(() => {});
          await unlink(backupPath).catch(() => {});
        }
      }
      throw promoteErr;
    }
    return destinationPath;
  } catch (err: any) {
    await cleanupTemp();
    throw new Error(`Failed to safely download video from '${url}' to '${destinationPath}': ${err.message}`);
  } finally {
    safeAgents?.destroy();
  }
}
