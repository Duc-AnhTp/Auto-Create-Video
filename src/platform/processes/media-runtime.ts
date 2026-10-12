import { createRequire } from "node:module";
import { dirname, delimiter } from "node:path";
import { existsSync } from "node:fs";
const require = createRequire(import.meta.url);
// Prefer system tools; project-local tools support a clean Windows checkout.
const dirs: string[] = [];
for (const name of ["ffmpeg-static", "ffprobe-static"]) {
  try { const loaded = require(name); const path = typeof loaded === "string" ? loaded : loaded.path; if (path && existsSync(path)) dirs.push(dirname(path)); } catch { /* Doctor reports missing tools. */ }
}
if (dirs.length) process.env.PATH = [process.env.PATH || "", ...dirs].join(delimiter);
