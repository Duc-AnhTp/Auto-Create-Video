import { execSync } from "node:child_process";
import { existsSync, copyFileSync } from "node:fs";
import { join } from "node:path";
import axios from "axios";

interface DiagnosticItem {
  name: string;
  status: "pass" | "warn" | "fail";
  detail: string;
  recommendation?: string;
}

async function runDoctor() {
  console.log(`
╔═══════════════════════════════════════════════════════════════════════╗
║         AUTO-CREATE-VIDEO: ENVIRONMENT & SYSTEM DOCTOR               ║
║    Chẩn đoán hạ tầng, AI Video Models, Story Bible & Render Engine     ║
╚═══════════════════════════════════════════════════════════════════════╝
`);

  const results: DiagnosticItem[] = [];

  // 1. Node.js Version Check
  const nodeVer = process.versions.node;
  const majorVer = parseInt(nodeVer.split(".")[0], 10);
  if (majorVer >= 20) {
    results.push({
      name: "Node.js Runtime",
      status: "pass",
      detail: `v${nodeVer} (Hỗ trợ tốt node:sqlite & async streams)`,
    });
  } else {
    results.push({
      name: "Node.js Runtime",
      status: "fail",
      detail: `v${nodeVer} (Yêu cầu Node >= 20)`,
      recommendation: "Cập nhật Node.js lên v20 hoặc v22 LTS: https://nodejs.org",
    });
  }

  // 2. Built-in SQLite Check
  try {
    const sqlite = await import("node:sqlite");
    if ((sqlite as any).DatabaseSync) {
      results.push({
        name: "Story Bible SQLite",
        status: "pass",
        detail: "node:sqlite DatabaseSync sẵn sàng cho bộ nhớ Canon",
      });
    } else {
      results.push({
        name: "Story Bible SQLite",
        status: "fail",
        detail: "Không tìm thấy node:sqlite DatabaseSync",
        recommendation: "Hãy sử dụng Node.js 20.x hoặc 22.x LTS chính thức.",
      });
    }
  } catch (err: any) {
    results.push({
      name: "Story Bible SQLite",
      status: "fail",
      detail: `Lỗi nạp node:sqlite: ${err.message}`,
      recommendation: "Cập nhật Node.js lên phiên bản LTS mới nhất.",
    });
  }

  // 3. FFmpeg Check
  try {
    const out = execSync("ffmpeg -version", { stdio: ["ignore", "pipe", "ignore"] }).toString();
    const firstLine = out.split("\n")[0].trim();
    results.push({
      name: "FFmpeg Video Engine",
      status: "pass",
      detail: firstLine,
    });
  } catch {
    const os = process.platform;
    let installCmd = "sudo apt update && sudo apt install -y ffmpeg";
    if (os === "win32") {
      installCmd = "winget install Gyan.FFmpeg   (hoặc choco install ffmpeg)";
    } else if (os === "darwin") {
      installCmd = "brew install ffmpeg";
    }
    results.push({
      name: "FFmpeg Video Engine",
      status: "warn",
      detail: "Chưa cài đặt FFmpeg trên máy (Hệ thống sẽ chạy ở chế độ Mock Renderer)",
      recommendation: `Cài đặt FFmpeg bằng 1 lệnh: ${installCmd}`,
    });
  }

  // 4. FFprobe Check
  try {
    const out = execSync("ffprobe -version", { stdio: ["ignore", "pipe", "ignore"] }).toString();
    const firstLine = out.split("\n")[0].trim();
    results.push({
      name: "FFprobe Audio/Video Inspector",
      status: "pass",
      detail: firstLine,
    });
  } catch {
    results.push({
      name: "FFprobe Audio/Video Inspector",
      status: "warn",
      detail: "Chưa cài đặt FFprobe (thường đi kèm FFmpeg)",
      recommendation: "Cài đặt gói đầy đủ FFmpeg để có ffprobe.",
    });
  }

  // 5. Configuration (.env) Check
  const envPath = join(process.cwd(), ".env");
  const envLocalPath = join(process.cwd(), ".env.local");
  const envExamplePath = join(process.cwd(), ".env.example");

  if (existsSync(envPath) || existsSync(envLocalPath)) {
    results.push({
      name: "Environment Config (.env)",
      status: "pass",
      detail: "Tìm thấy file cấu hình môi trường (.env / .env.local)",
    });
  } else if (existsSync(envExamplePath)) {
    try {
      copyFileSync(envExamplePath, envPath);
      results.push({
        name: "Environment Config (.env)",
        status: "pass",
        detail: "Đã tự động khởi tạo .env từ mẫu .env.example",
      });
    } catch {
      results.push({
        name: "Environment Config (.env)",
        status: "warn",
        detail: "Chưa có file .env",
        recommendation: "Sao chép .env.example sang .env và nhập API key.",
      });
    }
  } else {
    results.push({
      name: "Environment Config (.env)",
      status: "warn",
      detail: "Không tìm thấy .env hoặc .env.example",
    });
  }

  // 6. Local ComfyUI / GPU Check
  const comfyHost = process.env.COMFYUI_HOST || "http://127.0.0.1:8188";
  try {
    const res = await axios.get(`${comfyHost}/system_stats`, { timeout: 1500 });
    const dev = res.data?.devices?.[0];
    const gpuName = dev?.name || "Local GPU";
    results.push({
      name: "ComfyUI / Local GPU",
      status: "pass",
      detail: `Đã kết nối ComfyUI tại ${comfyHost} (${gpuName})`,
    });
  } catch {
    results.push({
      name: "ComfyUI / Local GPU",
      status: "warn",
      detail: `ComfyUI không phản hồi tại ${comfyHost} (Sẽ dùng Mock T2I/T2V hoặc Cloud API)`,
      recommendation: "Bật ComfyUI nếu muốn kết xuất video cục bộ trên GPU cá nhân.",
    });
  }

  // Print Report
  console.log("┌───────────────────────────────────┬────────┬────────────────────────────────────────────────────────┐");
  console.log("│ HẠNG MỤC KIỂM TRA                 │ TRẠNG  │ CHI TIẾT                                               │");
  console.log("├───────────────────────────────────┼────────┼────────────────────────────────────────────────────────┤");

  for (const item of results) {
    const namePad = item.name.padEnd(33, " ");
    const badge = item.status === "pass" ? "\x1b[32m[ OK ]\x1b[0m " : item.status === "warn" ? "\x1b[33m[WARN]\x1b[0m " : "\x1b[31m[FAIL]\x1b[0m ";
    const detailShort = item.detail.length > 54 ? item.detail.slice(0, 51) + "..." : item.detail.padEnd(54, " ");
    console.log(`│ ${namePad} │ ${badge} │ ${detailShort} │`);
  }
  console.log("└───────────────────────────────────┴────────┴────────────────────────────────────────────────────────┘\n");

  const recommendations = results.filter((r) => r.recommendation);
  if (recommendations.length > 0) {
    console.log("💡 HƯỚNG DẪN HOÀN THIỆN HỆ THỐNG:");
    for (const r of recommendations) {
      console.log(`   - ${r.name}: ${r.recommendation}`);
    }
    console.log("");
  }

  const hasFails = results.some((r) => r.status === "fail");
  if (hasFails) {
    console.error("❌ Một số yêu cầu bắt buộc chưa đạt. Vui lòng khắc phục theo hướng dẫn trên.");
    process.exit(1);
  } else {
    console.log("🎉 HỆ THỐNG ĐÃ SẴN SÀNG ĐỂ LÀM PHIM VÀ SẢN XUẤT VIDEO!");
  }
}

runDoctor().catch((err) => {
  console.error("Lỗi khi chạy setup doctor:", err);
  process.exit(1);
});
