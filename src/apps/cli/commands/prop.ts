import { log } from "../../../platform/observability/logger.js";
import { getArgValue } from '../arguments.js';
import type { SeriesCommandContext } from './context.js';
export async function propCommand(context: Pick<SeriesCommandContext, "subArgs" | "bible">): Promise<void> {
    const { subArgs, bible } = context;
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
}
