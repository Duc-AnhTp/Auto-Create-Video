import { existsSync } from "node:fs";
import { copyFile } from "node:fs/promises";

/**
 * Process/optimize a downloaded image for video use.
 *
 * When `sharp` is available (optional dependency), resizes to target width
 * and optimizes quality. Otherwise, just copies the file as-is.
 *
 * We use dynamic import so the pipeline doesn't hard-fail when sharp
 * is not installed — it gracefully degrades to using the original image.
 */
export async function processImage(
  inputPath: string,
  outputPath: string,
  opts?: {
    /** Target width in pixels. Default 1080 (match 9:16 video width). */
    width?: number;
    /** JPEG quality 1-100. Default 85. */
    quality?: number;
  },
): Promise<{ optimized: boolean }> {
  if (!existsSync(inputPath)) {
    throw new Error(`processImage: input file not found: ${inputPath}`);
  }

  // If input === output, skip processing to prevent Sharp collision
  if (inputPath === outputPath) {
    return { optimized: false };
  }

  return trySharpProcess(inputPath, outputPath, opts);
}

async function trySharpProcess(
  inputPath: string,
  outputPath: string,
  opts?: { width?: number; quality?: number },
): Promise<{ optimized: boolean }> {
  try {
    const sharp = (await import("sharp")).default;
    const width = opts?.width ?? 1080;
    const quality = opts?.quality ?? 85;

    const ext = outputPath.split(".").pop()?.toLowerCase();
    let transformer = sharp(inputPath).resize(width, null, { fit: "cover", withoutEnlargement: true });

    if (ext === "png") {
      transformer = transformer.png({ quality: Math.min(quality, 100) });
    } else if (ext === "webp") {
      transformer = transformer.webp({ quality });
    } else if (ext === "avif") {
      transformer = transformer.avif({ quality });
    } else if (ext === "gif") {
      transformer = transformer.gif();
    } else {
      transformer = transformer.jpeg({ quality, mozjpeg: true });
    }

    await transformer.toFile(outputPath);

    return { optimized: true };
  } catch (e: any) {
    // Sharp not installed or processing failed — copy as-is
    if (e.code === "MODULE_NOT_FOUND" || e.code === "ERR_MODULE_NOT_FOUND") {
      if (inputPath !== outputPath) {
        await copyFile(inputPath, outputPath);
      }
      return { optimized: false };
    }
    // Re-throw actual processing errors so caller can handle
    throw e;
  }
}

/**
 * Guess file extension from a URL (before query string).
 * Returns extension without dot, or "jpg" as default.
 */
export function guessExtFromUrl(url: string): string {
  try {
    const pathname = new URL(url).pathname;
    const lastDot = pathname.lastIndexOf(".");
    if (lastDot >= 0) {
      const ext = pathname.slice(lastDot + 1).toLowerCase();
      if (["jpg", "jpeg", "png", "webp", "gif", "avif"].includes(ext)) {
        return ext;
      }
    }
  } catch {
    // Invalid URL — fall through
  }
  return "jpg";
}
