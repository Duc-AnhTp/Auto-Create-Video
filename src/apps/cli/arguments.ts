import { WorkflowError } from "../../platform/workflow-error.js";
import { resolveExecutionPolicy } from "../../modules/production/index.js";


import { join } from "node:path";

import axios from "axios";


import { type EpisodeOptions } from "../../bootstrap/episode-runtime.js";

import type { BackendProvider } from "../../contracts/video.js";










import { log } from "../../platform/observability/logger.js";
export function getArgValue(args: string[], flag: string, short?: string): string | undefined {
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
export function hasFlag(args: string[], flag: string, short?: string): boolean {
  if (args.includes(flag) || (!!short && args.includes(short))) return true;
  for (const arg of args) {
    if (arg.startsWith(`${flag}=`)) {
      const val = arg.slice(flag.length + 1).toLowerCase();
      return val === "true" || val === "1" || val === "";
    }
  }
  return false;
}
export function parseTransitionSec(subArgs: string[]): number | undefined {
  const transArg = getArgValue(subArgs, "--transition");
  if (transArg === undefined) return undefined;
  const val = parseFloat(transArg);
  return !isNaN(val) && val >= 0 ? val : undefined;
}
export function resolveExecutionMode(subArgs: string[]): {
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
  const provider=resolveExecutionPolicy(dryRun||explicitProvider==="mock"?"mock":"production",explicitProvider??"local_comfyui").provider as BackendProvider;
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
export function resolveHedge(args:string[],provider:BackendProvider):EpisodeOptions["hedge"]{
  if(!hasFlag(args,"--hedge"))return {enabled:false,delayMs:45_000};
  const fallback=getArgValue(args,"--hedge-provider") as BackendProvider|undefined;
  const delayMs=Number(getArgValue(args,"--hedge-delay-ms")??45_000);
  if(provider==="mock"||!fallback||fallback==="mock"||fallback===provider||!Number.isFinite(delayMs)||delayMs<0||delayMs>300_000)throw new WorkflowError("HEDGE_PROVIDER_INVALID", "HEDGE_PROVIDER_INVALID", "failed");
  return {enabled:true,fallbackProvider:fallback,delayMs};
}
export function resolveBiblePath(seriesId?: string, explicitBiblePath?: string): string {
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