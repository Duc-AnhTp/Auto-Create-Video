import { exec } from "node:child_process";
import { log } from "../../../platform/observability/logger.js";
import { getArgValue, hasFlag } from '../arguments.js';
import type { SeriesCommandContext } from './context.js';
export async function studioCommand(context: Pick<SeriesCommandContext, "subArgs">): Promise<void> {
    const { subArgs } = context;
    const port = parseInt(getArgValue(subArgs, "--port") || "3456", 10);
    const host = getArgValue(subArgs, "--host") || "127.0.0.1";
    const noOpen = hasFlag(subArgs, "--no-open");
    try {
        const { StudioServer } = await import("../../../bootstrap/studio-server.js");
        const studio = new StudioServer({ port, host });
        const url = await studio.start();
        console.log("\n=======================================================");
        console.log("🎬 AUTO-CREATE-VIDEO: FULL-FLOW WEB STUDIO SẴN SÀNG");
        console.log(`   URL Studio:    ${url}`);
        console.log(`   Port:          ${port}`);
        console.log("   Trạng thái:    Đang lắng nghe (Nhấn Ctrl+C để dừng)");
        console.log("=======================================================\n");
        if (!noOpen) {
            const cmd = process.platform === "win32"
                ? `start "" "${url}"`
                : process.platform === "darwin"
                    ? `open "${url}"`
                    : `xdg-open "${url}"`;
            exec(cmd, () => { });
        }
    }
    catch (err: any) {
        if (err?.code === "EADDRINUSE" || err?.message?.includes("EADDRINUSE")) {
            console.error(`\n❌ Lỗi: Cổng ${port} đã có tiến trình khác sử dụng (EADDRINUSE).`);
            console.error(`💡 Hướng dẫn xử lý:`);
            console.error(`   1. Chạy trên cổng khác: npm run studio -- --port ${port + 1}`);
            console.error(`   2. Hoặc giải phóng cổng ${port}:`);
            console.error(`      - PowerShell: Stop-Process -Id (Get-NetTCPConnection -LocalPort ${port}).OwningProcess -Force`);
            console.error(`      - CMD: netstat -ano | findstr :${port} (sau đó taskkill /F /PID <PID>)\n`);
        }
        else {
            console.error(`\n❌ Không thể khởi động Studio Server: ${err?.message || err}\n`);
        }
        process.exit(1);
    }
}
