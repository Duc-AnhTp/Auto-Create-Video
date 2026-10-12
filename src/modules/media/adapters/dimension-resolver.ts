/**
 * Video Dimension Resolver
 *
 * Provides standardized resolution calculation across diverse aspect ratios
 * (16:9 widescreen, 9:16 mobile portrait, 1:1 square, 4:5 social).
 */

export type StandardAspectRatio = "16:9" | "9:16" | "1:1" | "4:5";
export type StandardResolution = "1080p" | "720p";

export interface VideoDimensions {
  width: number;
  height: number;
  aspectRatio: string;
}

export function resolveVideoDimensions(
  aspectRatio?: string | null,
  exportResolution?: string | null
): VideoDimensions {
  const normAspect = (aspectRatio || "9:16").trim();
  const is1080p = exportResolution === "1080p" || !exportResolution;

  switch (normAspect) {
    case "16:9":
      return {
        width: is1080p ? 1920 : 1280,
        height: is1080p ? 1080 : 720,
        aspectRatio: "16:9",
      };
    case "1:1":
      return {
        width: is1080p ? 1080 : 720,
        height: is1080p ? 1080 : 720,
        aspectRatio: "1:1",
      };
    case "4:5":
      return {
        width: is1080p ? 1080 : 720,
        height: is1080p ? 1350 : 900,
        aspectRatio: "4:5",
      };
    case "9:16":
    default:
      return {
        width: is1080p ? 1080 : 720,
        height: is1080p ? 1920 : 1280,
        aspectRatio: normAspect || "9:16",
      };
  }
}
