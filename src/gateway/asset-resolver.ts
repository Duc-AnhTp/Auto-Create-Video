import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { extname } from "node:path";
import type { ImageInputProtocol } from "./provider-capabilities.js";

/**
 * Categorizes the protocol of an image input string.
 */
export function categorizeImageProtocol(imageInput?: string): ImageInputProtocol | undefined {
  if (!imageInput) return undefined;
  if (imageInput.startsWith("http://") || imageInput.startsWith("https://")) {
    return "public_url";
  }
  if (imageInput.startsWith("data:")) {
    return "base64_data_uri";
  }
  return "local_path";
}

/**
 * Normalizes an image input (file path, URL, or Data URI) for cloud AI Video APIs.
 * Cloud APIs (Kling, Runway) cannot access local disk paths, so local images must be
 * safely read and converted to standard Base64 Data URIs (e.g. data:image/jpeg;base64,...).
 *
 * If a local file path does not exist on disk, throws an explicit error rather than
 * passing an invalid local path to remote servers.
 */
export async function resolveImageToDataUriOrUrl(imageInput?: string): Promise<string | undefined> {
  if (!imageInput) return undefined;

  // 1. Already a remote public URL or Data URI
  const protocol = categorizeImageProtocol(imageInput);
  if (protocol === "public_url" || protocol === "base64_data_uri") {
    return imageInput;
  }

  // 2. Local file path -> must exist and be converted to Base64 Data URI
  const cleanPath = imageInput.startsWith("file://")
    ? imageInput.replace(/^file:\/\//, "")
    : imageInput;

  if (!existsSync(cleanPath)) {
    throw new Error(`[Lỗi Ảnh Tham Chiếu] File ảnh cục bộ không tồn tại trên đĩa: '${cleanPath}'`);
  }

  const ext = extname(cleanPath).toLowerCase();
  let mimeType = "image/jpeg";
  if (ext === ".png") mimeType = "image/png";
  else if (ext === ".webp") mimeType = "image/webp";
  else if (ext === ".gif") mimeType = "image/gif";

  const buffer = await readFile(cleanPath);
  return `data:${mimeType};base64,${buffer.toString("base64")}`;
}
