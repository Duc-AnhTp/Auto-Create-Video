import axios from "axios";
import { errorMessage } from "../../../platform/workflow-error.js";
import { isFfmpegAvailable, runFfmpeg, runFfprobe } from "../../../modules/media/index.js";
import { log } from "../../../platform/observability/logger.js";
import type { SeriesCommandContext } from './context.js';
export async function doctorCommand(context: Pick<SeriesCommandContext, "biblePath" | "seriesId" | "bible">): Promise<void> {
    const { biblePath, seriesId, bible } = context;
    console.log("\n=======================================================");
    console.log("🩺 KIỂM TRA MÔI TRƯỜNG HỆ THỐNG (SERIES DOCTOR)");
    console.log("=======================================================\n");
    const ffmpegOk = await isFfmpegAvailable();
    if (ffmpegOk) {
        try {
            const vOut = await runFfmpeg(["-version"]);
            const firstLine = vOut.split("\n")[0]?.trim() || "OK";
            console.log(`✅ FFmpeg: Sẵn sàng (${firstLine})`);
        }
        catch {
            console.log(`⚠️ FFmpeg: Không khả dụng hoặc lỗi thực thi`);
        }
        try {
            const pOut = await runFfprobe(["-version"]);
            const firstLine = pOut.split("\n")[0]?.trim() || "OK";
            console.log(`✅ FFprobe: Sẵn sàng (${firstLine})`);
        }
        catch {
            console.log(`⚠️ FFprobe: Không khả dụng hoặc lỗi thực thi`);
        }
    }
    else {
        console.log("⚠️ FFmpeg / FFprobe: Không tìm thấy trên PATH hệ thống.");
        console.log("   -> Pipeline sẽ chạy ở chế độ mô phỏng (mock media).");
        console.log("   -> Để render video thật: hãy cài đặt FFmpeg và thêm vào PATH.");
    }
    try {
        const meta = bible.getSeriesMetadata(seriesId);
        const chars = bible.listCharacters();
        console.log(`\n✅ SQLite Database: Sẵn sàng (${biblePath})`);
        console.log(`   Series hiện tại: [${meta?.id || seriesId || "default-series"}] - ${chars.length} nhân vật đã khai báo`);
    }
    catch (dbErr: unknown) {
        console.log(`\n❌ SQLite Database: Lỗi (${errorMessage(dbErr)})`);
    }
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
        }
        else {
            console.log(`\n✅ Local ComfyUI: Đang chạy tại ${comfyUrl}`);
        }
    }
    catch {
        console.log(`\nℹ️ Local ComfyUI: Chưa kết nối tại ${comfyUrl}`);
        console.log("   -> Khởi động ComfyUI (Wan 2.1/2.2) trên GPU nếu muốn tạo video 0-cost.");
    }
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
        }
        else {
            console.log(`   ⚪ ${p.name}: Chưa cấu hình (${p.envKey})`);
        }
    }
    console.log("\n🔊 Bộ Lồng Tiếng TTS:");
    const elKey = !!process.env.ELEVENLABS_API_KEY;
    const lucyKey = !!process.env.LUCYLAB_API_KEY;
    if (elKey) {
        console.log("   ✅ ElevenLabs: Đã cấu hình API key");
    }
    else {
        console.log("   ⚪ ElevenLabs: Chưa cấu hình (ELEVENLABS_API_KEY)");
    }
    if (lucyKey) {
        console.log("   ✅ LucyLab: Đã cấu hình API key");
    }
    else {
        console.log("   ⚪ LucyLab: Chưa cấu hình (LUCYLAB_API_KEY)");
    }
    console.log("\n=======================================================");
    console.log("🏁 Hoàn tất kiểm tra môi trường hệ thống.\n");
}
