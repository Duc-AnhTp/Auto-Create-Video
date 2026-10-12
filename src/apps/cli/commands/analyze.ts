import { join } from "node:path";
import { StoryAnalysisEngine } from "../../../modules/story/index.js";
import { log } from "../../../platform/observability/logger.js";
import { getArgValue } from '../arguments.js';
import type { SeriesCommandContext } from './context.js';
export async function analyzeCommand(context: Pick<SeriesCommandContext, "seriesId" | "subArgs" | "bible">): Promise<void> {
    const { seriesId, subArgs, bible } = context;
    if (!seriesId) {
        console.error("❌ Lỗi: Cần cung cấp --series <seriesId>.");
        process.exit(2);
    }
    const explicitSource = getArgValue(subArgs, "--source");
    let sourceWork = explicitSource ? bible.getSourceWork(explicitSource) : null;
    if (!sourceWork) {
        const works = bible.listSourceWorks(seriesId);
        if (works.length > 0)
            sourceWork = works[0];
    }
    if (!sourceWork) {
        console.error(`❌ Không tìm thấy tác phẩm nguồn nào cho series '${seriesId}'. Hãy chạy 'series:ingest' trước.`);
        process.exit(2);
    }
    const units = bible.listSourceUnits(sourceWork.id);
    const blocks = bible.listSourceBlocks(sourceWork.id);
    console.log(`\n🔍 Đang phân tích câu chuyện: "${sourceWork.title}" (${units.length} chương, ${blocks.length} đoạn)...`);
    const analysis = await StoryAnalysisEngine.analyzeWork(sourceWork, units, blocks, bible, {
        seriesId,
        sourceId: sourceWork.id,
    });
    console.log(`✅ Phân tích hoàn tất:`);
    console.log(`   Nhân vật phát hiện:   ${analysis.characters.length} (nhân vật chính: ${analysis.characters.filter((c) => c.role === "protagonist").map((c) => c.name).join(", ") || "N/A"})`);
    console.log(`   Nhịp truyện (beats):  ${analysis.beats.length} (${analysis.beats.filter((b) => b.is_flashback === 1).length} hồi tưởng)`);
    console.log(`   Tuyến truyện:         ${analysis.threads.length} (${analysis.threads.map((t) => t.name).join(", ")})`);
    console.log(`   Trạng thái tri thức:  ${analysis.knowledgeStates.length} bản ghi (nguồn, cải biên, nhân vật, khán giả)`);
}
