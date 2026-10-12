import { produceNewsVideo, type PipelineOptions } from "../modules/news/application/news-pipeline.js";
import { loadConfig, validateTtsProvider } from "./config.js";
import { createTtsClient } from "./tts-client.js";
import { startReviewServer } from "../apps/http/review-server.js";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { packageRoot } from "../platform/filesystem/package-paths.js";
export function runPipeline(scriptPath: string, options: PipelineOptions = {}): Promise<void> { return produceNewsVideo(scriptPath, options, { cfg: loadConfig({ validateProvider: false }), createTtsClient, startReviewServer, validateTtsProvider, templateDir: fileURLToPath(new URL("../modules/media/adapters/render/templates/", import.meta.url)), sfxDir: join(packageRoot, "assets", "sfx") }); }
