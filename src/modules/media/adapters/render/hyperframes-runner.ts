import { WorkflowError } from "../../../../platform/workflow-error.js";
import { createRequire } from "node:module";
import { dirname,join } from "node:path";
import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import { runMediaCommand,publishMediaRename } from "../../../../platform/processes/media-process-runner.js";
import { probeVideoFile } from "../media-validator.js";
import { log } from "../../../../platform/observability/logger.js";

export interface RenderArgs {
  compositionDir: string;  // path to composition directory
  outputPath: string;      // path for .mp4
  fps?: number;            // default 30
  quality?: "draft" | "standard" | "high"; // default "standard"
  durationSec?:number;
}

export async function renderWithHyperframes(args: RenderArgs): Promise<void> {
  const { compositionDir, outputPath, fps = 30, quality = "standard" } = args;

  const require=createRequire(import.meta.url);
  const cli=join(dirname(require.resolve("hyperframes/package.json")),"dist","cli.js");
  const temporary=outputPath+"."+randomUUID()+".tmp.mp4";
  const spawnArgs = [
    cli,
    "render",
    compositionDir,
    "--output",
    temporary,
    "--fps",
    String(fps),
    "--quality",
    quality,
  ];

  try {
    await runMediaCommand(process.execPath,spawnArgs,{mediaTask:true,durationSec:args.durationSec,atomicOutput:false});
    if(!(await probeVideoFile(temporary)).isValid)throw new WorkflowError("HYPERFRAMES_MEDIA_INVALID", "HYPERFRAMES_MEDIA_INVALID", "failed");
    publishMediaRename(temporary,outputPath);
  }finally{await rm(temporary,{force:true});}

  log.info(`Rendered: ${outputPath}`);
}
