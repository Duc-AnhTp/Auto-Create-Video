import { realpathSync, lstatSync } from "node:fs";
import { resolve,relative,isAbsolute,dirname } from "node:path";
import { HttpError } from "../errors.js";
export function containedPath(root: string, path: string): string {
  const base = realpathSync(resolve(root));
  const inside = (candidate: string) => { const rel = relative(base, candidate); return rel === "" || (!isAbsolute(rel) && rel !== ".." && !rel.startsWith("..\\") && !rel.startsWith("../")); };
  let target: string;
  if (isAbsolute(path)) {
    target = resolve(path);
  } else {
    const cwdResolved = resolve(path);
    target = inside(cwdResolved) ? cwdResolved : resolve(base, path);
  }
  if (!inside(target)) throw new HttpError(403, "PATH_FORBIDDEN");
  const exists = (candidate: string) => { try { lstatSync(candidate); return true; } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return false; throw error; } };
  let ancestor = target;
  while (!exists(ancestor) && ancestor !== dirname(ancestor)) ancestor = dirname(ancestor);
  let actual: string;
  try { actual = realpathSync(ancestor); } catch { throw new HttpError(403, "PATH_FORBIDDEN"); }
  if (!inside(actual)) throw new HttpError(403, "PATH_FORBIDDEN");
  const remainder = relative(ancestor, target);
  const resolvedTarget = remainder ? resolve(actual, remainder) : actual;
  if (!inside(resolvedTarget)) throw new HttpError(403, "PATH_FORBIDDEN");
  return resolvedTarget;
}
