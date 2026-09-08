#!/usr/bin/env node
import { config } from "dotenv";
config({ path: ".env.local" });
config({ path: ".env" });

import { runPipeline, type PipelineOptions } from "./pipeline.js";
import { type TtsProvider } from "./config.js";
import { runSeriesCli } from "./series/series-cli.js";
import { log } from "./utils/logger.js";

function printUsage(): void {
  console.log(`
🎬 Auto News Video & Episodic Film Series CLI

Usage (Single Video Pipeline):
  npm run pipeline -- <path/to/script.json> [options]

Usage (Episodic AI Film Series Engine):
  npx tsx src/cli.ts series:<command> [options]

Series Commands:
  series:init         Initialize new AI Film Series metadata and visual style
  series:character    Register character with face anchor, voice & wardrobe
  series:location     Register recurring world locations & atmospheric rules
  series:prop         Register special canon props ("không được quên")
  series:episode      Produce episode from raw screenplay text (8-step pipeline)
  series:status       Show Story Bible report & multi-episode history

Pipeline Options:
  -r, --review        Launch interactive Web Review Dashboard before rendering
  -d, --draft         Fast render at 15 FPS with draft quality (speeds up testing)
      --skip-render   Run audio generation and HTML composition without rendering MP4
      --no-render     Alias for --skip-render
  -f, --force-tts     Bypass TTS cache and re-synthesize all voice scenes
  -p, --provider      Override TTS provider ("lucylab" | "elevenlabs")
      --bgm <path>    Background music path or name in assets/bgm
  -h, --help          Show this help message

Examples:
  npm run pipeline -- output/my-video/script.json --review
  npx tsx src/cli.ts series:init --series "cyber-saigon" --title "Sài Gòn 2088"
  npx tsx src/cli.ts series:episode --series "cyber-saigon" --script "scripts/ep1.txt" --dry-run
`);
}

async function main() {
  const args = process.argv.slice(2);

  if (args.length > 0 && args[0].startsWith("series:")) {
    await runSeriesCli(args);
    return;
  }

  if (args.length === 0 || args.includes("-h") || args.includes("--help")) {
    printUsage();
    process.exit(args.length === 0 ? 2 : 0);
  }

  const reviewFlag = args.includes("--review") || args.includes("-r");
  const draftFlag = args.includes("--draft") || args.includes("-d");
  const skipRenderFlag = args.includes("--skip-render") || args.includes("--no-render");
  const forceTtsFlag = args.includes("--force-tts") || args.includes("-f");

  // Parse --provider / -p
  let providerOption: TtsProvider | undefined;
  const pIndex = args.findIndex((a) => a === "--provider" || a === "-p");
  if (pIndex >= 0 && args[pIndex + 1] && !args[pIndex + 1].startsWith("-")) {
    const val = args[pIndex + 1].toLowerCase();
    if (val === "lucylab" || val === "elevenlabs") {
      providerOption = val;
    } else {
      console.error(`Error: invalid --provider "${val}". Must be "lucylab" or "elevenlabs".`);
      process.exit(2);
    }
  } else {
    const pInline = args.find((a) => a.startsWith("--provider="));
    if (pInline) {
      const val = pInline.split("=")[1]?.toLowerCase();
      if (val === "lucylab" || val === "elevenlabs") {
        providerOption = val;
      } else {
        console.error(`Error: invalid --provider "${val}". Must be "lucylab" or "elevenlabs".`);
        process.exit(2);
      }
    }
  }

  // Parse --bgm
  let bgmOption: string | undefined;
  const bgmIndex = args.findIndex((a) => a === "--bgm");
  if (bgmIndex >= 0 && args[bgmIndex + 1] && !args[bgmIndex + 1].startsWith("-")) {
    bgmOption = args[bgmIndex + 1];
  } else {
    const bgmInline = args.find((a) => a.startsWith("--bgm="));
    if (bgmInline) {
      bgmOption = bgmInline.split("=")[1];
    }
  }

  // Positional argument: script.json path
  const scriptPath = args.find((a, idx) => {
    if (a.startsWith("-")) return false;
    // Skip values of options like --provider <val> or --bgm <val>
    if (idx > 0 && (args[idx - 1] === "--provider" || args[idx - 1] === "-p" || args[idx - 1] === "--bgm")) {
      return false;
    }
    return true;
  });

  if (!scriptPath) {
    console.error("Error: missing script.json path.");
    printUsage();
    process.exit(2);
  }

  const options: PipelineOptions = {
    review: reviewFlag,
    draft: draftFlag,
    skipRender: skipRenderFlag,
    forceTts: forceTtsFlag,
    provider: providerOption,
    bgm: bgmOption,
  };

  try {
    await runPipeline(scriptPath, options);
  } catch (e) {
    log.error("Pipeline failed", e);
    process.exit(1);
  }
}

main();
