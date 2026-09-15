import { mkdtempSync, rmSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

/**
 * Creates an isolated temporary directory for test executions to avoid SQLite
 * database collisions and file races across test suites.
 */
export function createIsolatedTestDir(prefix: string = "test-iso-"): {
  dir: string;
  cleanup: () => void;
} {
  const base = mkdtempSync(join(tmpdir(), prefix));
  return {
    dir: base,
    cleanup: () => {
      try {
        rmSync(base, { recursive: true, force: true });
      } catch {
        // Ignore best-effort cleanup errors on Windows file locks
      }
    },
  };
}
