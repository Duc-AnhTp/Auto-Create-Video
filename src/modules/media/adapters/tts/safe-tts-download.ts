import { randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, readFile, rename, rm, copyFile } from "node:fs/promises";
import { dirname } from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { setTimeout as delay } from "node:timers/promises";
import { createSafeHttpAgents, safeHttpGet } from "../../../../platform/filesystem/url-security.js";
import { probeAudioFile } from "../media-validator.js";

export async function promoteStagingFile(source: string, destination: string, signal?: AbortSignal): Promise<void> {
  const maxRetries = 5;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    signal?.throwIfAborted();
    try {
      await rename(source, destination);
      return;
    } catch (err: any) {
      signal?.throwIfAborted();
      if (err?.code === "EXDEV") {
        await copyFile(source, destination);
        await rm(source, { force: true }).catch(() => {});
        return;
      }
      if (["EPERM", "EBUSY", "EACCES"].includes(err?.code) && attempt < maxRetries - 1) {
        await delay(50 * Math.pow(2, attempt) + Math.floor(Math.random() * 25), undefined, { signal });
        continue;
      }
      throw err;
    }
  }
}

function validateSubtitle(data:string):void {
 const blocks=data.replace(/^\uFEFF/,'').trim().split(/\r?\n\s*\r?\n/);
 const timestamp=(value:string)=>{const match=/^(\d{2}):(\d{2}):(\d{2}),(\d{3})$/.exec(value);if(!match||Number(match[2])>59||Number(match[3])>59)throw new Error('TTS_SUBTITLE_INVALID');return Number(match[1])*3600+Number(match[2])*60+Number(match[3])+Number(match[4])/1000;};
 if(!data.trim())throw new Error('TTS_SUBTITLE_INVALID');
 for(const block of blocks){const lines=block.split(/\r?\n/),times=/^(\d{2}:\d{2}:\d{2},\d{3})\s+-->\s+(\d{2}:\d{2}:\d{2},\d{3})\s*$/.exec(lines[1]??'');if(!/^\d+$/.test(lines[0])||!times||!lines.slice(2).join('').trim()||timestamp(times[2])<=timestamp(times[1]))throw new Error('TTS_SUBTITLE_INVALID');}
}

export async function downloadTtsAsset(url: string, destination: string, subtitle = false, signal?: AbortSignal): Promise<void> {
  if (new URL(url).protocol !== "https:") throw new Error("TTS_DOWNLOAD_URL_FORBIDDEN");
  const abort = AbortSignal.any([AbortSignal.timeout(60_000), ...(signal ? [signal] : [])]);
  const maxBytes = (subtitle ? 2 : 64) * 1024 * 1024;
  await mkdir(dirname(destination), { recursive: true });
  const temporary = destination + "." + randomUUID() + ".tmp";
  const agents = createSafeHttpAgents();
  try {
    for (let attempt = 0; attempt < 3; attempt++) {
      let response: Awaited<ReturnType<typeof safeHttpGet>> | undefined;
      try {
        abort.throwIfAborted();
        response = await safeHttpGet(url, {responseType: "stream", timeout: 60_000, signal: abort}, agents, {httpsOnly:true});
        if (response.status !== 200) throw new Error("TTS_DOWNLOAD_STATUS_INVALID");
        if (Number(response.headers["content-length"]) > maxBytes) throw new Error("TTS_DOWNLOAD_LIMIT");
        let received = 0;
        const bounded = new Transform({transform(chunk, _encoding, callback) {
          received += chunk.length;
          callback(received > maxBytes ? new Error("TTS_DOWNLOAD_LIMIT") : null, chunk);
        }});
        await pipeline(response.data as NodeJS.ReadableStream, bounded, createWriteStream(temporary, {flags: "wx"}), {signal: abort});
        if (subtitle) {
          const data = new TextDecoder("utf-8", {fatal: true}).decode(await readFile(temporary));
          validateSubtitle(data);
        } else {
          const probe = await probeAudioFile(temporary, abort);
          abort.throwIfAborted();
          if (!probe.isValid) throw new Error("TTS_AUDIO_INVALID");
        }
        abort.throwIfAborted();
        await promoteStagingFile(temporary, destination, abort);
        return;
      } catch (error) {
        (response?.data as {destroy?: () => void} | undefined)?.destroy?.();
        await rm(temporary, {force: true});
        const code = (error as {code?: string}).code;
        const status = (error as {response?: {status?: number}}).response?.status;
        const transient = ["ECONNRESET", "ETIMEDOUT", "ECONNABORTED", "EAI_AGAIN"].includes(code ?? "") || (status !== undefined && status >= 500);
        if (!transient || abort.aborted || attempt === 2) throw error;
        await delay(200 * 2 ** attempt + Math.floor(Math.random() * 100), undefined, {signal: abort});
      }
    }
  } finally { agents.destroy(); await rm(temporary, {force: true}); }
}
