import { describe, it, expect } from "vitest";
import { resolveVideoDimensions } from "./dimension-resolver.js";

describe("resolveVideoDimensions", () => {
  it("resolves 16:9 widescreen dimensions correctly", () => {
    const d1080 = resolveVideoDimensions("16:9", "1080p");
    expect(d1080.width).toBe(1920);
    expect(d1080.height).toBe(1080);
    expect(d1080.aspectRatio).toBe("16:9");

    const d720 = resolveVideoDimensions("16:9", "720p");
    expect(d720.width).toBe(1280);
    expect(d720.height).toBe(720);
  });

  it("resolves 9:16 vertical portrait dimensions correctly", () => {
    const d1080 = resolveVideoDimensions("9:16", "1080p");
    expect(d1080.width).toBe(1080);
    expect(d1080.height).toBe(1920);
    expect(d1080.aspectRatio).toBe("9:16");

    const d720 = resolveVideoDimensions("9:16", "720p");
    expect(d720.width).toBe(720);
    expect(d720.height).toBe(1280);
  });

  it("resolves 1:1 square dimensions correctly without distorting into portrait", () => {
    const d1080 = resolveVideoDimensions("1:1", "1080p");
    expect(d1080.width).toBe(1080);
    expect(d1080.height).toBe(1080);
    expect(d1080.aspectRatio).toBe("1:1");

    const d720 = resolveVideoDimensions("1:1", "720p");
    expect(d720.width).toBe(720);
    expect(d720.height).toBe(720);
  });

  it("resolves 4:5 social dimensions correctly", () => {
    const d1080 = resolveVideoDimensions("4:5", "1080p");
    expect(d1080.width).toBe(1080);
    expect(d1080.height).toBe(1350);

    const d720 = resolveVideoDimensions("4:5", "720p");
    expect(d720.width).toBe(720);
    expect(d720.height).toBe(900);
  });

  it("defaults to 9:16 1080p when aspect ratio or resolution are nullish", () => {
    const def = resolveVideoDimensions();
    expect(def.width).toBe(1080);
    expect(def.height).toBe(1920);
    expect(def.aspectRatio).toBe("9:16");
  });
});
