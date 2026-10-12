import { log } from "../../../platform/observability/logger.js";
import { getArgValue } from '../arguments.js';
import type { SeriesCommandContext } from './context.js';
export async function locationCommand(context: Pick<SeriesCommandContext, "subArgs" | "bible">): Promise<void> {
    const { subArgs, bible } = context;
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
    if (lighting)
        console.log(`   Ánh sáng: ${lighting}`);
}
