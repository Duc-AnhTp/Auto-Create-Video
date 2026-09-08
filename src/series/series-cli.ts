import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { BibleManager } from "../bible/bible-manager.js";
import { EpisodicPipeline } from "./episodic-pipeline.js";
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
  series:status     Xem báo cáo Story Bible: nhân vật, đạo cụ, và lịch sử các tập

Tùy chọn:
  --series <id>       ID (slug) của series (mặc định lưu tại data/series/<id>/story_bible.db)
  --bible <path>      Đường dẫn trực tiếp đến file SQLite Story Bible
  --provider <name>   Video AI Provider ("mock" | "api_kling" | "api_runway" | "local_comfyui")
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

      const dryRun = hasFlag(subArgs, "--dry-run");
      const provider = (getArgValue(subArgs, "--provider") as BackendProvider) || (dryRun ? "mock" : "mock");
      const skipRender = hasFlag(subArgs, "--skip-render");
      const mockTts = dryRun || hasFlag(subArgs, "--mock-tts");
      const skipAudit = hasFlag(subArgs, "--skip-audit");

      const pipeline = new EpisodicPipeline(biblePath);
      const res = await pipeline.produceEpisode(scriptInput, {
        seriesId,
        biblePath,
        provider,
        mockTts,
        skipRender,
        skipAudit,
      });

      console.log("\n=======================================================");
      console.log(`🎉 HOÀN THÀNH SẢN XUẤT TẬP ${res.episodeNumber}: "${res.title}"`);
      console.log(`   Video: ${res.videoPath}`);
      console.log(`   Audio: ${res.audioPath}`);
      console.log(`   Thư mục xuất bản: ${res.outputDir}`);
      console.log("=======================================================\n");
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
      console.log("=======================================================\n");
      break;
    }

    default:
      console.error(`❌ Lệnh không hợp lệ: "${subCommand}". Chạy \`series:help\` để xem danh sách lệnh.`);
      process.exit(2);
  }
}
