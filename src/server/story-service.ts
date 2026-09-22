import { BibleManager } from "../bible/bible-manager.js";
import { SourceIngestionEngine } from "../novel/source-ingestion.js";
import { TextChunker } from "../novel/text-chunker.js";
import { StoryAnalysisEngine } from "../novel/story-analyzer.js";
import { SeriesPlanner } from "../series/series-planner.js";
import { StoryToScreenplayGenerator } from "../series/story-to-screenplay.js";
import { normalizeScript } from "../series/script-normalizer.js";
import { EpisodicScriptSchema } from "../series/series-schema.js";
import { join } from "node:path";
import { z } from "zod";

export const SourceRequest = z.object({ title: z.string().min(1).max(250), text: z.string().min(1).max(2_000_000), episodes: z.number().int().min(1).max(30).default(2) }).strict();
export const ScreenplayRequest = z.object({ planId: z.string().min(1), episodeNumber: z.number().int().positive() }).strict();
export const EditShotRequest = z.object({ baseVersion: z.number().int().min(0), text: z.string().min(1).max(2_000_000), shotId: z.string().min(1), direction: z.number().int().min(-1).max(1).default(0), change: z.object({ durationSec: z.number().positive().max(30).optional(), visualPrompt: z.string().min(1).optional() }).strict() }).strict();
export async function withStory<T>(seriesId: string, fn: (bible: BibleManager) => Promise<T>) {
  const bible = new BibleManager(join("data", "series", seriesId, "story_bible.db"));
  try { return await fn(bible); } finally { bible.close(); }
}
export async function importStory(seriesId: string, input: z.infer<typeof SourceRequest>) {
  return withStory(seriesId, async bible => {
    const { work } = SourceIngestionEngine.ingestSourceText(input.text, { seriesId, title: input.title }, bible);
    const units = TextChunker.splitIntoUnits(work.normalized_text, work.id, seriesId, work.current_revision);
    const blocks = units.flatMap(unit => TextChunker.splitIntoBlocks(unit, seriesId, work.current_revision));
    for (const unit of units) bible.upsertSourceUnit(unit);
    for (const block of blocks) bible.upsertSourceBlock(block);
    const analysis = await StoryAnalysisEngine.analyzeWork(work, units, blocks, bible, { seriesId, sourceId: work.id, useLlm: false });
    const plan = await new SeriesPlanner(bible).planSeries({ seriesId, sourceId: work.id, targetEpisodes: input.episodes, targetDurationPerEpisodeSec: 150, pacingPreset: "standard", useLlm: false });
    return { sourceId: work.id, planId: plan.plan.id, summary: plan.summary, warnings: [...analysis.warnings, ...plan.warnings], message: "Đã lập kế hoạch bản thử bằng luật cục bộ. Cần kiểm tra nội dung trước khi sản xuất thật." };
  });
}
export async function generateDraft(seriesId: string, input: z.infer<typeof ScreenplayRequest>) {
  return withStory(seriesId, async bible => {
    const result = await new StoryToScreenplayGenerator(bible).generateEpisodeFromPlan({ seriesId, ...input, useLlm: false, skipAudit: true });
    return { text: JSON.stringify(result.script, null, 2), generatorUsed: result.generatorUsed };
  });
}
export async function editShot(seriesId: string, input: z.infer<typeof EditShotRequest>) {
  return withStory(seriesId, async bible => {
    const script = await normalizeScript(input.text, bible, { seriesId, skipAudit: true });
    const scene = script.scenes.find(scene => scene.shots.some(shot => shot.shotId === input.shotId));
    if (!scene) throw new Error("SHOT_NOT_FOUND");
    const index = scene.shots.findIndex(shot => shot.shotId === input.shotId);
    Object.assign(scene.shots[index], input.change);
    const target = index + input.direction;
    if (target >= 0 && target < scene.shots.length && target !== index) [scene.shots[index], scene.shots[target]] = [scene.shots[target], scene.shots[index]];
    return { text: JSON.stringify(EpisodicScriptSchema.parse(script), null, 2) };
  });
}
