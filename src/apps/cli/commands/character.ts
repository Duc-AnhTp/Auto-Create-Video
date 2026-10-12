import { log } from "../../../platform/observability/logger.js";
import { getArgValue } from '../arguments.js';
import type { SeriesCommandContext } from './context.js';
export async function characterCommand(context: Pick<SeriesCommandContext, "subArgs" | "bible">): Promise<void> {
    const { subArgs, bible } = context;
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
    if (faceImage)
        console.log(`   Ảnh khuôn mặt chuẩn: ${faceImage}`);
    if (marks)
        console.log(`   Đặc điểm nhận dạng: ${marks}`);
    if (wardrobeDesc)
        console.log(`   Trang phục: ${wardrobeDesc}`);
}
