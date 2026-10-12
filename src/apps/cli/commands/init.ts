import { log } from "../../../platform/observability/logger.js";
import { getArgValue } from '../arguments.js';
import type { SeriesCommandContext } from './context.js';
export async function initCommand(context: Pick<SeriesCommandContext, "seriesId" | "subArgs" | "bible" | "biblePath">): Promise<void> {
    const { seriesId, subArgs, bible, biblePath } = context;
    const id = seriesId || "default-series";
    const title = getArgValue(subArgs, "--title") || id;
    const genre = getArgValue(subArgs, "--genre") || "Drama / Sci-Fi";
    const visualStyle = getArgValue(subArgs, "--style") ||
        "Cinematic 35mm, high contrast dramatic lighting, photorealistic 8k";
    const negativePrompt = getArgValue(subArgs, "--negative") ||
        "cartoon, anime, 3D render, low quality, deformed faces";
    const aspectRatio = (getArgValue(subArgs, "--ratio") as "9:16" | "16:9") || "9:16";
    bible.upsertSeriesMetadata({
        id,
        title,
        genre,
        visual_style: visualStyle,
        negative_prompt: negativePrompt,
        aspect_ratio: aspectRatio,
        fps: 30,
        created_at: new Date().toISOString(),
    });
    console.log(`\n✅ Khởi tạo thành công Series [${id}] tại ${biblePath}`);
    console.log(`   Tiêu đề: ${title} (${genre})`);
    console.log(`   Art Style: ${visualStyle}`);
    console.log(`   Tỷ lệ: ${aspectRatio}`);
}
