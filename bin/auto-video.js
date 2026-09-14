#!/usr/bin/env node
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { existsSync } from "node:fs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = join(__dirname, "..");

const distCli = join(rootDir, "dist", "cli.js");
const srcCli = join(rootDir, "src", "cli.ts");
const tsxCli = join(rootDir, "node_modules", "tsx", "dist", "cli.mjs");

const args = process.argv.slice(2);

let proc;
if (existsSync(distCli)) {
  proc = spawn(process.execPath, [distCli, ...args], {
    cwd: process.cwd(),
    stdio: "inherit",
  });
} else if (existsSync(tsxCli)) {
  proc = spawn(process.execPath, [tsxCli, srcCli, ...args], {
    cwd: process.cwd(),
    stdio: "inherit",
  });
} else {
  const tsxBin = process.platform === "win32" ? "npx.cmd" : "npx";
  proc = spawn(tsxBin, ["tsx", srcCli, ...args], {
    cwd: process.cwd(),
    stdio: "inherit",
    shell: process.platform === "win32",
  });
}

proc.on("exit", (code) => {
  process.exit(code ?? 0);
});
