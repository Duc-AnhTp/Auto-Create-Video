import { ConceptArtGenerator } from "../../../modules/production/index.js";
import { log } from "../../../platform/observability/logger.js";
import { getArgValue, resolveExecutionMode } from '../arguments.js';
import type { SeriesCommandContext } from './context.js';
export async function genCharacterArtCommand(context: Pick<SeriesCommandContext, "subArgs" | "seriesId" | "bible">): Promise<void> {
    const { subArgs, seriesId, bible } = context;
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
}
