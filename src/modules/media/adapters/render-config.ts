import { createHash } from "node:crypto";
import type { EffectiveRenderConfig } from "../../../contracts/episode.js";
export function resolveEffectiveRenderConfig(
  explicit?: {
    transitionDurationSec?: number;
    fps?: number;
    aspectRatio?: string;
    overflowPolicy?: "extend_shot" | "split_shot" | "error";
  },
  checkpoint?: {
    transitionDurationSec?: number;
    fps?: number;
    aspectRatio?: string;
    overflowPolicy?: "extend_shot" | "split_shot" | "error";
    effectiveRenderConfig?: EffectiveRenderConfig;
  },
  seriesMeta?: {
    aspect_ratio?: string;
    aspectRatio?: string;
    fps?: number;
  },
  scriptFallback?: {
    aspectRatio?: string;
    aspect_ratio?: string;
    fps?: number;
  }
): EffectiveRenderConfig {
  const transitionDurationSec =
    explicit?.transitionDurationSec !== undefined
      ? explicit.transitionDurationSec
      : checkpoint?.transitionDurationSec !== undefined
      ? checkpoint.transitionDurationSec
      : checkpoint?.effectiveRenderConfig?.transitionDurationSec !== undefined
      ? checkpoint.effectiveRenderConfig.transitionDurationSec
      : 0.0;

  const fps =
    explicit?.fps !== undefined
      ? explicit.fps
      : checkpoint?.fps !== undefined
      ? checkpoint.fps
      : checkpoint?.effectiveRenderConfig?.fps !== undefined
      ? checkpoint.effectiveRenderConfig.fps
      : seriesMeta?.fps !== undefined
      ? seriesMeta.fps
      : scriptFallback?.fps !== undefined
      ? scriptFallback.fps
      : 30;

  const aspectRatio =
    explicit?.aspectRatio ||
    checkpoint?.aspectRatio ||
    checkpoint?.effectiveRenderConfig?.aspectRatio ||
    seriesMeta?.aspect_ratio ||
    seriesMeta?.aspectRatio ||
    scriptFallback?.aspectRatio ||
    scriptFallback?.aspect_ratio ||
    "9:16";

  const overflowPolicy =
    explicit?.overflowPolicy ||
    checkpoint?.overflowPolicy ||
    checkpoint?.effectiveRenderConfig?.overflowPolicy ||
    "extend_shot";

  const configHash = createHash("sha256")
    .update(`${transitionDurationSec.toFixed(3)}:${fps}:${aspectRatio}:${overflowPolicy}`)
    .digest("hex")
    .slice(0, 16);

  return {
    transitionDurationSec,
    fps,
    aspectRatio,
    overflowPolicy,
    configHash,
  };
}
