import {log} from '../../../../platform/observability/logger.js';
import { writeFile, mkdir, rename, unlink } from "node:fs/promises";
import { dirname } from "node:path";
import { createSafeHttpAgents, safeHttpGet, validateSafePublicUrl } from "../../../../platform/filesystem/url-security.js";

export interface FetchResult {
  success: boolean;
  path?: string;
  reason?: string;
}

export async function fetchImage(url: string | null, outPath: string): Promise<FetchResult> {
  if (!url) return { success: false, reason: "no url provided (null)" };

  // Validate URL protocol and protect against SSRF / internal IP queries
  const urlCheck = validateSafePublicUrl(url);
  if (!urlCheck.safe) {
    return { success: false, reason: `SSRF rejected: ${urlCheck.reason}` };
  }

  const agents = createSafeHttpAgents();
  try {
    const resp = await safeHttpGet<ArrayBuffer>(url, {
      responseType: "arraybuffer",
      timeout: 30000,
      maxContentLength: 50 * 1024 * 1024, // 50MB maximum payload
      maxBodyLength: 50 * 1024 * 1024,
      validateStatus: (s) => s < 400,
    }, agents);

    const ct = String(resp.headers["content-type"] ?? "");
    if (!ct.startsWith("image/")) {
      return { success: false, reason: `non-image content-type: ${ct}` };
    }

    const targetDir = dirname(outPath);
    await mkdir(targetDir, { recursive: true });
    const tmpPath = `${outPath}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`;
    try {
      await writeFile(tmpPath, Buffer.from(resp.data));
      await rename(tmpPath, outPath);
      return { success: true, path: outPath };
    } catch (writeErr: any) {
      try { await unlink(tmpPath); } catch (caughtError) { log.warn("[image-fetcher] "+String(caughtError)); }
      throw writeErr;
    }
  } catch (e: any) {
    const status = e.response?.status;
    return { success: false, reason: status ? `http ${status}` : String(e.message ?? e) };
  } finally {
    agents.destroy();
  }
}
