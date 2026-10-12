import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
const temporary=resolve("output","test-runtime",String(process.pid));
await mkdir(temporary,{recursive:true});
const child=spawn(process.execPath,[resolve("node_modules/vitest/vitest.mjs"),"run",...process.argv.slice(2)],{shell:false,windowsHide:true,stdio:"inherit",env:{...process.env,TEMP:temporary,TMP:temporary}});
child.on("error",error=>{console.error(error.message);process.exitCode=1;});
child.on("exit",code=>{process.exitCode=code??1;});
