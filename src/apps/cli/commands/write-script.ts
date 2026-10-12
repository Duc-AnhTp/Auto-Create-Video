import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { StoryToScreenplayGenerator } from "../../../modules/story/index.js";
import { log } from "../../../platform/observability/logger.js";
import { getArgValue, hasFlag } from '../arguments.js';
import type { SeriesCommandContext } from './context.js';
export async function writeScriptCommand(context: Pick<SeriesCommandContext, "subArgs" | "seriesId" | "biblePath" | "bible">): Promise<void> {
    const { subArgs, seriesId, biblePath, bible } = context;
    const idea = getArgValue(subArgs, "--idea") || getArgValue(subArgs, "--prompt");
    const storyPathOrText = getArgValue(subArgs, "--story");
    const outPath = getArgValue(subArgs, "--out");
    const epArg = getArgValue(subArgs, "--episode");
    const episodeNumber = epArg ? parseInt(epArg, 10) : undefined;
    const sId = seriesId || "default-series";
    const skipAudit = hasFlag(subArgs, "--skip-audit");
    let storyText = "";
    if (storyPathOrText) {
        if (existsSync(storyPathOrText)) {
            storyText = readFileSync(storyPathOrText, "utf8");
        }
        else {
            storyText = storyPathOrText;
        }
    }
    if (!idea && !storyText) {
        console.error("❌ Lỗi: Cần cung cấp --idea \"...\" hoặc --story <file_or_text>.");
        process.exit(2);
    }
    console.log(`\n✍️ [BIÊN KỊCH AI] Đang chuyển đổi ý tưởng/truyện thành kịch bản phân cảnh chuẩn điện ảnh...`);
    console.log(`   Series: [${sId}] | Story Bible: ${biblePath}`);
    const generator = new StoryToScreenplayGenerator(bible);
    const res = await generator.generateScreenplay({
        seriesId: sId,
        prompt: idea,
        storyText,
        episodeNumber,
        skipAudit,
    });
    console.log("\n=======================================================");
    console.log(`🎉 KỊCH BẢN ĐÃ TẠO XONG (${res.generatorUsed === "llm" ? "AI LLM" : "Rule-Based Offline Engine"})`);
    console.log(`   Tiêu đề: Tập ${res.script.episodeNumber}: ${res.script.title}`);
    console.log(`   Số cảnh: ${res.sceneCount} cảnh | Tổng số shot: ${res.shotCount} shots`);
    console.log(`   Thời lượng ước tính: ${res.estimatedDurationSec}s`);
    console.log(`   Nhân vật tham gia: ${res.charactersUsed.join(", ") || "N/A"}`);
    console.log(`   Đạo cụ sử dụng: ${res.propsUsed.join(", ") || "Không"}`);
    console.log("=======================================================\n");
    if (outPath) {
        await mkdir(dirname(outPath), { recursive: true });
        writeFileSync(outPath, res.rawScreenplay, "utf8");
        console.log(`💾 Kịch bản đã được lưu tại: ${outPath}`);
    }
    else {
        console.log(res.rawScreenplay);
    }
}
