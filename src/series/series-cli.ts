import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { exec } from "node:child_process";
import axios from "axios";
import { BibleManager } from "../bible/bible-manager.js";
import { BudgetLedger } from "../orchestration/budget-ledger.js";
import { EpisodicPipeline } from "./episodic-pipeline.js";
import { startSeriesReviewServer } from "../review/server.js";
import type { BackendProvider } from "../gateway/video-gateway.js";
import { isFfmpegAvailable, runFfmpeg, runFfprobe } from "../media/ffmpeg.js";
import { RateCardManager } from "../orchestration/rate-card-manager.js";
import { normalizeScript } from "./script-normalizer.js";
import { StoryToScreenplayGenerator } from "./story-to-screenplay.js";
import { ConceptArtGenerator } from "./concept-art-generator.js";
import { SourceIngestionEngine, TextChunker, StoryAnalysisEngine } from "../novel/index.js";
import { SeriesPlanner } from "./series-planner.js";
import { CoverageLedgerManager } from "./coverage-ledger.js";
import { SeasonOrchestrator } from "../orchestration/season-orchestrator.js";
import { finalizeEpisodeProduction } from "./finalize-service.js";
import { log } from "../utils/logger.js";

function getArgValue(args: string[], flag: string, short?: string): string | undefined {
  const idx = args.findIndex((a) => a === flag || (short && a === short));
  if (idx >= 0 && args[idx + 1] && !args[idx + 1].startsWith("-")) {
    return args[idx + 1];
  }
  const inline = args.find((a) => a.startsWith(`${flag}=`));
  if (inline) {
    return inline.split("=")[1];
  }
  return undefined;
}

function hasFlag(args: string[], flag: string, short?: string): boolean {
  if (args.includes(flag) || (!!short && args.includes(short))) return true;
  for (const arg of args) {
    if (arg.startsWith(`${flag}=`)) {
      const val = arg.slice(flag.length + 1).toLowerCase();
      return val === "true" || val === "1" || val === "";
    }
  }
  return false;
}

function parseTransitionSec(subArgs: string[]): number | undefined {
  const transArg = getArgValue(subArgs, "--transition");
  if (transArg === undefined) return undefined;
  const val = parseFloat(transArg);
  return !isNaN(val) && val >= 0 ? val : undefined;
}

function resolveExecutionMode(subArgs: string[]): {
  dryRun: boolean;
  provider: BackendProvider;
  mockTts: boolean;
  skipRender: boolean;
  skipAudit: boolean;
  commitCanon: boolean;
} {
  const dryRun = hasFlag(subArgs, "--dry-run");
  const explicitProvider = getArgValue(subArgs, "--provider") as BackendProvider | undefined;
  if (dryRun && explicitProvider && explicitProvider !== "mock") {
    log.warn(
      `⚠️ [DRY-RUN MODE] Cờ --dry-run được chỉ định: chuyển provider '${explicitProvider}' sang 'mock' và bật mock TTS để ngăn chi phí API.`
    );
  }
  const provider: BackendProvider = dryRun ? "mock" : (explicitProvider || "local_comfyui");
  const mockTts = dryRun || hasFlag(subArgs, "--mock-tts");
  const skipRender = hasFlag(subArgs, "--skip-render");
  const skipAudit = hasFlag(subArgs, "--skip-audit");
  const rawCommitCanon = hasFlag(subArgs, "--commit-canon");
  if ((dryRun || provider === "mock" || skipRender) && rawCommitCanon) {
    log.warn(
      `⚠️ [CANON GUARD] Cờ --commit-canon bị bỏ qua vì đang chạy ở chế độ ${dryRun ? "dry-run" : provider === "mock" ? "mock" : "skip-render"}. Mock không được phép cập nhật Story Bible canon chính thức.`
    );
  }
  const commitCanon = (dryRun || provider === "mock" || skipRender) ? false : rawCommitCanon;

  return { dryRun, provider, mockTts, skipRender, skipAudit, commitCanon };
}

function resolveBiblePath(seriesId?: string, explicitBiblePath?: string): string {
  if (explicitBiblePath) return explicitBiblePath;
  if (seriesId) return join("data", "series", seriesId, "story_bible.db");
  return "story_bible.db";
}

export function printSeriesUsage(): void {
  console.log(`
🎬 Episodic AI Film Series CLI (Hệ Thống Làm Phim Dài Tập Bằng AI)

Lệnh chính:
  series:doctor     Kiểm tra môi trường hệ thống (FFmpeg, ffprobe, SQLite, GPU/ComfyUI)
  series:ingest     Nhập tiểu thuyết/kịch bản nguồn vào hệ thống với băm SHA-256 & chỉ mục
  series:analyze    Phân tích cấu trúc truyện: nhân vật, sự kiện beat, tuyến truyện, tri thức 4D
  series:plan-series Lập kế hoạch chuyển thể toàn bộ loạt phim N tập kèm coverage ledger
  series:plan-approve Phê duyệt và kích hoạt kế hoạch chuyển thể (draft -> active)
  series:season     Sản xuất hàng loạt toàn bộ mùa phim (Season) với điều phối tự động & resume
  series:finalize   Chốt tập phim chuẩn mực: kiểm tra take duyệt, chặn mock, QA gate và commit canon
  series:plan       Dự toán chi phí sản xuất kịch bản theo bảng giá rate card từng provider
  series:init       Khởi tạo series mới với phong cách mỹ thuật và thông số chuẩn
  series:character  Đăng ký hoặc cập nhật nhân vật (khuôn mặt, trang phục, giọng nói)
  series:gen-character-art Tự động vẽ ảnh concept art mẫu & mỏ neo khuôn mặt nhân vật
  series:location   Đăng ký hoặc cập nhật bối cảnh lặp lại (quán bar, phòng ngầm...)
  series:gen-location-art Tự động vẽ ảnh concept art bối cảnh kiến trúc
  series:prop       Đăng ký hoặc chuyển giao đạo cụ đặc biệt "không được quên"
  series:write-script Tự động biến prompt hoặc truyện thành kịch bản phân cảnh chuẩn điện ảnh
  series:episode    Sản xuất tập phim từ kịch bản text thô qua 8 bước tự động
  series:resume     Tiếp tục sản xuất tập phim dở dang từ checkpoint.json
  series:reroll     Tạo lại riêng một shot lỗi (--shot <shotId>) mà không sinh lại toàn bộ
  series:remux      Dựng lại video hoàn chỉnh từ các clip đã sinh mà không gọi lại AI
  series:review     Mở Web Review Dashboard để duyệt kịch bản phân cảnh và chọn take
  series:status     Xem báo cáo Story Bible: nhân vật, đạo cụ, lịch sử các tập & sổ cái ngân sách
  series:studio     Khởi chạy Full-Flow Web Studio UI (Dark Mode Cinema tại http://127.0.0.1:3456)
  series:jobs       Xem danh sách tác vụ provider (jobId, remoteId, trạng thái, chi phí)
  series:reconcile  Đối soát và xử lý các job bị timeout chưa xác định (uncertain_timeout)
  series:budget     Xem hoặc cập nhật hạn mức ngân sách chi tiêu cho series

Tùy chọn:
  --series <id>       ID (slug) của series (mặc định lưu tại data/series/<id>/story_bible.db)
  --episode <num>     Số thứ tự tập phim
  --shot <id>         ID cú máy cần tái tạo (cho lệnh series:reroll)
  --bible <path>      Đường dẫn trực tiếp đến file SQLite Story Bible
  --provider <name>   Video AI Provider ("mock" | "api_kling" | "api_veo" | "api_seedance" | "api_runway" | "local_comfyui")
  --resume            Tiếp tục từ checkpoint khi chạy series:episode
  --transition <sec>  Thời lượng chuyển cảnh chéo giữa các cú máy (giây, mặc định từ timeline/checkpoint)
  --dry-run           Chạy thử nghiệm nhanh với Mock Video & Mock TTS (không tốn phí API)
  --help, -h          Hiển thị hướng dẫn này

Ví dụ:
  npx tsx src/cli.ts series:init --series "cyber-saigon" --title "Sài Gòn 2088" --style "Cinematic 35mm, cyberpunk noir"
  npx tsx src/cli.ts series:character --series "cyber-saigon" --id "minh" --name "Minh" --role "protagonist" --face "assets/minh.jpg"
  npx tsx src/cli.ts series:location --series "cyber-saigon" --id "bar_hem_9" --name "Bar Hẻm 9" --summary "Quán bar ngầm đèn neon"
  npx tsx src/cli.ts series:prop --series "cyber-saigon" --id "chip" --name "Chip Lượng Tử" --holder "minh"
  npx tsx src/cli.ts series:episode --series "cyber-saigon" --script "scripts/ep1.txt" --provider mock
  npx tsx src/cli.ts series:status --series "cyber-saigon"
`);
}

