import { readFile, writeFile, mkdir, copyFile } from "node:fs/promises";
import { join, dirname, basename, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import pLimit from "p-limit";
import { ScriptSchema, type Script } from "./render/script-schema.js";
import { loadConfig, validateTtsProvider, type TtsProvider } from "./config.js";
import { createTtsClient } from "./tts/tts-client.js";
import { normalizeVietnameseForTts } from "./tts/vietnamese-normalizer.js";
import { startReviewServer } from "./review/server.js";
import { fetchImage } from "./assets/image-fetcher.js";
import { processImage, guessExtFromUrl } from "./assets/image-processor.js";
import { getDurationSec, concatWithSilence, mixSfxOntoVoice, mixBgmWithDucking, type SfxMixSpec } from "./assets/audio-tools.js";
import { indexSfxLibrary, pickSfxForScene, defaultPlayback } from "./assets/sfx-selector.js";
import { existsSync } from "node:fs";
import { composeHtml, resolveSceneImageRefs } from "./render/html-composer.js";
import { renderWithHyperframes } from "./render/hyperframes-runner.js";
import { log } from "./utils/logger.js";

const TOTAL_STEPS = 8;
const DURATION_MIN_SEC = 30;
const DURATION_MAX_SEC = 600;
const SCENE_GAP_SEC = 0.3;
/**
 * Extra seconds added to the outro scene visual duration AFTER the voice ends.
 * Gives the TikTok follow card time to be read by the viewer (otherwise the
 * video ends a few hundred ms after the card slides up + click animation).
 * Audio stays silent during this hold; visual stays on screen.
 */
const OUTRO_HOLD_SEC = 3;

const __dirname = dirname(fileURLToPath(import.meta.url));
const TPL_DIR = join(__dirname, "render", "templates");
/** Path to the SFX library (relative to project root) */
const SFX_DIR = join(__dirname, "..", "assets", "sfx");

const HYPERFRAMES_CONFIG = {
  $schema: "https://hyperframes.heygen.com/schema/hyperframes.json",
  registry: "https://raw.githubusercontent.com/heygen-com/hyperframes/main/registry",
  paths: {
    blocks: "compositions",
    components: "compositions/components",
    assets: "assets",
  },
};

export interface PipelineOptions {
  review?: boolean;
  draft?: boolean;
  skipRender?: boolean;
  forceTts?: boolean;
  provider?: TtsProvider;
  bgm?: string;
}

export async function runPipeline(scriptPath: string, options: PipelineOptions = {}): Promise<void> {
  const cfg = loadConfig({ validateProvider: false });
  const outputDir = dirname(scriptPath);
  log.info(`Output directory: ${outputDir}`);

  // STEP 1
  const raw = JSON.parse(await readFile(scriptPath, "utf8"));
  const effectiveProvider: TtsProvider = options.provider ?? raw.voice?.provider ?? cfg.ttsProvider;
  log.step(1, TOTAL_STEPS, `Load env + validate script.json (TTS provider: ${effectiveProvider})`);

  // If provider option was provided via CLI, override in raw
  if (options.provider) {
    if (!raw.voice) {
      const defaultVoiceId = (effectiveProvider === "lucylab" ? cfg.lucylabVoiceId : cfg.elevenlabsVoiceId);
      if (!defaultVoiceId) {
        const varName = effectiveProvider === "lucylab" ? "VIETNAMESE_VOICEID" : "ELEVENLABS_VOICE_ID";
        throw new Error(`--provider ${options.provider} used, but ${varName} is not configured in environment or .env`);
      }
      raw.voice = { provider: options.provider, voiceId: defaultVoiceId, speed: 1.0 };
    } else {
      raw.voice.provider = options.provider;
    }
  }

  // Validate provider credentials for the effective provider
  const hasConcreteVoiceId = Boolean(raw.voice?.voiceId && !raw.voice.voiceId.startsWith("${"));
  validateTtsProvider(cfg, effectiveProvider, { requireVoiceId: !hasConcreteVoiceId });

  // Populate provider if voice object exists without provider
  if (raw.voice && !raw.voice.provider) {
    raw.voice.provider = effectiveProvider;
  }

  // If voice object exists but voiceId is missing, populate with provider default
  if (raw.voice && !raw.voice.voiceId) {
    const defaultVoiceId = (effectiveProvider === "lucylab" ? cfg.lucylabVoiceId : cfg.elevenlabsVoiceId);
    if (!defaultVoiceId) {
      const varName = effectiveProvider === "lucylab" ? "VIETNAMESE_VOICEID" : "ELEVENLABS_VOICE_ID";
      throw new Error(`Voice ID is missing in script.json and ${varName} is not configured in environment or .env`);
    }
    raw.voice.voiceId = defaultVoiceId;
  }

  // Substitute env placeholder before validation (works for both providers)
  if (
    raw.voice?.voiceId === "${VIETNAMESE_VOICEID}" ||
    raw.voice?.voiceId === "${ELEVENLABS_VOICE_ID}" ||
    raw.voice?.voiceId === "${VOICE_ID}"
  ) {
    const resolvedVoiceId = effectiveProvider === "lucylab" ? cfg.lucylabVoiceId : cfg.elevenlabsVoiceId;
    if (!resolvedVoiceId) {
      const varName = effectiveProvider === "lucylab" ? "VIETNAMESE_VOICEID" : "ELEVENLABS_VOICE_ID";
      throw new Error(`Voice ID placeholder used, but ${varName} is not configured in environment or .env`);
    }
    raw.voice.voiceId = resolvedVoiceId;
  }
  let script: Script = ScriptSchema.parse(raw);

  // Fallback default voice if script.voice was omitted
  if (!script.voice) {
    const defaultVoiceId = (effectiveProvider === "lucylab" ? cfg.lucylabVoiceId : cfg.elevenlabsVoiceId);
    if (!defaultVoiceId) {
      const varName = effectiveProvider === "lucylab" ? "VIETNAMESE_VOICEID" : "ELEVENLABS_VOICE_ID";
      throw new Error(`script.voice was omitted and ${varName} is not set in environment or config`);
    }
    script.voice = {
      provider: effectiveProvider,
      voiceId: defaultVoiceId,
      speed: 1.0,
    };
  }

  // OPTIONAL: Interactive Web Review Dashboard
  if (options.review) {
    log.info("Interactive review enabled. Starting Web Review Dashboard...");
    script = await startReviewServer({ scriptPath, initialScript: script });
    log.info("Proceeding with approved script.");
  }

  // Ensure voice is populated after review
  if (!script.voice) {
    const defaultVoiceId = (effectiveProvider === "lucylab" ? cfg.lucylabVoiceId : cfg.elevenlabsVoiceId);
    if (!defaultVoiceId) {
      const varName = effectiveProvider === "lucylab" ? "VIETNAMESE_VOICEID" : "ELEVENLABS_VOICE_ID";
      throw new Error(`script.voice was omitted and ${varName} is not set in environment or config`);
    }
    script.voice = {
      provider: effectiveProvider,
      voiceId: defaultVoiceId,
      speed: 1.0,
    };
  }
  const voiceConfig = script.voice;

  // STEP 2: Download declared images + write script.txt
  log.step(2, TOTAL_STEPS, "Download images + write script.txt for CapCut");
  const fullText = script.scenes.map((s) => s.voiceText).join("\n\n");
  await writeFile(join(outputDir, "script.txt"), fullText);

  const imageDir = join(outputDir, "images");
  await mkdir(imageDir, { recursive: true });

  // Download all declared images (from script.images[]) in parallel
  const imageMap = new Map<string, string>(); // id → relative path (e.g. "images/hero.jpg")
  if (script.images && script.images.length > 0) {
    log.info(`  Downloading ${script.images.length} declared image(s)...`);
    const imgDownloads = script.images.map(async (img) => {
      const ext = guessExtFromUrl(img.url);
      const filename = `${img.id}.${ext}`;
      const rawPath = join(imageDir, `raw-${filename}`);
      const finalPath = join(imageDir, filename);
      const urlTagPath = join(imageDir, `${img.id}.url`);

      // Cache: skip if final processed image already exists AND source URL matches
      let urlMatches = false;
      if (existsSync(urlTagPath)) {
        try {
          const cachedUrl = (await readFile(urlTagPath, "utf8")).trim();
          if (cachedUrl === img.url.trim()) urlMatches = true;
        } catch {}
      }

      if (existsSync(finalPath) && urlMatches) {
        imageMap.set(img.id, `images/${filename}`);
        log.info(`    ${img.id}: REUSE existing (cached)`);
        return;
      }

      try {
        const result = await fetchImage(img.url, rawPath);
        if (result.success) {
          try {
            // Optimize image for video (resize to 1080px width)
            const { optimized } = await processImage(rawPath, finalPath);
            await writeFile(urlTagPath, img.url.trim(), "utf8");
            imageMap.set(img.id, `images/${filename}`);
            log.info(`    ${img.id}: downloaded${optimized ? " + optimized" : ""}`);
          } catch (procErr: any) {
            log.warn(`    ${img.id}: image processing failed (${procErr?.message || procErr}) -> falling back to raw image`);
            try {
              await copyFile(rawPath, finalPath);
              await writeFile(urlTagPath, img.url.trim(), "utf8");
              imageMap.set(img.id, `images/${filename}`);
            } catch {
              log.warn(`    ${img.id}: failed to copy raw fallback image`);
            }
          }
        } else {
          log.warn(`    ${img.id}: download failed (${result.reason})`);
        }
      } catch (err: any) {
        log.warn(`    ${img.id}: unexpected download error (${err?.message || err})`);
      }
    });
    await Promise.all(imgDownloads);
    log.info(`  ${imageMap.size}/${script.images.length} images ready`);
  }

  // Also download og:image for hook scene (backward compat)
  log.step(3, TOTAL_STEPS, "Fetch og:image (parallel) + Step 4 TTS");
  const imgPath = join(outputDir, "images", "bg.jpg");
  const imgPromise = script.metadata.source.image
    ? fetchImage(script.metadata.source.image, imgPath)
    : Promise.resolve({ success: false, reason: "no source image provided" });

  // STEP 4
  const ttsCfg = {
    ...cfg,
    ttsProvider: voiceConfig.provider,
    ...(voiceConfig.provider === "lucylab"
      ? { lucylabVoiceId: voiceConfig.voiceId }
      : { elevenlabsVoiceId: voiceConfig.voiceId }),
  };
  const ttsClient = createTtsClient(ttsCfg, { speed: voiceConfig.speed });
  // Concurrency: LucyLab requires 1 (only 1 concurrent export per key);
  // ElevenLabs supports parallel calls but we keep 1 by default to be polite.
  const limit = pLimit(cfg.ttsConcurrency);
  const voiceDir = join(outputDir, "voice");
  await mkdir(voiceDir, { recursive: true });

  const sceneAudioPromises = script.scenes.map((scene) =>
    limit(async () => {
      const out = join(voiceDir, `scene-${scene.id}.mp3`);
      const srtOut = join(voiceDir, `scene-${scene.id}.srt`);
      const txtOut = join(voiceDir, `scene-${scene.id}.txt`);

      // Normalize Vietnamese phonetics on-the-fly for TTS payload while keeping scene.voiceText intact
      const ttsPayload = normalizeVietnameseForTts(scene.voiceText);
      if (ttsPayload !== scene.voiceText) {
        log.info(`  scene ${scene.id}: normalized phonetics for TTS`);
      }

      // Format cache header with voice signature to invalidate if voice config changes
      const cacheSignature = `[voice:${voiceConfig.provider}:${voiceConfig.voiceId}:${voiceConfig.speed ?? 1.0}]`;
      const expectedCacheContent = `${cacheSignature}\n${ttsPayload.trim()}`;

      // IDEMPOTENT: skip TTS if voice file already exists AND text/voice content has not changed.
      // Strict verification: only reuse if companion .txt has matching voice signature and normalized text.
      let isCached = false;
      if (!options.forceTts && existsSync(out) && existsSync(txtOut)) {
        try {
          const cachedContent = (await readFile(txtOut, "utf8")).trim();
          const normCached = cachedContent.replace(/\r\n/g, "\n");
          const normExpected = expectedCacheContent.replace(/\r\n/g, "\n");
          if (normCached === normExpected) {
            isCached = true;
          }
        } catch {}
      }

      if (isCached) {
        const dur = await getDurationSec(out);
        log.info(`  scene ${scene.id}: REUSE existing mp3 (${dur.toFixed(2)}s) — voice & text unchanged`);
        return { id: scene.id, path: out, durationSec: dur };
      }

      log.info(`  TTS scene ${scene.id} (${ttsPayload.length} chars)...`);
      await ttsClient.generate(ttsPayload, out, srtOut);
      await writeFile(txtOut, expectedCacheContent, "utf8");
      const dur = await getDurationSec(out);
      log.info(`  scene ${scene.id}: ${dur.toFixed(2)}s`);
      return { id: scene.id, path: out, durationSec: dur };
    }),
  );

  const [imgResult, sceneAudio] = await Promise.all([
    imgPromise,
    Promise.all(sceneAudioPromises),
  ]);

  let bgImageRelPath: string | null = null;
  if (imgResult.success) {
    bgImageRelPath = "images/bg.jpg";
  } else {
    log.warn(`Background image fetch failed: ${imgResult.reason} → using gradient fallback`);
  }

  // Resolve "$images.<id>" references in scene templateData
  resolveSceneImageRefs(
    script.scenes,
    imageMap,
    bgImageRelPath,
    (sceneId, imageId) => log.warn(`  scene ${sceneId}: image ref "${imageId}" not found, removing imageSrc`)
  );

  // STEP 5
  log.step(5, TOTAL_STEPS, "Concat voice scenes + mix SFX layer");
  const voiceRawMp3 = join(outputDir, "voice-raw.mp3");
  const voiceMp3 = join(outputDir, "voice.mp3");
  await concatWithSilence(sceneAudio.map((a) => a.path), SCENE_GAP_SEC, voiceRawMp3);

  // Compute scene start times (cumulative voice durations + gaps)
  let cursor = 0;
  const sceneStarts: Record<string, number> = {};
  for (const a of sceneAudio) {
    sceneStarts[a.id] = cursor;
    cursor += a.durationSec + SCENE_GAP_SEC;
  }

  // Build SFX mix list using smart 3-tier selector
  const sfxIndex = indexSfxLibrary(SFX_DIR);
  const indexCats = Object.keys(sfxIndex).length;
  const indexFiles = Object.values(sfxIndex).reduce((s, a) => s + a.length, 0);
  log.info(`  SFX library: ${indexFiles} files in ${indexCats} categories`);

  const sfxList: SfxMixSpec[] = [];
  for (const scene of script.scenes) {
    const startSec = sceneStarts[scene.id];

    // Tier 1: explicit override in script.json
    if (scene.sfx) {
      if (scene.sfx.name === "none") {
        log.info(`  scene ${scene.id}: SFX disabled (explicit "none")`);
        continue;
      }
      const sfxPath = join(SFX_DIR, `${scene.sfx.name}.mp3`);
      if (existsSync(sfxPath)) {
        sfxList.push({ path: sfxPath, startSec: startSec + scene.sfx.startOffsetSec, volume: scene.sfx.volume });
        log.info(`  scene ${scene.id}: SFX override -> ${scene.sfx.name}.mp3`);
      } else {
        log.warn(`  scene ${scene.id}: explicit SFX not found, skipping: ${scene.sfx.name}.mp3`);
      }
      continue;
    }

    // Tier 2/3: smart selection by content + template
    const picked = pickSfxForScene({
      voiceText: scene.voiceText,
      templateName: scene.templateData.template,
      sceneId: scene.id,
      index: sfxIndex,
    });
    if (!picked) {
      log.warn(`  scene ${scene.id}: no SFX available (empty library?)`);
      continue;
    }

    const sfxPath = join(SFX_DIR, picked.relPath);
    const playback = defaultPlayback(picked);
    sfxList.push({ path: sfxPath, startSec: startSec + playback.offsetSec, volume: playback.volume });

    const why = picked.source === "semantic"
      ? `semantic match "${picked.matchedKeyword}"`
      : picked.source;
    log.info(`  scene ${scene.id}: SFX -> ${picked.relPath} (${why})`);
  }
  log.info(`  mixing ${sfxList.length} SFX into voice.mp3`);
  await mixSfxOntoVoice(voiceRawMp3, sfxList, voiceMp3);

  // Mix optional Background Music (BGM) with smart dynamic auto-ducking
  const bgmCandidate = options.bgm ?? (script as any).bgm;
  if (bgmCandidate && bgmCandidate !== "none") {
    let resolvedBgmPath: string | null = null;
    const directPath = resolve(outputDir, bgmCandidate);
    const assetPath = join(__dirname, "..", "assets", "bgm", bgmCandidate.endsWith(".mp3") ? bgmCandidate : `${bgmCandidate}.mp3`);
    if (existsSync(directPath)) {
      resolvedBgmPath = directPath;
    } else if (existsSync(assetPath)) {
      resolvedBgmPath = assetPath;
    } else if (existsSync(bgmCandidate)) {
      resolvedBgmPath = bgmCandidate;
    }

    if (resolvedBgmPath) {
      log.info(`  BGM detected: ${basename(resolvedBgmPath)} -> applying smart auto-ducking`);
      const voiceWithBgm = join(outputDir, "voice-ducked.mp3");
      await mixBgmWithDucking(voiceMp3, resolvedBgmPath, voiceWithBgm);
      await copyFile(voiceWithBgm, voiceMp3);
      log.info(`  BGM mixed successfully into voice.mp3 with auto-ducking`);
    } else {
      log.warn(`  BGM requested "${bgmCandidate}" but file was not found. Proceeding without BGM.`);
    }
  }

  const totalAudioSec = await getDurationSec(voiceMp3);
  log.info(`  voice.mp3 total: ${totalAudioSec.toFixed(2)}s`);
  if (totalAudioSec > DURATION_MAX_SEC) {
    throw new Error(`Total duration ${totalAudioSec.toFixed(1)}s exceeds maximum ${DURATION_MAX_SEC}s — reduce scene count or voice text`);
  }
  if (totalAudioSec < DURATION_MIN_SEC) {
    log.warn(`Total duration ${totalAudioSec.toFixed(1)}s is below ${DURATION_MIN_SEC}s minimum — video may be too short`);
  }
  if (totalAudioSec >= 48 && totalAudioSec <= 72) {
    log.info(`  Duration ${totalAudioSec.toFixed(1)}s — ideal for TikTok/Shorts`);
  } else if (totalAudioSec > 72) {
    log.info(`  Duration ${totalAudioSec.toFixed(1)}s — long-form video`);
  }

  // STEP 6 — Compose HTML + write hyperframes project files
  log.step(6, TOTAL_STEPS, "Compose HTML + project files");

  // Resolve TikTok avatar — download URL if provided, else copy bundled default
  // Bundled avatar can be jpg/jpeg/png/webp — pick whichever exists
  const findBundledAvatar = (): string => {
    const baseDir = join(__dirname, "..", "assets");
    for (const ext of ["jpg", "jpeg", "png", "webp"]) {
      const p = join(baseDir, `avatar.${ext}`);
      if (existsSync(p)) return p;
    }
    throw new Error(`No bundled avatar found. Place an image at assets/avatar.{jpg,png,webp}`);
  };
  const bundledAvatar = findBundledAvatar();
  const ttAvatarExt = bundledAvatar.split(".").pop()!.toLowerCase();
  const ttAvatarFile = `tiktok-avatar.${ttAvatarExt}`;
  const ttAvatarOut = join(outputDir, ttAvatarFile);
  if (cfg.tiktok.avatarUrl) {
    const r = await fetchImage(cfg.tiktok.avatarUrl, ttAvatarOut);
    if (!r.success) {
      log.warn(`TikTok avatar download failed: ${r.reason} → falling back to bundled default`);
      await copyFile(bundledAvatar, ttAvatarOut);
    }
  } else {
    await copyFile(bundledAvatar, ttAvatarOut);
  }

  const html = composeHtml({
    script,
    sceneAudio: sceneAudio.map((a) => ({ id: a.id, durationSec: a.durationSec })),
    gapSec: SCENE_GAP_SEC,
    bgImageRelPath,
    audioRelPath: "voice.mp3",
    tiktok: cfg.tiktok,
    tiktokAvatarRelPath: ttAvatarFile,
    outroHoldSec: OUTRO_HOLD_SEC,
  });

  // hyperframes expects: index.html (NOT composition.html), hyperframes.json, meta.json in DIR
  await writeFile(join(outputDir, "index.html"), html);

  await writeFile(join(outputDir, "hyperframes.json"), JSON.stringify(HYPERFRAMES_CONFIG, null, 2));

  const slug = basename(outputDir);
  await writeFile(join(outputDir, "meta.json"), JSON.stringify({
    id: slug,
    name: script.metadata.title,
    createdAt: new Date().toISOString(),
  }, null, 2));

  // Copy templates next to the index.html so relative paths resolve
  await copyFile(join(TPL_DIR, "styles.css"),    join(outputDir, "styles.css"));
  await copyFile(join(TPL_DIR, "animations.js"), join(outputDir, "animations.js"));

  // STEP 7
  const videoPath = join(outputDir, "video.mp4");
  if (options.skipRender) {
    log.step(7, TOTAL_STEPS, "Render with hyperframes (SKIPPED via --skip-render)");
    log.info(`  Video render skipped. HTML composition ready at: ${join(outputDir, "index.html")}`);
  } else {
    log.step(7, TOTAL_STEPS, `Render with hyperframes${options.draft ? " (draft mode: 15fps)" : ""}`);
    await renderWithHyperframes({
      compositionDir: outputDir,
      outputPath: videoPath,
      fps: options.draft ? 15 : 30,
      quality: options.draft ? "draft" : "standard",
    });
  }

  // STEP 8
  log.step(8, TOTAL_STEPS, "Done");
  console.log("\n=== Result ===");
  if (!options.skipRender) {
    console.log(`Video:  ${videoPath}`);
  } else {
    console.log(`Preview: ${join(outputDir, "index.html")}`);
  }
  console.log(`Audio:  ${voiceMp3}  (cho CapCut)`);
  console.log(`Script: ${join(outputDir, "script.txt")}  (cho CapCut auto-caption)`);
  console.log(`Tong thoi luong: ${totalAudioSec.toFixed(2)}s`);
}
