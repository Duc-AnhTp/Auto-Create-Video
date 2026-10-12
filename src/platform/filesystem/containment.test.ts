import { describe, it, expect } from "vitest";
import { containedPath } from "./containment.js";
import { HttpError } from "../errors.js";
import { resolve, join } from "node:path";
import { tmpdir } from "node:os";

describe("Filesystem Containment", () => {
  const testRoot = resolve(tmpdir());

  it("should allow safe relative paths anchored to root", () => {
    const res = containedPath(testRoot, "subfolder/file.txt");
    expect(res).toBe(resolve(testRoot, "subfolder/file.txt"));
  });

  it("should allow safe absolute paths inside root", () => {
    const target = join(testRoot, "safe-nested", "file.json");
    const res = containedPath(testRoot, target);
    expect(res).toBe(resolve(target));
  });

  it("should reject path traversal attempts outside root", () => {
    expect(() => {
      containedPath(testRoot, "../../outside.txt");
    }).toThrow(HttpError);

    try {
      containedPath(testRoot, "../outside.txt");
    } catch (e: any) {
      expect(e.status).toBe(403);
      expect(e.code).toBe("PATH_FORBIDDEN");
    }
  });
});