export async function runSeriesCli(args: string[]): Promise<void> {
  const subCommand = args[0];
  const subArgs = args.slice(1);

  if (!subCommand || subCommand === "series:help" || hasFlag(subArgs, "--help", "-h")) {
    printSeriesUsage();
    return;
  }

  const seriesId = getArgValue(subArgs, "--series") || getArgValue(subArgs, "--id");
  const explicitBible = getArgValue(subArgs, "--bible");
  const biblePath = resolveBiblePath(seriesId, explicitBible);

  // Ensure parent directory exists for SQLite db
  if (biblePath !== ":memory:") {
    await mkdir(dirname(biblePath), { recursive: true });
  }

  const bible = new BibleManager(biblePath);

  switch (subCommand) {
    case "series:init": {
      const id = seriesId || "default-series";
      const title = getArgValue(subArgs, "--title") || id;
      const genre = getArgValue(subArgs, "--genre") || "Drama / Sci-Fi";
      const visualStyle =
        getArgValue(subArgs, "--style") ||
        "Cinematic 35mm, high contrast dramatic lighting, photorealistic 8k";
      const negativePrompt =
        getArgValue(subArgs, "--negative") ||
        "cartoon, anime, 3D render, low quality, deformed faces";
      const aspectRatio = (getArgValue(subArgs, "--ratio") as "9:16" | "16:9") || "9:16";

      bible.upsertSeriesMetadata({
        id,
        title,
        genre,
        visual_style: visualStyle,
        negative_prompt: negativePrompt,
        aspect_ratio: aspectRatio,
        fps: 30,
        created_at: new Date().toISOString(),
      });

      console.log(`\n✅ Khởi tạo thành công Series [${id}] tại ${biblePath}`);
      console.log(`   Tiêu đề: ${title} (${genre})`);
      console.log(`   Art Style: ${visualStyle}`);
      console.log(`   Tỷ lệ: ${aspectRatio}`);
      break;
    }

    case "series:character": {
      const charId = getArgValue(subArgs, "--id");
      const name = getArgValue(subArgs, "--name");
      if (!charId || !name) {
        console.error("❌ Lỗi: Cần cung cấp --id và --name cho nhân vật.");
        process.exit(2);
      }

      const role = (getArgValue(subArgs, "--role") as any) || "supporting";
      const summary = getArgValue(subArgs, "--summary") || `Nhân vật ${name}`;
      const faceImage = getArgValue(subArgs, "--face");
      const voice = getArgValue(subArgs, "--voice") || "lucylab:default";
      const marks = getArgValue(subArgs, "--marks");
      const wardrobeDesc = getArgValue(subArgs, "--wardrobe");

      bible.upsertCharacter({
        id: charId,
        name,
        role,
        visual_summary: summary,
        face_reference_image: faceImage,
        distinguishing_marks: marks,
        voice_profile_id: voice,
        status: "alive",
      });

      if (wardrobeDesc) {
        bible.upsertWardrobe({
          id: `wardrobe_${charId}_default`,
          character_id: charId,
          outfit_name: "Trang phục mặc định",
          visual_description: wardrobeDesc,
          is_default: 1,
        });
      }

      console.log(`\n✅ Đã lưu nhân vật: ${name} (ID: ${charId})`);
      console.log(`   Vai trò: ${role} | Giọng: ${voice}`);
      if (faceImage) console.log(`   Ảnh khuôn mặt chuẩn: ${faceImage}`);
      if (marks) console.log(`   Đặc điểm nhận dạng: ${marks}`);
      if (wardrobeDesc) console.log(`   Trang phục: ${wardrobeDesc}`);
      break;
    }

    case "series:location": {
      const locId = getArgValue(subArgs, "--id");
      const name = getArgValue(subArgs, "--name");
      const summary = getArgValue(subArgs, "--summary");
      if (!locId || !name || !summary) {
        console.error("❌ Lỗi: Cần cung cấp --id, --name và --summary cho địa điểm.");
        process.exit(2);
      }

      const lighting = getArgValue(subArgs, "--lighting");
      const rules = getArgValue(subArgs, "--rules");
      const image = getArgValue(subArgs, "--image");

      bible.upsertLocation({
        id: locId,
        name,
        visual_summary: summary,
        lighting_mood: lighting,
        atmospheric_rules: rules,
        reference_image_path: image,
      });

      console.log(`\n✅ Đã lưu địa điểm: ${name} (ID: ${locId})`);
      console.log(`   Mô tả bối cảnh: ${summary}`);
      if (lighting) console.log(`   Ánh sáng: ${lighting}`);
      break;
    }

    case "series:prop": {
      const propId = getArgValue(subArgs, "--id");
      const name = getArgValue(subArgs, "--name");
      const summary = getArgValue(subArgs, "--summary");
      if (!propId || !name || !summary) {
        console.error("❌ Lỗi: Cần cung cấp --id, --name và --summary cho đạo cụ.");
        process.exit(2);
      }

      const holder = getArgValue(subArgs, "--holder");
      const status = (getArgValue(subArgs, "--status") as any) || "intact";
      const image = getArgValue(subArgs, "--image");

      bible.upsertKeyProp({
        id: propId,
        name,
        visual_summary: summary,
        current_holder_id: holder,
        status,
        reference_image_path: image,
      });

      console.log(`\n✅ Đã lưu đạo cụ đặc biệt: ${name} (ID: ${propId})`);
      console.log(`   Chi tiết vật phẩm: ${summary}`);
      console.log(`   Người đang giữ: ${holder || "Chưa rõ"} | Trạng thái: ${status}`);
      break;
    }

    case "series:episode": {
      const scriptInput = getArgValue(subArgs, "--script");
      if (!scriptInput) {
        console.error("❌ Lỗi: Cần cung cấp --script <path_or_text>.");
        process.exit(2);
      }

      const { dryRun, provider, mockTts, skipRender, skipAudit, commitCanon } = resolveExecutionMode(subArgs);
      const resume = hasFlag(subArgs, "--resume");
      const hierarchical = hasFlag(subArgs, "--hierarchical");

      const pipeline = new EpisodicPipeline(biblePath);
      const res = await pipeline.produceEpisode(scriptInput, {
        seriesId,
        biblePath,
        provider,
        dryRun,
        mockTts,
        skipRender,
        skipAudit,
        resume,
        commitCanon,
        transitionDurationSec: parseTransitionSec(subArgs),
        useHierarchicalAssembly: hierarchical,
      });

      console.log("\n=======================================================");
      console.log(`🎉 HOÀN THÀNH SẢN XUẤT TẬP ${res.episodeNumber}: "${res.title}"`);
      console.log(`   Video: ${res.videoPath}`);
      console.log(`   Audio: ${res.audioPath}`);
      console.log(`   Thư mục xuất bản: ${res.outputDir}`);
      console.log("=======================================================\n");
      break;
    }

    case "series:write-script": {
      const idea = getArgValue(subArgs, "--idea") || getArgValue(subArgs, "--prompt");
      const storyPathOrText = getArgValue(subArgs, "--story");
      const outPath = getArgValue(subArgs, "--out");
      const epArg = getArgValue(subArgs, "--episode");
      const episodeNumber = epArg ? parseInt(epArg, 10) : undefined;
      const sId = seriesId || "default-series";
      const skipAudit = hasFlag(subArgs, "--skip-audit");

      let storyText = "";
      if (storyPathOrText) {
        if (existsSync(storyPathOrText)) {
          storyText = readFileSync(storyPathOrText, "utf8");
        } else {
          storyText = storyPathOrText;
        }
      }

      if (!idea && !storyText) {
        console.error("❌ Lỗi: Cần cung cấp --idea \"...\" hoặc --story <file_or_text>.");
        process.exit(2);
      }

      console.log(`\n✍️ [BIÊN KỊCH AI] Đang chuyển đổi ý tưởng/truyện thành kịch bản phân cảnh chuẩn điện ảnh...`);
      console.log(`   Series: [${sId}] | Story Bible: ${biblePath}`);

      const generator = new StoryToScreenplayGenerator(bible);
      const res = await generator.generateScreenplay({
        seriesId: sId,
        prompt: idea,
        storyText,
        episodeNumber,
        skipAudit,
      });

      console.log("\n=======================================================");
      console.log(`🎉 KỊCH BẢN ĐÃ TẠO XONG (${res.generatorUsed === "llm" ? "AI LLM" : "Rule-Based Offline Engine"})`);
      console.log(`   Tiêu đề: Tập ${res.script.episodeNumber}: ${res.script.title}`);
      console.log(`   Số cảnh: ${res.sceneCount} cảnh | Tổng số shot: ${res.shotCount} shots`);
      console.log(`   Thời lượng ước tính: ${res.estimatedDurationSec}s`);
      console.log(`   Nhân vật tham gia: ${res.charactersUsed.join(", ") || "N/A"}`);
      console.log(`   Đạo cụ sử dụng: ${res.propsUsed.join(", ") || "Không"}`);
      console.log("=======================================================\n");

      if (outPath) {
        await mkdir(dirname(outPath), { recursive: true });
        writeFileSync(outPath, res.rawScreenplay, "utf8");
        console.log(`💾 Kịch bản đã được lưu tại: ${outPath}`);
      } else {
        console.log(res.rawScreenplay);
      }
      break;
    }

    case "series:gen-character-art": {
      const charId = getArgValue(subArgs, "--char") || getArgValue(subArgs, "--id");
      const sId = seriesId || "default-series";
      if (!charId) {
        console.error("❌ Lỗi: Cần cung cấp --char <character_id>.");
        process.exit(2);
      }

      const promptOverride = getArgValue(subArgs, "--prompt");
      const outDir = getArgValue(subArgs, "--out");
      const { provider } = resolveExecutionMode(subArgs);

      console.log(`\n🎨 [T2I CONCEPT ART] Đang tạo hình ảnh chân dung mỏ neo cho nhân vật [${charId}]...`);
      const generator = new ConceptArtGenerator(bible);
      const res = await generator.generateCharacterConceptArt({
        seriesId: sId,
        characterId: charId,
        promptOverride,
        outputDir: outDir,
        provider: provider === "local_comfyui" ? "local_comfyui" : "mock",
      });

      console.log("\n=======================================================");
      console.log(`🎉 ẢNH CONCEPT ART ĐÃ ĐƯỢC TẠO VÀ LƯU TRỮ VĨNH VIỄN`);
      console.log(`   Nhân vật: ${res.entityId}`);
      console.log(`   Đường dẫn ảnh: ${res.imagePath} (${res.fileSizeBytes} bytes)`);
      console.log(`   Engine: ${res.providerUsed}`);
      console.log(`   Face Embedding: 512-D ArcFace vector đã khóa vào Story Bible.`);
      console.log("=======================================================\n");
      break;
    }

    case "series:gen-location-art": {
      const locId = getArgValue(subArgs, "--loc") || getArgValue(subArgs, "--id");
      const sId = seriesId || "default-series";
      if (!locId) {
        console.error("❌ Lỗi: Cần cung cấp --loc <location_id>.");
        process.exit(2);
      }

      const promptOverride = getArgValue(subArgs, "--prompt");
      const outDir = getArgValue(subArgs, "--out");
      const { provider } = resolveExecutionMode(subArgs);

      console.log(`\n🏛️ [T2I CONCEPT ART] Đang tạo hình ảnh bối cảnh mẫu cho [${locId}]...`);
      const generator = new ConceptArtGenerator(bible);
      const res = await generator.generateLocationConceptArt({
        seriesId: sId,
        locationId: locId,
        promptOverride,
        outputDir: outDir,
        provider: provider === "local_comfyui" ? "local_comfyui" : "mock",
      });

      console.log("\n=======================================================");
      console.log(`🎉 ẢNH BỐI CẢNH ĐÃ ĐƯỢC TẠO VÀ LƯU TRỮ VĨNH VIỄN`);
      console.log(`   Địa điểm: ${res.entityId}`);
      console.log(`   Đường dẫn ảnh: ${res.imagePath} (${res.fileSizeBytes} bytes)`);
      console.log(`   Engine: ${res.providerUsed}`);
      console.log("=======================================================\n");
      break;
    }

    case "series:resume": {
      const epArg = getArgValue(subArgs, "--episode");
      let scriptInput = getArgValue(subArgs, "--script");

      const sId = seriesId || "default-series";
      if (!scriptInput && epArg) {
        const epNumStr = String(parseInt(epArg, 10)).padStart(2, "0");
        const defaultScriptPath = join("output", "series", sId, `ep-${epNumStr}`, "script-normalized.json");
        if (existsSync(defaultScriptPath)) {
          scriptInput = defaultScriptPath;
        }
      }

      if (!scriptInput) {
        console.error("❌ Lỗi: Cần cung cấp --script <path> hoặc --episode <num> (để tìm kịch bản đã lưu).");
        process.exit(2);
      }

      const { dryRun, provider, mockTts, skipRender, skipAudit, commitCanon } = resolveExecutionMode(subArgs);

      console.log(`\n🔄 [RESUME] Đang tiếp tục sản xuất từ checkpoint...`);
      const pipeline = new EpisodicPipeline(biblePath);
      const res = await pipeline.produceEpisode(scriptInput, {
        seriesId: sId,
        biblePath,
        provider,
        dryRun,
        mockTts,
        skipRender,
        skipAudit,
        resume: true,
        commitCanon,
        transitionDurationSec: parseTransitionSec(subArgs),
      });

      console.log("\n=======================================================");
      console.log(`🎉 HOÀN THÀNH TIẾP TỤC TẬP ${res.episodeNumber}: "${res.title}"`);
      console.log(`   Video: ${res.videoPath}`);
      console.log(`   Audio: ${res.audioPath}`);
      console.log(`   Thư mục: ${res.outputDir}`);
      console.log("=======================================================\n");
      break;
    }

    case "series:reroll": {
      const shotId = getArgValue(subArgs, "--shot");
      const epArg = getArgValue(subArgs, "--episode");
      if (!shotId) {
        console.error("❌ Lỗi: Cần cung cấp --shot <shotId> (ví dụ: --shot sc1_sh2).");
        process.exit(2);
      }

      const episodeNumber = epArg ? parseInt(epArg, 10) : 1;
      const sId = seriesId || "default-series";
      const { dryRun, provider } = resolveExecutionMode(subArgs);
      const promptOverride = getArgValue(subArgs, "--prompt");
      const noRemux = hasFlag(subArgs, "--no-remux");
      const transitionDurationSec = parseTransitionSec(subArgs);

      console.log(`\n🎲 [REROLL] Tạo lại riêng shot [${shotId}] cho tập ${episodeNumber}...`);
      const pipeline = new EpisodicPipeline(biblePath);
      const res = await pipeline.rerollShot({
        seriesId: sId,
        episodeNumber,
        shotId,
        provider,
        dryRun,
        promptOverride,
        remuxAfterReroll: !noRemux,
        transitionDurationSec,
      });

      console.log("\n=======================================================");
      console.log(`🎉 HOÀN TẤT TÁI TẠO SHOT [${res.shotId}]`);
      console.log(`   Take mới: ${res.takeId}`);
      console.log(`   Video: ${res.videoPath}`);
      console.log("=======================================================\n");
      break;
    }

    case "series:remux": {
      const epArg = getArgValue(subArgs, "--episode");
      const episodeNumber = epArg ? parseInt(epArg, 10) : 1;
      const sId = seriesId || "default-series";
      const skipRender = hasFlag(subArgs, "--skip-render");
      const transitionDurationSec = parseTransitionSec(subArgs);

      console.log(`\n🎞️ [REMUX] Dựng lại video tập ${episodeNumber} từ các clip đã có...`);
      const pipeline = new EpisodicPipeline(biblePath);
      const res = await pipeline.remuxEpisode({
        seriesId: sId,
        episodeNumber,
        skipRender,
        transitionDurationSec,
      });

      console.log("\n=======================================================");
      console.log(`🎉 HOÀN TẤT DỰNG LẠI VIDEO TẬP ${episodeNumber}`);
      console.log(`   Video: ${res.videoPath}`);
      console.log(`   Audio: ${res.audioPath}`);
      console.log("=======================================================\n");
      break;
    }

    case "series:review": {
      const epArg = getArgValue(subArgs, "--episode");
      const episodeNumber = epArg ? parseInt(epArg, 10) : 1;
      const sId = seriesId || "default-series";
      const epNumStr = String(episodeNumber).padStart(2, "0");
      const scriptPath =
        getArgValue(subArgs, "--script") ||
        join("output", "series", sId, `ep-${epNumStr}`, "script-normalized.json");

      let script: any = null;
      if (existsSync(scriptPath)) {
        try {
          script = JSON.parse(await readFile(scriptPath, "utf8"));
        } catch {}
      }
      if (!script) {
        script = {
          seriesId: sId,
          episodeNumber,
          title: `Tập ${episodeNumber}`,
          scenes: [],
        };
      }

      const port = parseInt(getArgValue(subArgs, "--port") || "3001", 10);
      const server = startSeriesReviewServer({
        script,
        biblePath,
        seriesId: sId,
        episodeNumber,
        outputDir: join("output", "series", sId, `ep-${epNumStr}`),
        port,
        autoOpen: !hasFlag(subArgs, "--no-open"),
      });

      await server;
      break;
    }

    case "series:status": {
      const meta = bible.getSeriesMetadata();
      const chars = bible.listCharacters();
      const locations = bible.listLocations();
      const props = bible.listKeyProps();
      const history = bible.getCanonHistory();

      console.log("\n=======================================================");
      console.log(`📖 BÁO CÁO STORY BIBLE: [${meta?.id || seriesId || "Unknown"}]`);
      console.log("=======================================================");
      if (meta) {
        console.log(`Tên Series:       ${meta.title} (${meta.genre || "N/A"})`);
        console.log(`Phong cách đồ họa: ${meta.visual_style}`);
        console.log(`Tỷ lệ khung hình: ${meta.aspect_ratio} | FPS: ${meta.fps}`);
      } else {
        console.log("Chưa khởi tạo metadata series (chạy `series:init` để khởi tạo).");
      }

      console.log(`\n🎭 Nhân Vật (${chars.length}):`);
      for (const c of chars) {
        const wardrobe = bible.getCharacterWardrobe(c.id);
        console.log(`  - [${c.id}] ${c.name} (${c.role}) - Trạng thái: ${c.status}`);
        if (c.distinguishing_marks) console.log(`    + Dấu hiệu đặc biệt: ${c.distinguishing_marks}`);
        if (c.face_reference_image) console.log(`    + Ảnh mặt chuẩn: ${c.face_reference_image}`);
        if (wardrobe) console.log(`    + Trang phục: ${wardrobe.visual_description}`);
      }

      console.log(`\n📍 Bối Cảnh / Địa Điểm (${locations.length}):`);
      for (const l of locations) {
        console.log(`  - [${l.id}] ${l.name}: ${l.visual_summary}`);
      }

      console.log(`\n🗝️ Đạo Cụ Đặc Biệt "Không Được Quên" (${props.length}):`);
      for (const p of props) {
        console.log(`  - [${p.id}] ${p.name} [${p.status}]: Người giữ hiện tại: ${p.current_holder_id || "Không ai"}`);
      }

      console.log(`\n🎬 Lịch Sử Các Tập Đã Sản Xuất (${history.length}):`);
      for (const ep of history) {
        console.log(`  - Tập ${ep.episode_number}: "${ep.title}" (${ep.created_at})`);
        console.log(`    Logline: ${ep.logline}`);
      }

      const effectiveSeriesId = meta?.id || seriesId || "default-series";
      const takesSummary = bible.getSeriesCostAndTakesSummary(effectiveSeriesId);
      console.log(`\n💰 Thống Kê Shot Takes & Chi Phí Sản Xuất (${effectiveSeriesId}):`);
      console.log(`  - Tổng số take đã sinh: ${takesSummary.totalTakes} (Đã duyệt: ${takesSummary.approvedTakes})`);
      console.log(`  - Tổng chi phí API ước tính: $${takesSummary.totalCostUsd.toFixed(4)} USD`);
      if (takesSummary.episodes.length > 0) {
        for (const ep of takesSummary.episodes) {
          console.log(`    + Tập ${ep.episodeNumber}: ${ep.takeCount} takes (${ep.approvedCount} đã duyệt) - $${ep.costUsd.toFixed(4)} USD`);
        }
      }

      // 4-State Budget Ledger Display (Requirement 8 & 9)
      const ledger = bible.getSeriesBudgetLedger(effectiveSeriesId);
      console.log(`\n📊 SỔ CÁI CHI PHÍ 4 TRẠNG THÁI & NGÂN SÁCH BẢO VỆ (${effectiveSeriesId}):`);
      console.log(`  - Hạn mức ngân sách tối đa (Budget Cap): $${ledger.maxBudgetUsd.toFixed(4)} USD`);
      console.log(`  - Tổng cam kết (Committed):             $${ledger.totalCommittedUsd.toFixed(4)} USD`);
      console.log(`  - Số dư khả dụng (Available):           $${ledger.remainingAvailableUsd.toFixed(4)} USD`);
      console.log(`  - Chi tiết các trạng thái chi phí:`);
      console.log(`    + Đã giữ chỗ (Reserved):     $${ledger.reservedCostUsd.toFixed(4)} USD`);
      console.log(`    + Đã xác nhận (Confirmed):   $${ledger.confirmedCostUsd.toFixed(4)} USD`);
      console.log(`    + Chưa xác định (Uncertain): $${ledger.uncertainCostUsd.toFixed(4)} USD`);

      const pendingJobs = bible.listPendingJobsForSeries(effectiveSeriesId) || [];
      const uncertainJobs = pendingJobs.filter((j) => j.status === "uncertain_timeout");
      if (uncertainJobs.length > 0) {
        console.log(`\n⚠️  CẢNH BÁO: Có ${uncertainJobs.length} job(s) ở trạng thái 'uncertain_timeout' đang treo ngân sách:`);
        for (const uj of uncertainJobs) {
          console.log(`    * Job [${uj.id}] (Provider: ${uj.provider}, RemoteID: ${uj.provider_job_id || "chưa rõ"}): Chi phí treo $${uj.uncertain_cost_usd.toFixed(4)} USD`);
          console.log(`      Lỗi: ${uj.error_message || "Timeout submit"}`);
        }
        console.log(`    -> Hãy chạy lệnh \`series:reconcile --series ${effectiveSeriesId}\` để đối soát và giải phóng.`);
      }
      console.log("=======================================================\n");
      break;
    }

    case "series:jobs": {
      const epArg = getArgValue(subArgs, "--episode");
      const statusFilter = getArgValue(subArgs, "--status");
      const sId = seriesId || "default-series";
      const epNum = epArg ? parseInt(epArg, 10) : undefined;

      const jobs = bible.listPendingJobsForSeries(sId, epNum);
      console.log(`\n📋 DANH SÁCH PROVIDER JOBS (${sId}${epNum ? ` - Tập ${epNum}` : ""}):`);
      if (jobs.length === 0) {
        console.log("  Không có job nào đang chờ xử lý.");
      } else {
        for (const j of jobs) {
          if (statusFilter && j.status !== statusFilter) continue;
          console.log(`  - [${j.id}] Trạng thái: ${j.status.toUpperCase()} | Shot: ${j.shot_id} | Provider: ${j.provider}`);
          console.log(`    Remote Job ID: ${j.provider_job_id || "None"} | Attempts: ${j.attempt_count}/${j.max_attempts}`);
          console.log(`    Spec Hash: ${j.spec_hash.slice(0, 16)}... | Chi phí: Est $${j.estimated_cost_usd} / Res $${j.reserved_cost_usd} / Conf $${j.confirmed_cost_usd}`);
          if (j.error_message) console.log(`    Lỗi: ${j.error_message}`);
        }
      }
      console.log("");
      break;
    }

    case "series:reconcile": {
      const jobId = getArgValue(subArgs, "--job");
      const rawAction = getArgValue(subArgs, "--action") || "discard";
      let resolution: "confirmed_success" | "confirmed_no_charge" | "confirmed_billed_failure";
      if (rawAction === "confirm" || rawAction === "confirmed_success") {
        resolution = "confirmed_success";
      } else if (rawAction === "fail" || rawAction === "confirmed_billed_failure") {
        resolution = "confirmed_billed_failure";
      } else {
        resolution = "confirmed_no_charge";
      }
      const costArg = getArgValue(subArgs, "--cost");
      const finalCost = costArg ? parseFloat(costArg) : undefined;
      const details = finalCost !== undefined ? { actualCostUsd: finalCost } : undefined;
      const sId = seriesId || "default-series";

      const ledger = new BudgetLedger(bible);
      if (jobId) {
        console.log(`\n🔍 [RECONCILE] Đang đối soát job [${jobId}] với hành động '${resolution}'...`);
        const updated = ledger.reconcileUncertainJob(jobId, resolution, details);
        console.log(`✅ Đã cập nhật job [${updated.id}]: Trạng thái mới: ${updated.status}. Chi phí xác nhận: $${updated.confirmed_cost_usd.toFixed(4)} USD.`);
      } else {
        const pending = bible.listPendingJobsForSeries(sId);
        const uncertainJobs = pending.filter((j) => j.status === "uncertain_timeout");
        console.log(`\n🔍 [RECONCILE] Tìm thấy ${uncertainJobs.length} job(s) 'uncertain_timeout' cần đối soát:`);
        if (uncertainJobs.length === 0) {
          console.log("  Không có job nào cần đối soát.");
        } else {
          for (const uj of uncertainJobs) {
            console.log(`  - Đang xử lý job [${uj.id}] (Remote: ${uj.provider_job_id || "none"})...`);
            ledger.reconcileUncertainJob(uj.id, resolution, details);
          }
          console.log(`✅ Đã hoàn tất đối soát ${uncertainJobs.length} job(s). Ngân sách đã được đồng bộ hóa.`);
        }
      }
      break;
    }

    case "series:budget": {
      const sId = seriesId || "default-series";
      const setMax = getArgValue(subArgs, "--set-max");
      if (setMax) {
        const maxVal = parseFloat(setMax);
        bible.setSeriesBudget(sId, maxVal);
        console.log(`\n✅ Đã cập nhật hạn mức ngân sách series [${sId}] thành: $${maxVal.toFixed(2)} USD`);
      } else {
        const l = bible.getSeriesBudgetLedger(sId);
        console.log(`\n💰 NGÂN SÁCH SERIES [${sId}]:`);
        console.log(`  - Hạn mức tối đa: $${l.maxBudgetUsd.toFixed(2)} USD`);
        console.log(`  - Tổng cam kết:   $${l.totalCommittedUsd.toFixed(4)} USD`);
        console.log(`  - Còn lại:        $${l.remainingAvailableUsd.toFixed(4)} USD`);
      }
      break;
    }

    case "series:doctor": {
      console.log("\n=======================================================");
      console.log("🩺 KIỂM TRA MÔI TRƯỜNG HỆ THỐNG (SERIES DOCTOR)");
      console.log("=======================================================\n");

      // 1. FFmpeg & FFprobe
      const ffmpegOk = await isFfmpegAvailable();
      if (ffmpegOk) {
        try {
          const vOut = await runFfmpeg(["-version"]);
          const firstLine = vOut.split("\n")[0]?.trim() || "OK";
          console.log(`✅ FFmpeg: Sẵn sàng (${firstLine})`);
        } catch {
          console.log(`⚠️ FFmpeg: Không khả dụng hoặc lỗi thực thi`);
        }
        try {
          const pOut = await runFfprobe(["-version"]);
          const firstLine = pOut.split("\n")[0]?.trim() || "OK";
          console.log(`✅ FFprobe: Sẵn sàng (${firstLine})`);
        } catch {
          console.log(`⚠️ FFprobe: Không khả dụng hoặc lỗi thực thi`);
        }
      } else {
        console.log("⚠️ FFmpeg / FFprobe: Không tìm thấy trên PATH hệ thống.");
        console.log("   -> Pipeline sẽ chạy ở chế độ mô phỏng (mock media).");
        console.log("   -> Để render video thật: hãy cài đặt FFmpeg và thêm vào PATH.");
      }

      // 2. SQLite Database
      try {
        const b = new BibleManager(biblePath);
        const meta = b.getSeriesMetadata(seriesId);
        const chars = b.listCharacters();
        console.log(`\n✅ SQLite Database: Sẵn sàng (${biblePath})`);
        console.log(
          `   Series hiện tại: [${meta?.id || seriesId || "default-series"}] - ${chars.length} nhân vật đã khai báo`
        );
      } catch (dbErr: any) {
        console.log(`\n❌ SQLite Database: Lỗi (${dbErr.message})`);
      }

      // 3. Local ComfyUI Server (GPU)
      const host = process.env.COMFYUI_HOST || "127.0.0.1";
      const port = process.env.COMFYUI_PORT || "8188";
      const comfyUrl = process.env.COMFYUI_BASE_URL || `http://${host}:${port}`;
      try {
        const comfyRes = await axios.get(`${comfyUrl}/system_stats`, { timeout: 3000 });
        const devices = comfyRes.data?.devices;
        if (devices && Array.isArray(devices) && devices.length > 0) {
          const dev = devices[0];
          const vramGb = dev.vram_total
            ? (dev.vram_total / (1024 * 1024 * 1024)).toFixed(1)
            : "N/A";
          console.log(`\n✅ Local ComfyUI: Đang chạy tại ${comfyUrl}`);
          console.log(`   GPU: ${dev.name || "Unknown"} | VRAM: ${vramGb} GB`);
        } else {
          console.log(`\n✅ Local ComfyUI: Đang chạy tại ${comfyUrl}`);
        }
      } catch {
        console.log(`\nℹ️ Local ComfyUI: Chưa kết nối tại ${comfyUrl}`);
        console.log("   -> Khởi động ComfyUI (Wan 2.1/2.2) trên GPU nếu muốn tạo video 0-cost.");
      }

      // 4. Cloud AI Video Providers
      const providers = [
        { name: "Kling AI", envKey: "KLING_API_KEY", set: !!process.env.KLING_API_KEY },
        { name: "Runway Gen-3", envKey: "RUNWAY_API_KEY", set: !!process.env.RUNWAY_API_KEY },
        { name: "Google Veo", envKey: "VEO_API_KEY", set: !!process.env.VEO_API_KEY },
        { name: "Seedance", envKey: "SEEDANCE_API_KEY", set: !!process.env.SEEDANCE_API_KEY },
        { name: "Wan 2.2 API", envKey: "WAN_API_KEY", set: !!process.env.WAN_API_KEY },
      ];
      console.log("\n🌐 Cổng Cloud AI Video Providers:");
      for (const p of providers) {
        if (p.set) {
          console.log(`   ✅ ${p.name}: Đã cấu hình (${p.envKey})`);
        } else {
          console.log(`   ⚪ ${p.name}: Chưa cấu hình (${p.envKey})`);
        }
      }

      // 5. Audio & TTS Providers
      console.log("\n🔊 Bộ Lồng Tiếng TTS:");
      const elKey = !!process.env.ELEVENLABS_API_KEY;
      const lucyKey = !!process.env.LUCYLAB_API_KEY;
      if (elKey) {
        console.log("   ✅ ElevenLabs: Đã cấu hình API key");
      } else {
        console.log("   ⚪ ElevenLabs: Chưa cấu hình (ELEVENLABS_API_KEY)");
      }
      if (lucyKey) {
        console.log("   ✅ LucyLab: Đã cấu hình API key");
      } else {
        console.log("   ⚪ LucyLab: Chưa cấu hình (LUCYLAB_API_KEY)");
      }

      console.log("\n=======================================================");
      console.log("🏁 Hoàn tất kiểm tra môi trường hệ thống.\n");
      break;
    }

    case "series:plan": {
      const scriptInput = getArgValue(subArgs, "--script");
      if (!scriptInput) {
        console.error("❌ Lỗi: Cần cung cấp --script <path_or_text> để dự toán chi phí.");
        process.exit(2);
      }

      let rawContent = scriptInput;
      if (existsSync(scriptInput)) {
        rawContent = await readFile(scriptInput, "utf8");
      }

      let script: any;
      try {
        script = await normalizeScript(rawContent, bible, { skipAudit: true });
      } catch (err: any) {
        console.error(`❌ Lỗi chuẩn hóa kịch bản: ${err.message}`);
        process.exit(1);
      }

      const rateManager = new RateCardManager(bible);
      rateManager.seedDefaultRatesIfEmpty();

      const totalScenes = script.scenes.length;
      const totalShots = script.scenes.reduce((acc: number, s: any) => acc + s.shots.length, 0);
      const totalDurationSec = script.scenes.reduce(
        (acc: number, s: any) =>
          acc + s.shots.reduce((a: number, sh: any) => a + (sh.durationSec || 4.0), 0),
        0
      );
      const totalDialogueCount = script.scenes.reduce(
        (acc: number, s: any) => acc + s.shots.reduce((a: number, sh: any) => a + (sh.dialogues?.length || 0), 0),
        0
      );

      const targetSeriesId = seriesId || script.seriesId || "default-series";
      const sBudget = bible.getSeriesBudgetLedger(targetSeriesId);
      const budgetCapArg = getArgValue(subArgs, "--budget") || getArgValue(subArgs, "--budget-cap");
      const budgetCap = budgetCapArg ? parseFloat(budgetCapArg) : sBudget.maxBudgetUsd;

      console.log("\n=======================================================");
      console.log(`📋 BẢNG DỰ TOÁN KỊCH BẢN & CHI PHÍ SẢN XUẤT`);
      console.log(`   Tập ${script.episodeNumber}: "${script.title}" (Series: ${targetSeriesId})`);
      console.log("=======================================================");
      console.log(`🎞️ Tổng số cảnh (Scenes):     ${totalScenes}`);
      console.log(`🎬 Tổng số shot cú máy:       ${totalShots}`);
      console.log(`⏱️ Tổng thời lượng video:     ${totalDurationSec.toFixed(1)} giây (~${(totalDurationSec / 60).toFixed(2)} phút)`);
      console.log(`💬 Tổng số câu thoại TTS:     ${totalDialogueCount}`);
      console.log(`💰 Ngân sách khả dụng/trần:   $${budgetCap.toFixed(2)} USD\n`);

      const providersToCompare = [
        { id: "local_comfyui", name: "Local ComfyUI (Wan 2.1/2.2)", model: "wan2.2_local" },
        { id: "api_kling", name: "Kling AI Standard (1080p)", model: "kling-v2" },
        { id: "api_runway", name: "Runway Gen-3 Alpha Turbo", model: "gen3a_turbo" },
        { id: "api_veo", name: "Google Veo 3.1 Cinematic", model: "veo-3.1" },
        { id: "api_wan", name: "Wan 2.2 Cloud API", model: "wan-2.2" },
        { id: "api_seedance", name: "Seedance 2.0 Fast Tier", model: "seedance-2.0" },
        { id: "mock", name: "Simulator / Mock Test", model: "simulator" },
      ];

      console.log("┌─────────────────────────────┬───────────┬──────────────┬──────────────┬─────────────┐");
      console.log("│ Provider / Model            │ Đơn giá/s │ Chi phí pass │ +30% Rerolls │ Khả thi     │");
      console.log("├─────────────────────────────┼───────────┼──────────────┼──────────────┼─────────────┤");

      for (const p of providersToCompare) {
        const rate = rateManager.resolveRate(p.id, p.model);
        const baseCost = rate.ratePerSecUsd * totalDurationSec;
        const rerollCost = baseCost * 1.3;
        const isFeasible = budgetCap >= rerollCost;
        const statusStr = rate.ratePerSecUsd === 0 ? "MIỄN PHÍ" : isFeasible ? "✅ ĐỦ TIỀN" : "❌ VƯỢT TRẦN";

        const namePad = p.name.padEnd(27, " ");
        const ratePad = `$${rate.ratePerSecUsd.toFixed(2)}/s`.padStart(9, " ");
        const basePad = `$${baseCost.toFixed(2)}`.padStart(12, " ");
        const rerollPad = `$${rerollCost.toFixed(2)}`.padStart(12, " ");
        const statusPad = statusStr.padEnd(11, " ");

        console.log(`│ ${namePad} │ ${ratePad} │ ${basePad} │ ${rerollPad} │ ${statusPad} │`);
      }
      console.log("└─────────────────────────────┴───────────┴──────────────┴──────────────┴─────────────┘");
      console.log("\n💡 Gợi ý chiến lược sản xuất:");
      console.log("   1. Dùng `local_comfyui` để sinh toàn bộ shot ban đầu (chi phí $0).");
      console.log("   2. Chỉ reroll bằng `api_kling` hoặc `api_runway` cho những shot nhân vật chính thất bại Visual QA.");
      console.log("=======================================================\n");
      break;
    }

    case "series:studio": {
      const port = parseInt(getArgValue(subArgs, "--port") || "3456", 10);
      const host = getArgValue(subArgs, "--host") || "127.0.0.1";
      const noOpen = hasFlag(subArgs, "--no-open");

      try {
        const { StudioServer } = await import("../server/studio-server.js");
        const studio = new StudioServer({ port, host });
        const url = await studio.start();

        console.log("\n=======================================================");
        console.log("🎬 AUTO-CREATE-VIDEO: FULL-FLOW WEB STUDIO SẴN SÀNG");
        console.log(`   URL Studio:    ${url}`);
        console.log(`   Port:          ${port}`);
        console.log("   Trạng thái:    Đang lắng nghe (Nhấn Ctrl+C để dừng)");
        console.log("=======================================================\n");

        if (!noOpen) {
          const cmd =
            process.platform === "win32"
              ? `start "" "${url}"`
              : process.platform === "darwin"
              ? `open "${url}"`
              : `xdg-open "${url}"`;
          exec(cmd, () => {});
        }
      } catch (err: any) {
        if (err?.code === "EADDRINUSE" || err?.message?.includes("EADDRINUSE")) {
          console.error(`\n❌ Lỗi: Cổng ${port} đã có tiến trình khác sử dụng (EADDRINUSE).`);
          console.error(`💡 Hướng dẫn xử lý:`);
          console.error(`   1. Chạy trên cổng khác: npm run studio -- --port ${port + 1}`);
          console.error(`   2. Hoặc giải phóng cổng ${port}:`);
          console.error(`      - PowerShell: Stop-Process -Id (Get-NetTCPConnection -LocalPort ${port}).OwningProcess -Force`);
          console.error(`      - CMD: netstat -ano | findstr :${port} (sau đó taskkill /F /PID <PID>)\n`);
        } else {
          console.error(`\n❌ Không thể khởi động Studio Server: ${err?.message || err}\n`);
        }
        process.exit(1);
      }
      break;
    }

    case "series:ingest": {
      if (!seriesId) {
        console.error("❌ Lỗi: Cần cung cấp --series <seriesId>.");
        process.exit(2);
      }
      const inputFile = getArgValue(subArgs, "--input") || getArgValue(subArgs, "-i");
      const inputText = getArgValue(subArgs, "--text");
      const title = getArgValue(subArgs, "--title") || "Tác phẩm chuyển thể";
      const author = getArgValue(subArgs, "--author");
      const sourceType = (getArgValue(subArgs, "--type") as any) || "novel";

      if (!inputFile && !inputText) {
        console.error("❌ Lỗi: Cần cung cấp --input <path> hoặc --text <content>.");
        process.exit(2);
      }

      let rawContent = "";
      if (inputFile) {
        if (!existsSync(inputFile)) {
          console.error(`❌ File nguồn không tồn tại: ${inputFile}`);
          process.exit(2);
        }
        rawContent = readFileSync(inputFile, "utf8");
      } else {
        rawContent = inputText!;
      }

      console.log(`\n📚 Đang nhập tác phẩm nguồn: "${title}" vào Series '${seriesId}'...`);
      const ingestion = SourceIngestionEngine.ingestSourceText(
        rawContent,
        {
          seriesId,
          title,
          author,
          sourceType,
        },
        bible
      );

      console.log(`✅ Đã lưu tác phẩm nguồn: ${ingestion.work.id}`);
      console.log(`   Phiên bản revision:   ${ingestion.work.current_revision}`);
      console.log(`   SHA-256 content hash: ${ingestion.work.content_hash}`);

      // Chunk into units & blocks
      const units = TextChunker.splitIntoUnits(
        ingestion.work.normalized_text,
        ingestion.work.id,
        seriesId,
        ingestion.work.current_revision
      );
      bible.batchUpsertSourceUnits(units);

      const blocks: any[] = [];
      for (const u of units) {
        blocks.push(...TextChunker.splitIntoBlocks(u, seriesId, ingestion.work.current_revision));
      }
      bible.batchUpsertSourceBlocks(blocks);

      const coverage = TextChunker.verifyContentCoverage(
        ingestion.work.normalized_text,
        units
      );

      console.log(`   Số đơn vị (chương):   ${units.length}`);
      console.log(`   Số khối đoạn văn:     ${blocks.length}`);
      console.log(`   Zero-loss coverage:   ${coverage.hasZeroLoss ? "✅ BẢO TOÀN 100%" : "⚠️ CÓ KHOẢNG TRỐNG"}`);
      break;
    }

    case "series:analyze": {
      if (!seriesId) {
        console.error("❌ Lỗi: Cần cung cấp --series <seriesId>.");
        process.exit(2);
      }

      const explicitSource = getArgValue(subArgs, "--source");
      let sourceWork = explicitSource ? bible.getSourceWork(explicitSource) : null;
      if (!sourceWork) {
        const works = bible.listSourceWorks(seriesId);
        if (works.length > 0) sourceWork = works[0];
      }

      if (!sourceWork) {
        console.error(`❌ Không tìm thấy tác phẩm nguồn nào cho series '${seriesId}'. Hãy chạy 'series:ingest' trước.`);
        process.exit(2);
      }

      const units = bible.listSourceUnits(sourceWork.id);
      const blocks = bible.listSourceBlocks(sourceWork.id);

      console.log(`\n🔍 Đang phân tích câu chuyện: "${sourceWork.title}" (${units.length} chương, ${blocks.length} đoạn)...`);

      const analysis = await StoryAnalysisEngine.analyzeWork(
        sourceWork,
        units,
        blocks,
        bible,
        {
          seriesId,
          sourceId: sourceWork.id,
        }
      );

      console.log(`✅ Phân tích hoàn tất:`);
      console.log(
        `   Nhân vật phát hiện:   ${analysis.characters.length} (nhân vật chính: ${
          analysis.characters.filter((c) => c.role === "protagonist").map((c) => c.name).join(", ") || "N/A"
        })`
      );
      console.log(
        `   Nhịp truyện (beats):  ${analysis.beats.length} (${
          analysis.beats.filter((b) => b.is_flashback === 1).length
        } hồi tưởng)`
      );
      console.log(`   Tuyến truyện:         ${analysis.threads.length} (${analysis.threads.map((t) => t.name).join(", ")})`);
      console.log(
        `   Trạng thái tri thức:  ${analysis.knowledgeStates.length} bản ghi (nguồn, cải biên, nhân vật, khán giả)`
      );
      break;
    }

    case "series:plan-series": {
      if (!seriesId) {
        console.error("❌ Lỗi: Cần cung cấp --series <seriesId>.");
        process.exit(2);
      }

      const explicitSource = getArgValue(subArgs, "--source");
      let sourceWork = explicitSource ? bible.getSourceWork(explicitSource) : null;
      if (!sourceWork) {
        const works = bible.listSourceWorks(seriesId);
        if (works.length > 0) sourceWork = works[0];
      }

      if (!sourceWork) {
        console.error(`❌ Không tìm thấy tác phẩm nguồn nào cho series '${seriesId}'. Hãy chạy 'series:ingest' trước.`);
        process.exit(2);
      }

      const targetEpisodes = getArgValue(subArgs, "--episodes")
        ? parseInt(getArgValue(subArgs, "--episodes")!, 10)
        : undefined;
      const targetDuration = getArgValue(subArgs, "--duration")
        ? parseFloat(getArgValue(subArgs, "--duration")!)
        : undefined;
      const totalDuration = getArgValue(subArgs, "--total-duration")
        ? parseFloat(getArgValue(subArgs, "--total-duration")!)
        : undefined;
      const pacingPreset = (getArgValue(subArgs, "--pacing") as any) || "standard";

      console.log(`\n📋 Đang lập kế hoạch chuyển thể cho '${sourceWork.title}' (Pacing: ${pacingPreset})...`);

      const planner = new SeriesPlanner(bible);
      const planResult = await planner.planSeries({
        seriesId,
        sourceId: sourceWork.id,
        targetEpisodes,
        targetDurationPerEpisodeSec: targetDuration,
        targetTotalDurationSec: totalDuration,
        pacingPreset,
        status: (getArgValue(subArgs, "--status") as any) || "draft",
      });

      console.log(`✅ Đã tạo Kế Hoạch Chuyển Thể: ${planResult.plan.id}`);
      console.log(`   Trạng thái:          ${planResult.plan.status.toUpperCase()}`);
      console.log(`   Số tập dự kiến:      ${planResult.episodes.length} tập`);
      console.log(
        `   Thời lượng mục tiêu: ${planResult.episodes[0]?.target_duration_sec}s / tập (Tổng: ${planResult.summary.estimatedTotalDurationSec}s)`
      );
      console.log(`   Sổ cái độ phủ:       ${planResult.coverageLedgers.length} bản ghi`);

      const coverageMetrics = CoverageLedgerManager.calculateCoverage(seriesId, planResult.plan.id, bible);
      console.log(`   Độ phủ chương:       ${coverageMetrics.unitCoveragePercent}%`);
      console.log(`   Bảo toàn beat chính: ${coverageMetrics.mandatoryBeatsCoveragePercent}%`);

      if (planResult.warnings.length > 0) {
        console.log(`\n⚠️ Cảnh báo xung đột / điều chỉnh:`);
        for (const w of planResult.warnings) {
          console.log(`   - ${w}`);
        }
      }

      console.log(`\nDanh sách các tập phim dự kiến:`);
      for (const ep of planResult.episodes) {
        console.log(`   [Tập ${ep.episode_number}] ${ep.title} (${ep.target_duration_sec}s)`);
        console.log(`     Mục tiêu:   ${ep.goal}`);
        console.log(`     Hồi kết:    ${ep.ending}`);
      }

      if (planResult.plan.status === "draft") {
        console.log(`\n💡 Kế hoạch hiện ở trạng thái DRAFT. Để phê duyệt và kích hoạt sản xuất, chạy:`);
        console.log(`   npx tsx src/cli.ts series:plan-approve ${planResult.plan.id} --series ${seriesId}`);
      }
      break;
    }

    case "series:plan-approve": {
      const planId =
        subArgs[0] && !subArgs[0].startsWith("-")
          ? subArgs[0]
          : getArgValue(subArgs, "--plan") || getArgValue(subArgs, "--id");
      if (!planId) {
        console.error("❌ Lỗi: Cần cung cấp planId (ví dụ: series:plan-approve <planId> hoặc --plan <planId>).");
        process.exit(2);
      }
      const planner = new SeriesPlanner(bible);
      try {
        const approved = planner.approvePlan(planId, getArgValue(subArgs, "--by") || "cli_operator");
        const activated = planner.activatePlan(planId);
        console.log(`\n✅ Đã phê duyệt và kích hoạt Kế Hoạch Chuyển Thể: [${activated.id}]`);
        console.log(`   Series ID:  ${activated.series_id}`);
        console.log(`   Trạng thái: ${activated.status.toUpperCase()}`);
        console.log(`   Kế hoạch hiện đã sẵn sàng cho sản xuất (series:season).\n`);
      } catch (err: any) {
        console.error(`❌ Lỗi phê duyệt kế hoạch: ${err.message}`);
        process.exit(1);
      }
      break;
    }

    case "series:finalize": {
      const epArg = getArgValue(subArgs, "--episode");
      const epNum = epArg ? parseInt(epArg, 10) : 1;
      const sId = seriesId || "default-series";
      const epNumStr = String(epNum).padStart(2, "0");
      const outDir =
        getArgValue(subArgs, "--out") ||
        join("output", "series", sId, `ep-${epNumStr}`);

      const scriptPath =
        getArgValue(subArgs, "--script") ||
        join(outDir, "script-normalized.json");

      if (!existsSync(scriptPath)) {
        console.error(`❌ Lỗi: Không tìm thấy kịch bản tại ${scriptPath}. Cần chạy 'series:episode' trước.`);
        process.exit(2);
      }

      let script: any;
      try {
        script = JSON.parse(await readFile(scriptPath, "utf8"));
      } catch (err: any) {
        console.error(`❌ Lỗi đọc kịch bản: ${err.message}`);
        process.exit(1);
      }

      const allowMock = hasFlag(subArgs, "--allow-mock-media") || hasFlag(subArgs, "--dry-run");

      console.log(`\n🔒 [FINALIZE] Bắt đầu kiểm tra và chốt tập ${epNum} ('${script.title}') cho series '${sId}'...`);
      const result = await finalizeEpisodeProduction({
        seriesId: sId,
        episodeNumber: epNum,
        script,
        bible,
        outputDir: outDir,
        allowMockMedia: allowMock,
      });

      if (!result.success) {
        console.error(`\n❌ Chốt tập thất bại: ${result.error}`);
        if (result.missingApprovals && result.missingApprovals.length > 0) {
          console.error(`   Shots chưa duyệt hoặc thiếu file:`);
          for (const s of result.missingApprovals) console.error(`     - ${s}`);
        }
        if (result.mockTakesDetected && result.mockTakesDetected.length > 0) {
          console.error(`   Takes mock bị phát hiện (bị chặn đưa vào canon):`);
          for (const m of result.mockTakesDetected) console.error(`     - ${m}`);
        }
        process.exit(1);
      }

      console.log("\n=======================================================");
      console.log(`🎉 TẬP PHIM ĐÃ ĐƯỢC CHỐT VÀO CANON THÀNH CÔNG!`);
      console.log(`   Tập:        ${epNum} - "${script.title}"`);
      console.log(`   Master MP4: ${result.masterVideoPath}`);
      console.log(`   Commit ID:  ${result.commitId}`);
      console.log(`   QA Status:  ${result.qaReport?.isValid ? "PASSED (Hợp lệ)" : "N/A"}`);
      console.log("=======================================================\n");
      break;
    }

    case "series:season": {
      if (!seriesId) {
        console.error("❌ Lỗi: Cần cung cấp --series <seriesId>.");
        process.exit(2);
      }

      const execMode = resolveExecutionMode(subArgs);
      const planId = getArgValue(subArgs, "--plan");
      const fromEp = getArgValue(subArgs, "--from") ? parseInt(getArgValue(subArgs, "--from")!, 10) : undefined;
      const toEp = getArgValue(subArgs, "--to") ? parseInt(getArgValue(subArgs, "--to")!, 10) : undefined;
      const episodesArg = getArgValue(subArgs, "--episodes");
      const episodes = episodesArg
        ? episodesArg.split(",").map((e) => parseInt(e.trim(), 10)).filter((n) => !isNaN(n))
        : undefined;
      const budgetCap = getArgValue(subArgs, "--budget-cap")
        ? parseFloat(getArgValue(subArgs, "--budget-cap")!)
        : undefined;
      const outputDir = getArgValue(subArgs, "--output");
      const continueOnError = !hasFlag(subArgs, "--stop-on-error");
      const resume = !hasFlag(subArgs, "--no-resume");
      const hierarchical = !hasFlag(subArgs, "--no-hierarchical");
      const transitionDurationSec = parseTransitionSec(subArgs);

      console.log(`\n🎥 Đang khởi chạy Điều Phối Toàn Mùa (Season Orchestration) cho series '${seriesId}'...`);
      console.log(`   Provider:         ${execMode.provider} (Dry-run: ${execMode.dryRun})`);
      console.log(`   Resume:           ${resume}`);
      console.log(`   Continue on error: ${continueOnError}`);
      console.log(`   Hierarchical:     ${hierarchical}`);

      const orchestrator = new SeasonOrchestrator(bible);
      const result = await orchestrator.produceSeason({
        seriesId,
        planId,
        fromEpisode: fromEp,
        toEpisode: toEp,
        episodes,
        outputBaseDir: outputDir,
        provider: execMode.provider,
        dryRun: execMode.dryRun,
        mockTts: execMode.mockTts,
        skipAudit: execMode.skipAudit,
        skipRender: execMode.skipRender,
        resume,
        budgetCapUsd: budgetCap,
        commitCanon: execMode.commitCanon,
        continueOnError,
        useHierarchicalAssembly: hierarchical,
        transitionDurationSec,
      });

      console.log(`\n=======================================================`);
      console.log(`🎬 KẾT QUẢ ĐIỀU PHỐI MÙA PHIM (SEASON EXECUTION SUMMARY)`);
      console.log(`   Series:               ${seriesId}`);
      console.log(`   Trạng thái tổng thể:  ${result.success ? "✅ THÀNH CÔNG" : "⚠️ CÓ TẬP LỖI HOẶC VƯỢT NGÂN SÁCH"}`);
      console.log(`   Tập hoàn thành:       ${result.episodesCompleted} / ${result.totalTargetEpisodes}`);
      console.log(`   Tập thất bại:         ${result.episodesFailed}`);
      console.log(`   Tổng thời lượng:      ${result.totalDurationSec}s`);
      console.log(`   Chi phí xác nhận:     $${result.totalCostUsd.toFixed(2)} USD`);
      if (result.seasonMasterReportPath) {
        console.log(`   Báo cáo Master:       ${result.seasonMasterReportPath}`);
      }
      console.log(`=======================================================\n`);
      break;
    }

    default:
      console.error(`❌ Lệnh không hợp lệ: "${subCommand}". Chạy \`series:help\` để xem danh sách lệnh.`);
      process.exit(2);
  }
}
