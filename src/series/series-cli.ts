import { existsSync } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { BibleManager } from "../bible/bible-manager.js";
import { BudgetLedger } from "../orchestration/budget-ledger.js";
import { EpisodicPipeline } from "./episodic-pipeline.js";
import { startSeriesReviewServer } from "../review/server.js";
import type { BackendProvider } from "../gateway/video-gateway.js";
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
  return args.includes(flag) || (!!short && args.includes(short));
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
  series:init       Khởi tạo series mới với phong cách mỹ thuật và thông số chuẩn
  series:character  Đăng ký hoặc cập nhật nhân vật (khuôn mặt, trang phục, giọng nói)
  series:location   Đăng ký hoặc cập nhật bối cảnh lặp lại (quán bar, phòng ngầm...)
  series:prop       Đăng ký hoặc chuyển giao đạo cụ đặc biệt "không được quên"
  series:episode    Sản xuất tập phim từ kịch bản text thô qua 8 bước tự động
  series:resume     Tiếp tục sản xuất tập phim dở dang từ checkpoint.json
  series:reroll     Tạo lại riêng một shot lỗi (--shot <shotId>) mà không sinh lại toàn bộ
  series:remux      Dựng lại video hoàn chỉnh từ các clip đã sinh mà không gọi lại AI
  series:review     Mở Web Review Dashboard để duyệt kịch bản phân cảnh và chọn take
  series:status     Xem báo cáo Story Bible: nhân vật, đạo cụ, lịch sử các tập & sổ cái ngân sách
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
      });

      console.log("\n=======================================================");
      console.log(`🎉 HOÀN THÀNH SẢN XUẤT TẬP ${res.episodeNumber}: "${res.title}"`);
      console.log(`   Video: ${res.videoPath}`);
      console.log(`   Audio: ${res.audioPath}`);
      console.log(`   Thư mục xuất bản: ${res.outputDir}`);
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

    default:
      console.error(`❌ Lệnh không hợp lệ: "${subCommand}". Chạy \`series:help\` để xem danh sách lệnh.`);
      process.exit(2);
  }
}
