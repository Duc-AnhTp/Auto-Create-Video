import { existsSync, readFileSync } from "node:fs";
import { SourceIngestionEngine, TextChunker } from "../../../modules/story/index.js";
import { log } from "../../../platform/observability/logger.js";
import { getArgValue } from '../arguments.js';
import type { SeriesCommandContext } from './context.js';
export async function ingestCommand(context: Pick<SeriesCommandContext, "seriesId" | "subArgs" | "bible">): Promise<void> {
    const { seriesId, subArgs, bible } = context;
    if (!seriesId) {
        console.error("❌ Lỗi: Cần cung cấp --series <seriesId>.");
        process.exit(2);
    }
    const inputFile = getArgValue(subArgs, "--input") || getArgValue(subArgs, "-i");
    const inputText = getArgValue(subArgs, "--text");
    const title = getArgValue(subArgs, "--title") || "Tác phẩm chuyển thể";
    const author = getArgValue(subArgs, "--author");
    const sourceType = (getArgValue(subArgs, "--type") as any) || "novel";
    if (!inputFile && !inputText) {
        console.error("❌ Lỗi: Cần cung cấp --input <path> hoặc --text <content>.");
        process.exit(2);
    }
    let rawContent = "";
    if (inputFile) {
        if (!existsSync(inputFile)) {
            console.error(`❌ File nguồn không tồn tại: ${inputFile}`);
            process.exit(2);
        }
        rawContent = readFileSync(inputFile, "utf8");
    }
    else {
        rawContent = inputText!;
    }
    console.log(`\n📚 Đang nhập tác phẩm nguồn: "${title}" vào Series '${seriesId}'...`);
    const ingestion = SourceIngestionEngine.ingestSourceText(rawContent, {
        seriesId,
        title,
        author,
        sourceType,
    }, bible);
    console.log(`✅ Đã lưu tác phẩm nguồn: ${ingestion.work.id}`);
    console.log(`   Phiên bản revision:   ${ingestion.work.current_revision}`);
    console.log(`   SHA-256 content hash: ${ingestion.work.content_hash}`);
    const units = TextChunker.splitIntoUnits(ingestion.work.normalized_text, ingestion.work.id, seriesId, ingestion.work.current_revision);
    bible.batchUpsertSourceUnits(units);
    const blocks: any[] = [];
    for (const u of units) {
        blocks.push(...TextChunker.splitIntoBlocks(u, seriesId, ingestion.work.current_revision));
    }
    bible.batchUpsertSourceBlocks(blocks);
    const coverage = TextChunker.verifyContentCoverage(ingestion.work.normalized_text, units);
    console.log(`   Số đơn vị (chương):   ${units.length}`);
    console.log(`   Số khối đoạn văn:     ${blocks.length}`);
    console.log(`   Zero-loss coverage:   ${coverage.hasZeroLoss ? "✅ BẢO TOÀN 100%" : "⚠️ CÓ KHOẢNG TRỐNG"}`);
}
