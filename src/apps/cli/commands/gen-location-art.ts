import { ConceptArtGenerator } from "../../../modules/production/index.js";
import { log } from "../../../platform/observability/logger.js";
import { getArgValue, resolveExecutionMode } from '../arguments.js';
import type { SeriesCommandContext } from './context.js';
export async function genLocationArtCommand(context: Pick<SeriesCommandContext, "subArgs" | "seriesId" | "bible">): Promise<void> {
    const { subArgs, seriesId, bible } = context;
    const locId = getArgValue(subArgs, "--loc") || getArgValue(subArgs, "--id");
    const sId = seriesId || "default-series";
    if (!locId) {
        console.error("❌ Lỗi: Cần cung cấp --loc <location_id>.");
        process.exit(2);
    }
    const promptOverride = getArgValue(subArgs, "--prompt");
    const outDir = getArgValue(subArgs, "--out");
    const { provider } = resolveExecutionMode(subArgs);
    console.log(`\n🏛️ [T2I CONCEPT ART] Đang tạo hình ảnh bối cảnh mẫu cho [${locId}]...`);
    const generator = new ConceptArtGenerator(bible);
    const res = await generator.generateLocationConceptArt({
        seriesId: sId,
        locationId: locId,
        promptOverride,
        outputDir: outDir,
        provider: provider === "local_comfyui" ? "local_comfyui" : "mock",
    });
    console.log("\n=======================================================");
    console.log(`🎉 ẢNH BỐI CẢNH ĐÃ ĐƯỢC TẠO VÀ LƯU TRỮ VĨNH VIỄN`);
    console.log(`   Địa điểm: ${res.entityId}`);
    console.log(`   Đường dẫn ảnh: ${res.imagePath} (${res.fileSizeBytes} bytes)`);
    console.log(`   Engine: ${res.providerUsed}`);
    console.log("=======================================================\n");
}
